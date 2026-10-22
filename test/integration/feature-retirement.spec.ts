import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../../src/database/database-options';
import { User } from '../../src/modules/users/entities/user.entity';
import { Project } from '../../src/modules/projects/entities/project.entity';
import {
  KnowledgeChunk,
  KnowledgeSource,
  KnowledgeSourceStatus,
  KnowledgeSourceType,
} from '../../src/modules/ingestion/entities';
import { RetrievalService } from '../../src/modules/mavis/retrieval/retrieval.service';

describe('Retired knowledge sources with PostgreSQL', () => {
  jest.setTimeout(60000);
  let db: DataSource;
  let user: User;
  let project: Project;
  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (process.env.NODE_ENV !== 'test' || !url || !new URL(url).pathname.endsWith('_test'))
      throw new Error('Dedicated test database required.');
    db = await new DataSource(databaseOptions(url)).initialize();
    await db.runMigrations({ transaction: 'all' });
    user = await db.getRepository(User).save({
      email: `${randomUUID()}@retired.test`,
      displayName: 'Synthetic retirement test',
      passwordHash: 'synthetic-only',
    });
    project = await db.getRepository(Project).save({
      key: `R${randomUUID().slice(0, 7).toUpperCase()}`,
      name: 'Synthetic retirement test',
      createdBy: user.id,
    });
    for (const sourceType of [
      KnowledgeSourceType.DOCUMENT,
      KnowledgeSourceType.REQUIREMENT,
      KnowledgeSourceType.MEETING,
    ]) {
      const source = await db.getRepository(KnowledgeSource).save({
        projectId: project.id,
        sourceId: randomUUID(),
        sourceType,
        title: 'Retirementquartz evidence',
        status: KnowledgeSourceStatus.INDEXED,
        activeIndexVersion: 1,
      });
      await db.getRepository(KnowledgeChunk).save({
        projectId: project.id,
        knowledgeSourceId: source.id,
        indexVersion: 1,
        chunkIndex: 0,
        text: 'Retirementquartz evidence for the synthetic workspace.',
        tokenCount: 10,
        embedding: null,
      });
    }
  });
  afterAll(async () => {
    if (!db?.isInitialized) return;
    if (project) await db.getRepository(Project).delete(project.id);
    if (user) await db.getRepository(User).delete(user.id);
    await db.destroy();
  });
  it.each(['keyword', 'hybrid'] as const)(
    'excludes retired records from %s retrieval without deleting them',
    async (mode) => {
      const service = new RetrievalService(db);
      const results = await service.retrieve({
        actorId: user.id,
        projectId: project.id,
        query: 'Retirementquartz',
        mode,
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((item) => item.sourceType === KnowledgeSourceType.DOCUMENT)).toBe(true);
      expect(await db.getRepository(KnowledgeSource).countBy({ projectId: project.id })).toBe(3);
    },
  );
});
