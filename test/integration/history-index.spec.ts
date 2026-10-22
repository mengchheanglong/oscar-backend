import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../../src/database/database-options';
import { User } from '../../src/modules/users/entities/user.entity';
import { Project } from '../../src/modules/projects/entities/project.entity';
import {
  ProjectMember,
  ProjectRole,
} from '../../src/modules/projects/entities/project-member.entity';
import {
  AssistantMode,
  Conversation,
} from '../../src/modules/assistant/entities/conversation.entity';
import {
  ChatMessage,
  MessageRole,
  MessageStatus,
} from '../../src/modules/assistant/entities/chat-message.entity';
import {
  HistoryIndexRepository,
  HistoryIndexLimits,
} from '../../src/modules/assistant/context/history-index.repository';
import { HistoryIndexWorker } from '../../src/modules/assistant/context/history-index.worker';
import { HistoryVectorRepository } from '../../src/modules/assistant/context/history-vector.repository';
import { ConversationHistoryRepository } from '../../src/modules/assistant/context/conversation-history.repository';
import { embeddingIdentity } from '../../src/modules/assistant/memory/private-memory.contract';
import { historyEmbeddingIdentity } from '../../src/modules/assistant/context/history-retrieval.contract';

describe('Durable automatic history indexing with PostgreSQL', () => {
  let db: DataSource, jobs: HistoryIndexRepository;
  let user: User, other: User, project: Project, conversation: Conversation;
  let day: string;
  let initial: { calls: number; texts: number; input_bytes: number } | undefined;
  let identity: string;
  const vector = () => [1, ...Array<number>(1535).fill(0)];
  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (process.env.NODE_ENV !== 'test' || !url || !new URL(url).pathname.endsWith('_test'))
      throw new Error('Dedicated test database required');
    db = await new DataSource(databaseOptions(url)).initialize();
    await db.runMigrations({ transaction: 'all' });
    jobs = new HistoryIndexRepository(db);
    day = (await db.query("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS day"))[0]
      .day;
    initial = (
      await db.query(
        "SELECT calls,texts,input_bytes FROM ai_history_index_usage WHERE day=$1 AND scope_key='global'",
        [day],
      )
    )[0];
  });
  beforeEach(async () => {
    identity = historyEmbeddingIdentity(embeddingIdentity('synthetic', randomUUID()));
    user = await db.getRepository(User).save({
      email: `${randomUUID()}@index.test`,
      displayName: 'Indexer owner',
      passwordHash: 'synthetic',
    });
    other = await db.getRepository(User).save({
      email: `${randomUUID()}@index.test`,
      displayName: 'Other member',
      passwordHash: 'synthetic',
    });
    project = await db.getRepository(Project).save({
      key: 'I' + randomUUID().slice(0, 7).toUpperCase(),
      name: 'Index fixture',
      createdBy: user.id,
    });
    await db.getRepository(ProjectMember).save([
      { projectId: project.id, userId: user.id, accessRole: ProjectRole.OWNER },
      { projectId: project.id, userId: other.id, accessRole: ProjectRole.VIEWER },
    ]);
    conversation = await db
      .getRepository(Conversation)
      .save({ projectId: project.id, userId: user.id, title: 'Index fixture' });
  });
  afterEach(async () => {
    await db.query('DELETE FROM ai_history_index_usage WHERE scope_key=ANY($1::text[])', [
      [`${project.id}:${user.id}`, `${project.id}:${other.id}`],
    ]);
    await db.getRepository(Project).delete(project.id);
    await db.getRepository(User).delete([user.id, other.id]);
  });
  afterAll(async () => {
    if (!db?.isInitialized) return;
    try {
      if (initial)
        await db.query(
          "UPDATE ai_history_index_usage SET calls=$2,texts=$3,input_bytes=$4 WHERE day=$1 AND scope_key='global'",
          [day, initial.calls, initial.texts, initial.input_bytes],
        );
      else
        await db.query("DELETE FROM ai_history_index_usage WHERE day=$1 AND scope_key='global'", [
          day,
        ]);
    } finally {
      await db.destroy();
    }
  });
  const scope = () => ({ projectId: project.id, userId: user.id, conversationId: conversation.id });
  const message = (content = 'Synthetic indexing fact.') =>
    db.getRepository(ChatMessage).save({
      conversationId: conversation.id,
      role: MessageRole.USER,
      content,
      mode: AssistantMode.WORKSPACE,
    });
  async function limits(texts = 100, bytes = 100000): Promise<HistoryIndexLimits> {
    const used = (
      await db.query(
        "SELECT texts,input_bytes FROM ai_history_index_usage WHERE day=$1 AND scope_key='global'",
        [day],
      )
    )[0] ?? { texts: 0, input_bytes: 0 };
    return {
      globalTexts: used.texts + texts,
      globalBytes: used.input_bytes + bytes,
      scopeTexts: texts,
      scopeBytes: bytes,
    };
  }
  it('reserves once under concurrent replicas and persists leases across repository recreation', async () => {
    const m = await message();
    const cap = await limits(1);
    const claims = await Promise.all([
      jobs.claim(identity, cap),
      new HistoryIndexRepository(db).claim(identity, cap),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)!.rows.map((r) => r.messageId)).toEqual([m.id]);
    expect(await new HistoryIndexRepository(db).claim(identity, cap)).toBeNull();
    const usage = await db.query(
      'SELECT calls,texts FROM ai_history_index_usage WHERE day=$1 AND scope_key=$2',
      [day, `${project.id}:${user.id}`],
    );
    expect(usage).toEqual([{ calls: 1, texts: 1 }]);
  });
  it('enforces UTF-8 byte caps and allows another owner after one scope exhausts its allowance', async () => {
    await message('ก'.repeat(30));
    expect(await jobs.claim(identity, await limits(5, 89))).toBeNull();
    const foreign = await db
      .getRepository(Conversation)
      .save({ projectId: project.id, userId: other.id, title: 'Other owner' });
    await db.getRepository(ChatMessage).save({
      conversationId: foreign.id,
      role: MessageRole.USER,
      content: 'Other private fact.',
      mode: AssistantMode.WORKSPACE,
    });
    const cap = await limits(10);
    cap.scopeTexts = 1;
    const first = (await jobs.claim(identity, cap))!;
    expect(first.scope.userId).toBe(user.id);
    expect((await jobs.claim(identity, cap))!.scope.userId).toBe(other.id);
    await message('Later owner fact.');
    expect(await jobs.claim(identity, cap)).toBeNull();
  });
  it('retries with backoff, charges failed reservations, and stops after three attempts', async () => {
    const m = await message();
    const cap = await limits();
    for (let attempt = 1; attempt <= 3; attempt++) {
      const claim = (await jobs.claim(identity, cap))!;
      expect(claim.rows[0]!.messageId).toBe(m.id);
      await jobs.finish(claim, true);
      expect(await jobs.claim(identity, cap)).toBeNull();
      await db.query(
        "UPDATE ai_history_index_jobs SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE lease_id=$1",
        [claim.lease],
      );
    }
    expect(await jobs.claim(identity, cap)).toBeNull();
    expect(
      (
        await db.query(
          'SELECT calls,texts FROM ai_history_index_usage WHERE day=$1 AND scope_key=$2',
          [day, `${project.id}:${user.id}`],
        )
      )[0],
    ).toEqual({ calls: 3, texts: 3 });
  });

  it('shares the global allowance across model changes and ignores previous UTC-day usage', async () => {
    await message();
    await db.query(
      `INSERT INTO ai_history_index_usage(day,scope_key,calls,texts,input_bytes)
      VALUES($1::date-1,$2,100,100000,10000000)`,
      [day, `${project.id}:${user.id}`],
    );
    const cap = await limits(1);
    expect(await jobs.claim(identity, cap)).not.toBeNull();
    expect(await jobs.claim(historyEmbeddingIdentity('new-model'), cap)).toBeNull();
    expect(await jobs.claim(identity, { ...cap, globalBytes: 0 })).toBeNull();
  });
  it('recovers expired claims, fences old completion, and permits a changed model or source', async () => {
    const m = await message();
    const cap = await limits();
    const old = (await jobs.claim(identity, cap))!;
    await db.query(
      "UPDATE ai_history_index_jobs SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE lease_id=$1",
      [old.lease],
    );
    const current = (await new HistoryIndexRepository(db).claim(identity, cap))!;
    expect(await jobs.owns(old)).toBe(false);
    await jobs.finish(old, true);
    expect(await jobs.owns(current)).toBe(true);
    const nextIdentity = historyEmbeddingIdentity(embeddingIdentity('synthetic', 'new-model'));
    expect((await jobs.claim(nextIdentity, cap))!.rows[0]!.messageId).toBe(m.id);
    await db
      .getRepository(ChatMessage)
      .update(m.id, { content: 'Edited source for new indexing attempt.' });
    expect(await jobs.sources(current)).toEqual([]);
    expect((await jobs.claim(identity, cap))!.rows[0]!.content).toBe(
      'Edited source for new indexing attempt.',
    );
  });
  it('skips excluded, failed, deleted and inactive sources, including revocation after claim', async () => {
    const excluded = await message(),
      failed = await message();
    await db.getRepository(ChatMessage).update(excluded.id, { contextExcluded: true });
    await db.getRepository(ChatMessage).update(failed.id, { status: MessageStatus.FAILED });
    expect(await jobs.claim(identity, await limits())).toBeNull();
    await message('Eligible before revocation.');
    const batch = (await jobs.claim(identity, await limits()))!;
    await db
      .getRepository(ProjectMember)
      .update({ projectId: project.id, userId: user.id }, { removedAt: new Date() });
    expect(await jobs.sources(batch)).toEqual([]);
    expect(await jobs.claim(identity, await limits())).toBeNull();
    await db
      .getRepository(ProjectMember)
      .update({ projectId: project.id, userId: user.id }, { removedAt: null });
    await db.getRepository(User).update(user.id, { isActive: false });
    expect(await jobs.claim(identity, await limits())).toBeNull();
    await db.getRepository(User).update(user.id, { isActive: true });
    await new ConversationHistoryRepository(db).exclude(scope());
    expect(await jobs.sources(batch)).toEqual([]);
  });
  it('indexes new messages without manual batches and blocks activation during an exclusion race', async () => {
    await message('First automatically indexed fact.');
    const provider = {
      identity: embeddingIdentity('synthetic', randomUUID()),
      embed: jest.fn(async (texts: string[]) => texts.map(vector)),
    };
    const config = new ConfigService({
      AI_ENABLED: true,
      AI_HISTORY_AUTO_INDEX_ENABLED: true,
      AI_HISTORY_INDEX_DAILY_TEXTS: 100000,
      AI_HISTORY_INDEX_DAILY_BYTES: 10000000,
    });
    const vectors = new HistoryVectorRepository(db);
    const worker = new HistoryIndexWorker(config, jobs, vectors, provider);
    expect(await worker.tick()).toBe(1);
    expect(await worker.tick()).toBe(0);
    const added = await message('Second automatically indexed fact.');
    expect(await worker.tick()).toBe(1);
    expect(provider.embed).toHaveBeenCalledTimes(2);
    expect(
      (
        await db.query('SELECT count(*)::int AS n FROM ai_history_vectors WHERE project_id=$1', [
          project.id,
        ])
      )[0].n,
    ).toBe(2);
    await message('Excluded during embedding.');
    provider.embed.mockImplementationOnce(async (texts) => {
      await new ConversationHistoryRepository(db).exclude(scope());
      return texts.map(vector);
    });
    await worker.tick();
    expect(
      (
        await db.query('SELECT count(*)::int AS n FROM ai_history_vectors WHERE project_id=$1', [
          project.id,
        ])
      )[0].n,
    ).toBe(0);
    expect(
      (
        await db.query('SELECT count(*)::int AS n FROM ai_history_index_jobs WHERE message_id=$1', [
          added.id,
        ])
      )[0].n,
    ).toBe(1);
    await worker.onModuleDestroy();
  });
});
