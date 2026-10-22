import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../../src/database/database-options';
import { User } from '../../src/modules/users/entities/user.entity';
import { Project } from '../../src/modules/projects/entities/project.entity';
import {
  ProjectMember,
  ProjectRole,
} from '../../src/modules/projects/entities/project-member.entity';
import { Document, ProcessingStatus } from '../../src/modules/documents/entities/document.entity';
import { Decision } from '../../src/modules/decisions/entities/decision.entity';
import { Task } from '../../src/modules/tasks/entities/task.entity';
import {
  KnowledgeChunk,
  KnowledgeSource,
  KnowledgeSourceStatus,
  KnowledgeSourceType,
} from '../../src/modules/ingestion/entities';
import { LocalFolder } from '../../src/modules/local-folders/entities/local-folder.entity';
import { RetrievalService } from '../../src/modules/mavis/retrieval/retrieval.service';
import { SearchService } from '../../src/modules/search/search.service';
import { SearchEntityType } from '../../src/modules/search/dto/search.dto';

describe('Search against PostgreSQL', () => {
  let db: DataSource,
    service: SearchService,
    owner: User,
    viewer: User,
    project: Project,
    doc: Document;
  let privateSource: KnowledgeSource;
  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (
      process.env.NODE_ENV !== 'test' ||
      !url ||
      new URL(url).port !== '55433' ||
      !new URL(url).pathname.endsWith('_test')
    )
      throw new Error('Dedicated local test database required.');
    db = await new DataSource(databaseOptions(url)).initialize();
    await db.runMigrations({ transaction: 'all' });
    [owner, viewer] = (await db.getRepository(User).save(
      ['owner', 'viewer'].map((displayName) => ({
        email: `${randomUUID()}@search.test`,
        displayName,
        passwordHash: 'synthetic-only',
      })),
    )) as [User, User];
    project = await db.getRepository(Project).save({
      key: `S${randomUUID().slice(0, 7).toUpperCase()}`,
      name: 'Search QA',
      createdBy: owner.id,
    });
    await db.getRepository(ProjectMember).save([
      { projectId: project.id, userId: owner.id, accessRole: ProjectRole.OWNER },
      { projectId: project.id, userId: viewer.id, accessRole: ProjectRole.VIEWER },
    ]);
    doc = await db.getRepository(Document).save({
      projectId: project.id,
      title: 'Plain filename',
      originalFilename: 'notes.txt',
      storageKey: 'synthetic-only',
      mimeType: 'text/plain',
      sizeBytes: 10,
      sha256: 'a'.repeat(64),
      createdBy: owner.id,
      updatedBy: owner.id,
      processingStatus: ProcessingStatus.COMPLETED,
    });
    const folder = await db.getRepository(LocalFolder).save({
      id: randomUUID(),
      projectId: project.id,
      userId: owner.id,
      name: 'Private folder',
    });
    for (const sourceType of [KnowledgeSourceType.DOCUMENT, KnowledgeSourceType.LOCAL_FILE]) {
      const source = await db.getRepository(KnowledgeSource).save({
        projectId: project.id,
        sourceId: sourceType === KnowledgeSourceType.DOCUMENT ? doc.id : randomUUID(),
        sourceType,
        title: sourceType === KnowledgeSourceType.DOCUMENT ? doc.title : 'Private folder notes',
        ownerId: sourceType === KnowledgeSourceType.LOCAL_FILE ? owner.id : null,
        status: KnowledgeSourceStatus.INDEXED,
        activeIndexVersion: 2,
        localFolderId: sourceType === KnowledgeSourceType.LOCAL_FILE ? folder.id : null,
      });
      if (sourceType === KnowledgeSourceType.LOCAL_FILE) privateSource = source;
      for (let chunkIndex = 0; chunkIndex < 2; chunkIndex++) {
        await db.getRepository(KnowledgeChunk).save({
          projectId: project.id,
          knowledgeSourceId: source.id,
          indexVersion: 2,
          chunkIndex,
          text:
            sourceType === KnowledgeSourceType.DOCUMENT
              ? 'Documentbodyquartz launch code exists only inside this file.'
              : 'Privatefoldercobalt private evidence.',
          tokenCount: 10,
          embedding: null,
          metadata: { relativePath: 'nested/notes.txt', folderName: 'Research' },
        });
      }
      await db.getRepository(KnowledgeChunk).save({
        projectId: project.id,
        knowledgeSourceId: source.id,
        indexVersion: 1,
        chunkIndex: 0,
        text: 'Obsoleteindexamber no longer valid',
        tokenCount: 5,
        embedding: null,
      });
    }
    service = new SearchService(
      db.getRepository(Project),
      db.getRepository(Decision),
      db.getRepository(Task),
      db.getRepository(Document),
      new RetrievalService(db),
      db,
    );
  });
  afterAll(async () => {
    if (!db?.isInitialized) return;
    if (project) await db.getRepository(Project).delete(project.id);
    if (owner) await db.getRepository(User).delete(owner.id);
    if (viewer) await db.getRepository(User).delete(viewer.id);
    await db.destroy();
  });
  it('finds document body text once, preserves the live status/date and does not fall back on an empty match', async () => {
    const result = await service.search(
      project.id,
      { q: 'Documentbodyquartz', mode: 'keyword' },
      owner.id,
    );
    expect(result.meta.total).toBe(1);
    expect(result.meta.countsByType.DOCUMENT).toBe(1);
    expect(result.data[0]).toMatchObject({
      id: doc.id,
      status: ProcessingStatus.COMPLETED,
      updatedAt: doc.updatedAt,
    });
    expect(result.data[0]!.snippet).toContain('Documentbodyquartz');
    for (const q of ['Noresultsunobtainium', 'Obsoleteindexamber']) {
      expect((await service.search(project.id, { q, mode: 'keyword' }, owner.id)).meta.total).toBe(
        0,
      );
    }
    const hybridMiss = await service.search(
      project.id,
      { q: 'Hybridnomatchunobtainium', mode: 'hybrid' },
      owner.id,
    );
    expect(hybridMiss.meta.total).toBe(0);
    expect(hybridMiss.data).toEqual([]);
  });
  it.each(['keyword', 'hybrid'] as const)(
    'includes owned folder files in the Documents filter with %s and excludes other members',
    async (mode) => {
      const query = { q: 'Privatefoldercobalt', mode, type: SearchEntityType.DOCUMENT };
      const result = await service.search(project.id, query, owner.id);
      expect(result.data.some((item) => item.id === privateSource.sourceId)).toBe(true);
      expect(
        result.data.find((item) => item.id === privateSource.sourceId)?.metadata,
      ).toMatchObject({
        sourceType: 'LOCAL_FILE',
        folderId: privateSource.localFolderId,
        relativePath: 'nested/notes.txt',
      });
      expect(
        (await service.search(project.id, query, viewer.id)).data.some(
          (item) => item.id === privateSource.sourceId,
        ),
      ).toBe(false);
      expect(result.meta.countsByType.DOCUMENT).toBe(result.meta.total);
    },
  );
  it.each(['keyword', 'hybrid'] as const)(
    'honors status/date/assignee filters and paginates distinct sources in %s',
    async (mode) => {
      for (const filter of [
        { status: 'FAILED' },
        { startDate: '2100-01-01T00:00:00Z' },
        { endDate: '2000-01-01T00:00:00Z' },
        { assigneeId: owner.id },
      ]) {
        const result = await service.search(
          project.id,
          { q: 'Documentbodyquartz', mode, ...filter },
          owner.id,
        );
        expect(result.meta.total).toBe(0);
      }
      const result = await service.search(
        project.id,
        { q: 'Documentbodyquartz', mode, page: 2, pageSize: 1 },
        viewer.id,
      );
      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(1);
    },
  );
});
