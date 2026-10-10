import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { databaseOptions } from '../../src/database/database-options';
import { UploadedFoldersService } from '../../src/modules/local-folders/uploaded-folders.service';
import { UploadedFile } from '../../src/modules/local-folders/entities/uploaded-file.entity';
import { LocalStorageService } from '../../src/modules/storage/local-storage.service';
import { LocalFoldersService } from '../../src/modules/local-folders/local-folders.service';
import { User } from '../../src/modules/users/entities/user.entity';
import { Project } from '../../src/modules/projects/entities/project.entity';
import {
  ProjectMember,
  ProjectRole,
} from '../../src/modules/projects/entities/project-member.entity';
import { RetrievalService } from '../../src/modules/ai/retrieval/retrieval.service';
import { KnowledgeSource } from '../../src/modules/ingestion/entities';
describe('Persistent private folder uploads', () => {
  let db: DataSource,
    service: UploadedFoldersService,
    storage: LocalStorageService,
    root: string,
    a: User,
    b: User,
    p: Project;
  const file = (buffer: Buffer) => ({ buffer, size: buffer.length }) as Express.Multer.File;
  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (process.env.NODE_ENV !== 'test' || !url || !new URL(url).pathname.endsWith('_test'))
      throw new Error('Dedicated test database required.');
    db = await new DataSource(databaseOptions(url)).initialize();
    await db.runMigrations({ transaction: 'all' });
    root = await fs.mkdtemp(join(tmpdir(), 'aiw-upload-test-'));
    storage = new LocalStorageService(new ConfigService({ STORAGE_LOCAL_ROOT: root }));
    service = new UploadedFoldersService(db, storage);
    a = await db
      .getRepository(User)
      .save({ email: `${randomUUID()}@upload.test`, displayName: 'A', passwordHash: 'synthetic' });
    b = await db
      .getRepository(User)
      .save({ email: `${randomUUID()}@upload.test`, displayName: 'B', passwordHash: 'synthetic' });
    p = await db.getRepository(Project).save({
      key: `U${randomUUID().slice(0, 7).toUpperCase()}`,
      name: 'Upload test',
      createdBy: a.id,
    });
    await db.getRepository(ProjectMember).save([
      { projectId: p.id, userId: a.id, accessRole: ProjectRole.OWNER },
      { projectId: p.id, userId: b.id, accessRole: ProjectRole.VIEWER },
    ]);
  });
  afterAll(async () => {
    if (db?.isInitialized) {
      if (p) await db.getRepository(Project).delete(p.id);
      if (a && b) await db.getRepository(User).delete({ id: In([a.id, b.id]) });
      await db.destroy();
    }
    if (
      root &&
      resolve(root).startsWith(resolve(tmpdir()) + sep) &&
      root.includes('aiw-upload-test-')
    )
      await fs.rm(root, { recursive: true, force: true });
  });
  it('publishes only complete uploads, keeps originals and isolates evidence and downloads', async () => {
    const folder = await service.create(p.id, a.id, 'Research', 2);
    const raw = Buffer.from('Mercury persistent pricing assumptions');
    const first = await service.put(p.id, a.id, folder.id, 'finance/notes.custom', file(raw));
    expect(await service.put(p.id, a.id, folder.id, 'finance/notes.custom', file(raw))).toEqual(
      first,
    );
    expect(await db.getRepository(UploadedFile).countBy({ folderId: folder.id })).toBe(1);
    const retrieval = new RetrievalService(db);
    expect(
      await retrieval.retrieve({
        projectId: p.id,
        actorId: a.id,
        query: 'Mercury',
        mode: 'keyword',
      }),
    ).toEqual([]);
    await expect(service.complete(p.id, a.id, folder.id)).rejects.toThrow(ConflictException);
    await expect(service.read(p.id, a.id, folder.id, 'finance/notes.custom')).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      service.put(p.id, a.id, folder.id, 'finance/notes.custom', file(Buffer.from('changed'))),
    ).rejects.toThrow(ConflictException);
    const binary = Buffer.from([0, 1, 255, 128, 6]);
    const second = await service.put(p.id, a.id, folder.id, 'assets/raw.bin', file(binary));
    await service.complete(p.id, a.id, folder.id);
    await service.complete(p.id, a.id, folder.id);
    expect(
      (
        await retrieval.retrieve({
          projectId: p.id,
          actorId: a.id,
          query: 'Mercury',
          mode: 'keyword',
        })
      )[0]?.title,
    ).toBe('finance/notes.custom');
    expect(
      await retrieval.retrieve({
        projectId: p.id,
        actorId: b.id,
        query: 'Mercury',
        mode: 'keyword',
      }),
    ).toEqual([]);
    expect(await service.list(p.id, b.id)).toEqual([]);
    await expect(service.download(p.id, b.id, folder.id, first.id)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.files(randomUUID(), a.id, folder.id)).rejects.toThrow(NotFoundException);
    await expect(service.create(p.id, b.id, 'Denied', 1)).rejects.toThrow(ForbiddenException);
    expect((await service.read(p.id, a.id, folder.id, 'finance/notes.custom')).text).toBe(
      raw.toString(),
    );
    expect((await service.read(p.id, a.id, folder.id, 'assets/raw.bin')).text).toBeNull();
    expect((await service.search(p.id, a.id, folder.id, 'Mercury')).matches).toHaveLength(1);
    const original = await service.download(p.id, a.id, folder.id, second.id);
    const chunks: Buffer[] = [];
    for await (const chunk of original.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(binary);
    expect(await new LocalFoldersService(db).list(p.id, a.id)).toEqual([]);
    await expect(new LocalFoldersService(db).disconnect(p.id, a.id, folder.id)).rejects.toThrow(
      NotFoundException,
    );
    const stored = await db.getRepository(UploadedFile).findBy({ folderId: folder.id });
    await service.remove(p.id, a.id, folder.id);
    expect(await db.getRepository(KnowledgeSource).countBy({ localFolderId: folder.id })).toBe(0);
    for (const item of stored) expect(await storage.exists(item.storageKey)).toBe(false);
  });
  it('removes candidate blobs when database persistence fails', async () => {
    const folder = await service.create(p.id, a.id, 'Rollback', 1);
    const save = jest.spyOn(storage, 'save');
    jest.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('Synthetic database failure'));
    await expect(
      service.put(p.id, a.id, folder.id, 'notes.txt', file(Buffer.from('Original'))),
    ).rejects.toThrow('Synthetic database failure');
    expect(await db.getRepository(UploadedFile).countBy({ folderId: folder.id })).toBe(0);
    for (const [key] of save.mock.calls) expect(await storage.exists(key)).toBe(false);
    save.mockRestore();
    await service.remove(p.id, a.id, folder.id);
  });

  it('supports more than 100 files with paging and rejects traversal without creating metadata', async () => {
    const folder = await service.create(p.id, a.id, 'Large folder', 101);
    for (const path of ['../secret', '/absolute', 'C:/secret', 'a\\b', 'a//b'])
      await expect(
        service.put(p.id, a.id, folder.id, path, file(Buffer.from('text'))),
      ).rejects.toThrow(BadRequestException);
    for (let i = 0; i < 101; i++)
      await service.put(
        p.id,
        a.id,
        folder.id,
        `notes/${String(i).padStart(3, '0')}`,
        file(Buffer.from(`Note ${i}`)),
      );
    await service.complete(p.id, a.id, folder.id);
    expect((await service.files(p.id, a.id, folder.id)).files).toHaveLength(100);
    expect((await service.files(p.id, a.id, folder.id)).nextOffset).toBe(100);
    expect((await service.files(p.id, a.id, folder.id, '', 100)).files).toHaveLength(1);
    await service.remove(p.id, a.id, folder.id);
  }, 60000);
});
