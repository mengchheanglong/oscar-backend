import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { databaseOptions } from '../../src/database/database-options';
import { LocalFoldersService } from '../../src/modules/local-folders/local-folders.service';
import { LocalFolder } from '../../src/modules/local-folders/entities/local-folder.entity';
import { User } from '../../src/modules/users/entities/user.entity';
import { Project, ProjectStatus } from '../../src/modules/projects/entities/project.entity';
import {
  ProjectMember,
  ProjectRole,
} from '../../src/modules/projects/entities/project-member.entity';
import {
  KnowledgeChunk,
  KnowledgeSource,
  KnowledgeSourceType,
} from '../../src/modules/ingestion/entities';
import { RetrievalService } from '../../src/modules/mavis/retrieval/retrieval.service';
import { ConfigService } from '@nestjs/config';
import { IngestionService } from '../../src/modules/ingestion/ingestion.service';
import { ProcessingJob } from '../../src/modules/ingestion/entities';
import { OutboxService } from '../../src/modules/ingestion/outbox.service';
import { StorageDriver } from '../../src/modules/storage/storage.interface';

describe('Private local folder snapshots with PostgreSQL', () => {
  let db: DataSource, service: LocalFoldersService, retrieval: RetrievalService;
  let a: User, b: User, p: Project, other: Project;
  const users: string[] = [],
    projects: string[] = [];
  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (process.env.NODE_ENV !== 'test' || !url || !new URL(url).pathname.endsWith('_test'))
      throw new Error('Dedicated test database required.');
    db = await new DataSource(databaseOptions(url)).initialize();
    await db.runMigrations({ transaction: 'all' });
    for (const label of ['A', 'B']) {
      const user = await db.getRepository(User).save({
        email: `${randomUUID()}@folder.test`,
        displayName: label,
        passwordHash: 'synthetic',
      });
      users.push(user.id);
      if (label === 'A') a = user;
      else b = user;
    }
    p = await db.getRepository(Project).save({
      key: `F${randomUUID().slice(0, 7).toUpperCase()}`,
      name: 'Folder test',
      createdBy: a.id,
    });
    projects.push(p.id);
    other = await db.getRepository(Project).save({
      key: `F${randomUUID().slice(0, 7).toUpperCase()}`,
      name: 'Other test',
      createdBy: b.id,
    });
    projects.push(other.id);
    await db.getRepository(ProjectMember).save([
      { projectId: p.id, userId: a.id, accessRole: ProjectRole.OWNER },
      { projectId: p.id, userId: b.id, accessRole: ProjectRole.VIEWER },
      { projectId: other.id, userId: b.id, accessRole: ProjectRole.OWNER },
    ]);
    service = new LocalFoldersService(db);
    retrieval = new RetrievalService(db);
  });
  beforeEach(async () => {
    await db.getRepository(LocalFolder).delete({ projectId: In(projects) });
  });
  afterAll(async () => {
    if (!db?.isInitialized) return;
    try {
      if (projects.length) await db.getRepository(Project).delete({ id: In(projects) });
      if (users.length) await db.getRepository(User).delete({ id: In(users) });
    } finally {
      await db.destroy();
    }
  });
  const manifest = (
    expectedVersion = 0,
    text = 'Mercury pricing assumptions include contribution margin.',
  ) => ({ name: 'Research', expectedVersion, files: [{ path: 'finance/pricing.md', text }] });
  const search = (actorId: string, query = 'Mercury') =>
    retrieval.retrieve({ projectId: p.id, actorId, query, mode: 'keyword' });

  it('indexes private evidence with a relative locator for both copilot consumers', async () => {
    const id = randomUUID();
    await service.sync(p.id, a.id, id, manifest());
    expect((await service.list(p.id, a.id))[0]!.files[0]!.revision).toBe(1);
    const evidence = await search(a.id);
    expect(evidence[0]).toMatchObject({
      sourceType: KnowledgeSourceType.LOCAL_FILE,
      revision: 1,
      locator: 'Research/finance/pricing.md',
    });
    expect(await service.list(p.id, b.id)).toEqual([]);
    expect(await search(b.id)).toEqual([]);
    expect(await search(b.id, 'Unmatched fallback query')).toEqual([]);
    await expect(service.sync(p.id, b.id, id, manifest())).rejects.toThrow(NotFoundException);
    await expect(service.disconnect(p.id, b.id, id)).rejects.toThrow(NotFoundException);
    await expect(service.list(other.id, a.id)).rejects.toThrow(NotFoundException);
  });
  it('refreshes stored search vectors when folder text changes and preserves owner isolation', async () => {
    const id = randomUUID();
    await service.sync(p.id, a.id, id, manifest(0, 'Uniquevectoralpha working capital'));
    expect(
      (await search(a.id, 'Uniquevectoralpha')).some((e) => e.text?.includes('Uniquevectoralpha')),
    ).toBe(true);
    await service.sync(p.id, a.id, id, manifest(1, 'Uniquevectorbeta inventory financing'));
    const rows = await db.query(
      `SELECT c.search_vector::text AS vector FROM knowledge_chunks c
      JOIN knowledge_sources s ON s.id=c.knowledge_source_id
      WHERE s.project_id=$1 AND s.owner_id=$2 AND c.index_version=s.active_index_version
      AND c.text LIKE 'Uniquevectorbeta%'`,
      [p.id, a.id],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.every(
        (r: { vector: string }) =>
          r.vector.includes('uniquevectorbeta') && !r.vector.includes('uniquevectoralpha'),
      ),
    ).toBe(true);
    expect(await search(b.id, 'Uniquevectorbeta')).toEqual([]);
  });
  it('accepts extensionless, hidden and binary metadata manifests without weakening path isolation', async () => {
    await service.sync(p.id, a.id, randomUUID(), {
      name: 'Any files',
      expectedVersion: 0,
      files: [
        { path: 'Dockerfile', text: 'FROM node' },
        { path: '.settings', text: 'Explicitly selected' },
        {
          path: 'diagram.png',
          text: 'File: diagram.png\nContent not indexed; file metadata only.',
        },
      ],
    });
    expect((await service.list(p.id, a.id))[0]!.files).toHaveLength(3);
    expect(await service.list(p.id, b.id)).toEqual([]);
  });
  it('extracts real PDF text without creating a source and rejects invalid or unauthorized extraction', async () => {
    const stream = 'BT /F1 12 Tf 72 720 Td (Mercury document evidence) Tj ET';
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((obj, i) => {
      offsets.push(Buffer.byteLength(pdf));
      pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((o) => String(o).padStart(10, '0') + ' 00000 n ')
      .join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const buffer = Buffer.from(pdf);
    const upload = {
      originalname: 'report.pdf',
      mimetype: 'application/pdf',
      size: buffer.length,
      buffer,
    } as Express.Multer.File;
    expect((await service.extract(p.id, a.id, upload)).text).toContain('Mercury document evidence');
    const docx = readFileSync(join(__dirname, '../fixtures/local-folder.docx'));
    expect(
      (
        await service.extract(p.id, a.id, {
          ...upload,
          originalname: 'report.docx',
          buffer: docx,
          size: docx.length,
        })
      ).text,
    ).toContain('Venus DOCX evidence');
    expect(await service.list(p.id, a.id)).toEqual([]);
    await expect(service.extract(other.id, a.id, upload)).rejects.toThrow(NotFoundException);
    await expect(
      service.extract(p.id, a.id, { ...upload, buffer: Buffer.from('invalid') }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.extract(p.id, a.id, { ...upload, originalname: 'photo.png' }),
    ).rejects.toThrow(BadRequestException);
    await expect(service.extract(p.id, a.id, { ...upload, size: 10485761 })).rejects.toThrow(
      BadRequestException,
    );
  });
  it('preserves unchanged revisions, replaces changed text, and removes deleted files', async () => {
    const id = randomUUID();
    await service.sync(p.id, a.id, id, manifest());
    await service.sync(p.id, a.id, id, manifest(1));
    expect((await search(a.id))[0]!.revision).toBe(1);
    await service.sync(p.id, a.id, id, manifest(2, 'Venus contribution margin is revised.'));
    expect((await search(a.id, 'Venus'))[0]!.revision).toBe(2);
    expect((await search(a.id, 'Mercury')).every((item) => !item.text?.includes('Mercury'))).toBe(
      true,
    );
    await service.sync(p.id, a.id, id, { name: 'Research', expectedVersion: 3, files: [] });
    expect(await search(a.id)).toEqual([]);
    expect(await db.getRepository(KnowledgeChunk).count({ where: { projectId: p.id } })).toBe(0);
  });

  it('protects private text through general ingestion endpoints and rejects remote reindex', async () => {
    const id = randomUUID();
    await service.sync(p.id, a.id, id, manifest());
    const ingestion = new IngestionService(
      db.getRepository(KnowledgeSource),
      db.getRepository(KnowledgeChunk),
      db.getRepository(ProcessingJob),
      {} as StorageDriver,
      {} as OutboxService,
      new ConfigService({ AI_EMBEDDING_PROVIDER: 'disabled' }),
      db,
    );
    const own = await ingestion.listSources(p.id, {}, a.id);
    expect(own).toHaveLength(1);
    expect(await ingestion.listSources(p.id, {}, b.id)).toEqual([]);
    await expect(ingestion.getSource(p.id, own[0]!.id, b.id)).rejects.toThrow(NotFoundException);
    await expect(ingestion.getSource(other.id, own[0]!.id, a.id)).rejects.toThrow(
      NotFoundException,
    );
    await expect(ingestion.reindexSource(p.id, own[0]!.id, a.id)).rejects.toThrow(
      BadRequestException,
    );
    expect((await ingestion.getSource(p.id, own[0]!.id, a.id)).chunks[0]!.text).toContain(
      'Mercury',
    );
  });
  it('rejects unsafe paths, duplicates and oversized content without replacing the snapshot', async () => {
    const id = randomUUID();
    await service.sync(p.id, a.id, id, manifest());
    for (const path of ['../escape.md', 'node_modules/readme.md', 'C:/notes.md', 'a\\b.md']) {
      await expect(
        service.sync(p.id, a.id, id, { ...manifest(1), files: [{ path, text: 'unsafe' }] }),
      ).rejects.toThrow(BadRequestException);
    }
    await expect(
      service.sync(p.id, a.id, id, {
        ...manifest(1),
        files: [{ path: 'big.md', text: 'a'.repeat(131073) }],
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.sync(p.id, a.id, id, {
        ...manifest(1),
        files: [
          { path: 'a.md', text: 'a' },
          { path: 'A.md', text: 'b' },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
    expect((await service.list(p.id, a.id))[0]!.version).toBe(1);
    expect((await search(a.id))[0]!.text).toContain('Mercury');
  });
  it('serializes conflicting rescans and rejects stale versions', async () => {
    const id = randomUUID();
    await service.sync(p.id, a.id, id, manifest());
    const outcomes = await Promise.allSettled([
      service.sync(p.id, a.id, id, manifest(1, 'First revision')),
      service.sync(p.id, a.id, id, manifest(1, 'Second revision')),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find(
      (result) => result.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictException);
    expect((await service.list(p.id, a.id))[0]!.version).toBe(2);
  });
  it('purges the index on disconnect and rejects access after membership removal', async () => {
    const id = randomUUID();
    await service.sync(p.id, a.id, id, manifest());
    await db
      .getRepository(ProjectMember)
      .update({ projectId: p.id, userId: a.id }, { removedAt: new Date() });
    try {
      expect(await search(a.id)).toEqual([]);
      await expect(service.list(p.id, a.id)).rejects.toThrow(NotFoundException);
    } finally {
      await db
        .getRepository(ProjectMember)
        .update({ projectId: p.id, userId: a.id }, { removedAt: null });
    }
    await service.disconnect(p.id, a.id, id);
    expect(await db.getRepository(KnowledgeSource).count({ where: { projectId: p.id } })).toBe(0);
    expect(await search(a.id)).toEqual([]);
  });
  it('blocks archived mutations and deactivated accounts', async () => {
    await db.getRepository(Project).update(p.id, { status: ProjectStatus.ARCHIVED });
    try {
      await expect(service.sync(p.id, a.id, randomUUID(), manifest())).rejects.toThrow(
        BadRequestException,
      );
    } finally {
      await db.getRepository(Project).update(p.id, { status: ProjectStatus.ACTIVE });
    }
    await db.getRepository(User).update(a.id, { isActive: false });
    try {
      await expect(service.list(p.id, a.id)).rejects.toThrow(NotFoundException);
    } finally {
      await db.getRepository(User).update(a.id, { isActive: true });
    }
  });
});
