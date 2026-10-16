import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../../src/database/database-options';
import {
  ConversationContextService,
  ConversationScope,
} from '../../src/modules/ai/context/conversation-context.service';
import { ConversationHistoryRepository } from '../../src/modules/ai/context/conversation-history.repository';
import { HistoryRecallService } from '../../src/modules/ai/context/history-recall.service';
import { HistoryVectorRepository } from '../../src/modules/ai/context/history-vector.repository';
import { historyEmbeddingIdentity } from '../../src/modules/ai/context/history-retrieval.contract';
import { embeddingIdentity } from '../../src/modules/ai/memory/private-memory.contract';
import {
  evaluateHistoryRecall,
  syntheticHistoryEmbedder,
} from '../fixtures/history-recall-evaluation';
import { LlmProvider } from '../../src/modules/ai/llm/llm-provider.interface';
import { AiMode, Conversation } from '../../src/modules/ai/entities/conversation.entity';
import { ChatMessage, MessageRole } from '../../src/modules/ai/entities/chat-message.entity';
import { User } from '../../src/modules/users/entities/user.entity';
import { Project } from '../../src/modules/projects/entities/project.entity';
import {
  ProjectMember,
  ProjectRole,
} from '../../src/modules/projects/entities/project-member.entity';

describe('Conversation history recall and privacy with PostgreSQL', () => {
  let db: DataSource;
  let user: User, other: User, project: Project, foreign: Project;
  let history: ConversationHistoryRepository;
  let context: ConversationContextService;
  const provider = {
    generateStructuredOutput: async () => ({
      data: { summary: 'Scripted historical summary.' },
      modelName: 'scripted',
      promptTokens: 1,
      completionTokens: 1,
    }),
  } as unknown as LlmProvider;
  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (process.env.NODE_ENV !== 'test' || !url || !new URL(url).pathname.endsWith('_test'))
      throw new Error('Use the dedicated test database.');
    db = await new DataSource(databaseOptions(url)).initialize();
    await db.runMigrations({ transaction: 'all' });
    const users = db.getRepository(User);
    user = await users.save(
      users.create({
        email: `${randomUUID()}@history.test`,
        displayName: 'History owner',
        passwordHash: 'synthetic',
      }),
    );
    other = await users.save(
      users.create({
        email: `${randomUUID()}@history.test`,
        displayName: 'Other owner',
        passwordHash: 'synthetic',
      }),
    );
    const projects = db.getRepository(Project);
    project = await projects.save(
      projects.create({
        key: 'H' + randomUUID().slice(0, 7).toUpperCase(),
        name: 'History',
        createdBy: user.id,
      }),
    );
    foreign = await projects.save(
      projects.create({
        key: 'H' + randomUUID().slice(0, 7).toUpperCase(),
        name: 'Other',
        createdBy: other.id,
      }),
    );
    const members = db.getRepository(ProjectMember);
    await members.save([
      members.create({ projectId: project.id, userId: user.id, accessRole: ProjectRole.OWNER }),
      members.create({ projectId: project.id, userId: other.id, accessRole: ProjectRole.VIEWER }),
      members.create({ projectId: foreign.id, userId: other.id, accessRole: ProjectRole.OWNER }),
    ]);
    history = new ConversationHistoryRepository(db);
    context = new ConversationContextService(
      db,
      new ConfigService({ AI_CHAT_MODEL: 'deepseek-v4-pro' }),
      provider,
      history,
      new HistoryRecallService(history, new HistoryVectorRepository(db), null),
    );
  }, 30000);
  afterAll(async () => {
    if (!db?.isInitialized) return;
    try {
      if (project) await db.getRepository(Project).delete(project.id);
      if (foreign) await db.getRepository(Project).delete(foreign.id);
      if (user) await db.getRepository(User).delete(user.id);
      if (other) await db.getRepository(User).delete(other.id);
    } finally {
      await db.destroy();
    }
  });
  async function conversation(
    projectId = project.id,
    userId = user.id,
  ): Promise<ConversationScope> {
    const c = await db
      .getRepository(Conversation)
      .save({ projectId, userId, title: 'Synthetic history' });
    return { projectId, userId, conversationId: c.id };
  }
  const message = (s: ConversationScope, content: string, role = MessageRole.USER) =>
    db
      .getRepository(ChatMessage)
      .save({ conversationId: s.conversationId, role, content, mode: AiMode.WORKSPACE });

  it('measures keyword versus hybrid retrieval across the controlled evaluation corpus', async () => {
    const report = await evaluateHistoryRecall(
      db,
      syntheticHistoryEmbedder(),
      'synthetic_pipeline',
    );
    expect(report.kind).toBe('synthetic_pipeline');
    expect(report.summary.find((r) => r.mode === 'keyword')?.passed).toBe(5);
    expect(report.summary.find((r) => r.mode === 'hybrid')?.passed).toBe(8);
    expect(report.summary.every((r) => r.forbiddenSelected === 0)).toBe(true);
    expect(report.usage.calls).toBeLessThanOrEqual(report.limits.maxCalls);
  });

  it('enforces dimensions, owner references, source freshness and model isolation', async () => {
    const source = await conversation(),
      target = await conversation();
    const saved = await message(source, 'Plum silence setting.');
    const vectors = new HistoryVectorRepository(db);
    const row = {
      messageId: saved.id,
      conversationId: source.conversationId,
      role: 'user' as const,
      content: saved.content,
    };
    const identity = historyEmbeddingIdentity(embeddingIdentity('synthetic', randomUUID()));
    const vector = [1, ...Array<number>(1535).fill(0)];
    await vectors.activate(source, row, identity, randomUUID(), vector);
    expect((await vectors.semantic(target, identity, '0', vector)).map((r) => r.messageId)).toEqual(
      [saved.id],
    );
    expect(await vectors.hasVectors(target, historyEmbeddingIdentity('other-model'), '0')).toBe(
      false,
    );
    expect(
      await vectors.semantic({ ...target, userId: other.id }, identity, '0', vector),
    ).toHaveLength(0);
    await expect(
      db.query('UPDATE ai_history_vectors SET embedding=$1::vector WHERE message_id=$2', [
        '[1,0]',
        saved.id,
      ]),
    ).rejects.toThrow();
    await expect(
      db.query('UPDATE ai_history_vectors SET user_id=$1 WHERE message_id=$2', [
        other.id,
        saved.id,
      ]),
    ).rejects.toThrow();
    await db.getRepository(ChatMessage).update(saved.id, { content: 'Changed source.' });
    expect(await vectors.hasVectors(target, identity, '0')).toBe(false);
    await vectors.activate(source, row, identity, randomUUID(), vector);
    expect(await vectors.hasVectors(target, identity, '0')).toBe(false);
  });

  it('falls back only for embedding errors and rechecks access after external work', async () => {
    const source = await conversation(),
      target = await conversation();
    const saved = await message(source, 'Guava checkpoint retained.');
    const vectors = new HistoryVectorRepository(db);
    const providerId = embeddingIdentity('synthetic', randomUUID()),
      identity = historyEmbeddingIdentity(providerId);
    const vector = [1, ...Array<number>(1535).fill(0)];
    await vectors.activate(
      source,
      {
        messageId: saved.id,
        conversationId: source.conversationId,
        role: MessageRole.USER,
        content: saved.content,
      },
      identity,
      randomUUID(),
      vector,
    );
    const fallback = new HistoryRecallService(history, vectors, {
      identity: providerId,
      embed: async () => {
        throw new Error('Unavailable');
      },
    });
    expect(
      (await fallback.select(target, 'guava checkpoint', '0')).map((r) => r.messageId),
    ).toContain(saved.id);
    const revoked = new HistoryRecallService(history, vectors, {
      identity: providerId,
      embed: async () => {
        await db.getRepository(User).update(user.id, { isActive: false });
        return [vector];
      },
    });
    try {
      await expect(revoked.select(target, 'guava checkpoint', '0')).rejects.toThrow(
        NotFoundException,
      );
    } finally {
      await db.getRepository(User).update(user.id, { isActive: true });
    }
    await context.excludeMessage(source, saved.id);
    expect(
      await db.query('SELECT 1 FROM ai_history_vectors WHERE message_id=$1', [saved.id]),
    ).toHaveLength(0);
  });

  it('never activates excluded sources during indexing and supports explicit model re-indexing', async () => {
    const source = await conversation();
    const saved = await message(source, 'Apricot indexing source.');
    const vectors = new HistoryVectorRepository(db),
      providerId = embeddingIdentity('synthetic', randomUUID());
    const vector = [1, ...Array<number>(1535).fill(0)];
    const delayed = new HistoryRecallService(history, vectors, {
      identity: providerId,
      embed: async (texts) => {
        await context.excludeMessage(source, saved.id);
        return texts.map(() => vector);
      },
    });
    expect((await delayed.indexBatch(source)).attempted).toBeLessThanOrEqual(32);
    expect(
      await db.query('SELECT 1 FROM ai_history_vectors WHERE message_id=$1', [saved.id]),
    ).toHaveLength(0);
    const fresh = await message(source, 'Apricot replacement source.');
    const row = {
      messageId: fresh.id,
      conversationId: source.conversationId,
      role: 'user' as const,
      content: fresh.content,
    };
    await vectors.activate(source, row, historyEmbeddingIdentity(providerId), randomUUID(), vector);
    const nextIdentity = historyEmbeddingIdentity(embeddingIdentity('synthetic', 'next-model'));
    expect((await vectors.pending(source, nextIdentity)).map((r) => r.messageId)).toContain(
      fresh.id,
    );
    await vectors.activate(source, row, nextIdentity, randomUUID(), vector);
    expect(
      await db.query('SELECT embedding_identity FROM ai_history_vectors WHERE message_id=$1', [
        fresh.id,
      ]),
    ).toHaveLength(2);
    const concurrent = await message(source, 'Apricot concurrent exclusion.');
    await Promise.all([
      vectors.activate(
        source,
        {
          messageId: concurrent.id,
          conversationId: source.conversationId,
          role: 'user',
          content: concurrent.content,
        },
        nextIdentity,
        randomUUID(),
        vector,
      ),
      context.excludeMessage(source, concurrent.id),
    ]);
    expect(
      await db.query('SELECT 1 FROM ai_history_vectors WHERE message_id=$1', [concurrent.id]),
    ).toHaveLength(0);
    await context.deleteConversation(source);
    expect(
      await db.query('SELECT 1 FROM ai_history_vectors WHERE conversation_id=$1', [
        source.conversationId,
      ]),
    ).toHaveLength(0);
  });

  it('finds old private dialogue across chats with bounded provenance and tenant filters', async () => {
    const source = await conversation(),
      target = await conversation();
    const saved = await message(source, 'Pineapple checkpoint is 2040-04-17.');
    const foreignUser = await conversation(project.id, other.id);
    await message(foreignUser, 'Pineapple private colleague secret.');
    const foreignProject = await conversation(foreign.id, other.id);
    await message(foreignProject, 'Pineapple other project secret.');
    const current = await message(target, 'What was the pineapple checkpoint?');
    const prepared = await context.prepare(target, current.id, 'System');
    expect(prepared.excerpts.map((e) => e.messageId)).toEqual([saved.id]);
    expect(
      prepared.messages.find((m) => m.content.includes('Relevant older dialogue'))?.content,
    ).toContain('2040-04-17');
    const answer = db.getRepository(ChatMessage).create({
      conversationId: target.conversationId,
      role: MessageRole.ASSISTANT,
      mode: AiMode.WORKSPACE,
      content: 'Pineapple checkpoint is 2040-04-17.',
    });
    await context.commit(target, prepared, answer);
    expect(
      await db.query(
        'SELECT 1 FROM ai_history_dependencies WHERE conversation_id=$1 AND source_conversation_id=$2',
        [target.conversationId, source.conversationId],
      ),
    ).toHaveLength(1);
    expect(JSON.stringify(prepared.excerpts).length).toBeLessThanOrEqual(6000);
  });

  it('excludes source messages and dependent answer echoes transitively, invalidating summaries without erasing transcripts', async () => {
    const a = await conversation(),
      b = await conversation(),
      c = await conversation();
    const source = await message(a, 'Kumquat release label is CEDAR.');
    const echoB = await message(b, 'Kumquat release label is CEDAR.', MessageRole.ASSISTANT);
    const echoC = await message(c, 'Kumquat release label is CEDAR.', MessageRole.ASSISTANT);
    for (const [target, origin] of [
      [b, a],
      [c, b],
      [a, c],
    ])
      await db.query(
        'INSERT INTO ai_history_dependencies(project_id,user_id,conversation_id,source_conversation_id) VALUES($1,$2,$3,$4)',
        [project.id, user.id, target!.conversationId, origin!.conversationId],
      );
    for (const s of [a, b, c])
      await db.query(
        "INSERT INTO ai_conversation_context(conversation_id,project_id,user_id,summary,model) VALUES($1,$2,$3,'Kumquat CEDAR','scripted')",
        [s.conversationId, s.projectId, s.userId],
      );
    await context.excludeMessage(a, source.id);
    for (const id of [source.id, echoB.id, echoC.id])
      expect((await db.getRepository(ChatMessage).findOneByOrFail({ id })).contextExcluded).toBe(
        true,
      );
    expect(
      (await db.getRepository(ChatMessage).findOneByOrFail({ id: source.id })).content,
    ).toContain('CEDAR');
    expect(
      await db.query(
        'SELECT 1 FROM ai_conversation_context WHERE conversation_id=ANY($1::uuid[])',
        [[a.conversationId, b.conversationId, c.conversationId]],
      ),
    ).toHaveLength(0);
    expect(await history.recall(await conversation(), 'kumquat', '0')).toHaveLength(0);
    const current = await message(b, 'A new request after exclusion.');
    const rebuilt = await context.prepare(b, current.id, 'System');
    expect(rebuilt.messages.some((m) => m.content.includes('CEDAR'))).toBe(false);
    const newAnswer = await message(b, 'New unrelated answer.', MessageRole.ASSISTANT);
    await context.excludeMessage(a, source.id);
    expect(
      (await db.getRepository(ChatMessage).findOneByOrFail({ id: newAnswer.id })).contextExcluded,
    ).toBe(false);
    await expect(context.prepare(a, source.id, 'System')).rejects.toThrow(ConflictException);
  });

  it('rejects in-flight answer commits after exclusion even when no compaction occurred', async () => {
    const source = await conversation(),
      target = await conversation();
    const excluded = await message(source, 'Durian budget ceiling is ten.');
    const current = await message(target, 'What was the durian budget?');
    const prepared = await context.prepare(target, current.id, 'System');
    expect(prepared.compactions).toBe(0);
    await context.excludeMessage(source, excluded.id);
    const answer = db.getRepository(ChatMessage).create({
      conversationId: target.conversationId,
      role: MessageRole.ASSISTANT,
      mode: AiMode.WORKSPACE,
      content: 'Stale answer.',
    });
    await expect(context.commit(target, prepared, answer)).rejects.toThrow(ConflictException);
    expect(
      await db.getRepository(ChatMessage).countBy({ conversationId: target.conversationId }),
    ).toBe(1);
  });

  it('deleting a source chat blocks recall and clears dependent context', async () => {
    const source = await conversation(),
      target = await conversation();
    await message(source, 'Lychee launch date is tomorrow.');
    const current = await message(target, 'What was the lychee launch date?');
    const prepared = await context.prepare(target, current.id, 'System');
    const answer = db.getRepository(ChatMessage).create({
      conversationId: target.conversationId,
      role: MessageRole.ASSISTANT,
      mode: AiMode.WORKSPACE,
      content: 'Lychee launch date is tomorrow.',
    });
    await context.commit(target, prepared, answer);
    await context.deleteConversation(source);
    const stillVisible = await db.getRepository(ChatMessage).findOneByOrFail({ id: current.id });
    expect(stillVisible.contextExcluded).toBe(false);
    expect(
      (await db.getRepository(Conversation).findOneByOrFail({ id: target.conversationId }))
        .deletedAt,
    ).toBeNull();
    expect(
      (
        await db.query(
          "SELECT history_search @@ plainto_tsquery('english','lychee') AS matches FROM ai_messages WHERE id=$1",
          [current.id],
        )
      )[0].matches,
    ).toBe(true);
    expect(await history.recall(await conversation(), 'lychee', '0')).toHaveLength(1); // The user's explicit question remains; answer echo and source do not.
    expect(
      (await db.getRepository(ChatMessage).findOneByOrFail({ id: answer.id })).contextExcluded,
    ).toBe(true);
    await expect(context.prepare(source, randomUUID(), 'System')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects foreign messages and owners, and does not affect other private histories', async () => {
    const source = await conversation(),
      otherChat = await conversation(project.id, other.id);
    const own = await message(source, 'Papaya private fact.'),
      theirs = await message(otherChat, 'Papaya colleague fact.');
    await expect(context.excludeMessage(source, theirs.id)).rejects.toThrow(NotFoundException);
    await expect(context.excludeMessage({ ...source, userId: other.id }, own.id)).rejects.toThrow(
      NotFoundException,
    );
    await context.excludeMessage(source, own.id);
    expect(
      (await db.getRepository(ChatMessage).findOneByOrFail({ id: theirs.id })).contextExcluded,
    ).toBe(false);
    await db.getRepository(User).update(user.id, { isActive: false });
    try {
      await expect(context.deleteConversation(source)).rejects.toThrow(NotFoundException);
    } finally {
      await db.getRepository(User).update(user.id, { isActive: true });
    }
  });

  it('preserves canonical chronology through both retrievers and presents updates after older statements', async () => {
    const marker = 'Chronology' + randomUUID().replace(/-/g, '');
    const first = await conversation(),
      second = await conversation(),
      target = await conversation();
    const old = await message(
      first,
      `${marker} label ORCHID. ${marker} ${marker} ${marker} ${marker}`,
    );
    const updated = await message(second, `${marker} label AMBER.`);
    const lexical = await history.lexical(target, marker, '0');
    expect(lexical[0]!.messageId).toBe(old.id); // Relevance deliberately favors the old statement.
    const newer = lexical.find((r) => r.messageId === updated.id)!;
    expect(BigInt(newer.sequence!)).toBeGreaterThan(BigInt(lexical[0]!.sequence!));
    const vectors = new HistoryVectorRepository(db);
    const identity = historyEmbeddingIdentity(embeddingIdentity('synthetic', randomUUID()));
    const vector = [1, ...Array<number>(1535).fill(0)];
    for (const row of lexical) await vectors.activate(target, row, identity, randomUUID(), vector);
    const semantic = await vectors.semantic(target, identity, '0', vector);
    for (const row of lexical)
      expect(semantic.find((r) => r.messageId === row.messageId)?.sequence).toBe(row.sequence);
    const current = await message(target, marker);
    const prepared = await context.prepare(target, current.id, 'System');
    expect(prepared.excerpts.map((r) => r.messageId)).toEqual([old.id, updated.id]);
    const injected = prepared.messages.find((m) =>
      m.content.startsWith('Relevant older dialogue'),
    )!.content;
    expect(injected.indexOf('ORCHID')).toBeLessThan(injected.indexOf('AMBER'));
    expect(injected).toContain('higher numbers are later');
    const exposed = JSON.parse(injected.slice(injected.indexOf('\n') + 1)) as {
      sequence: string;
    }[];
    expect(exposed.map((r) => r.sequence)).toEqual(['1', '2']);
  });

  it('drops optional recall when its full instructions would overflow a fitting current request', async () => {
    const marker = 'Budget' + randomUUID().replace(/-/g, '');
    await message(await conversation(), `${marker} remembered value.`);
    const target = await conversation();
    const selected = await history.recall(target, marker, '0');
    expect(selected).toHaveLength(1);
    const system = 'System';
    const length =
      16000 - Buffer.byteLength(JSON.stringify(selected), 'utf8') - 510 - 64 - 32 - system.length;
    const current = await message(target, marker + ' '.repeat(length - marker.length));
    const bounded = new ConversationContextService(
      db,
      new ConfigService({ AI_CHAT_MODEL: 'deepseek-v4-pro', AI_CONTEXT_INPUT_BUDGET: 16000 }),
      provider,
      history,
      new HistoryRecallService(history, new HistoryVectorRepository(db), null),
    );
    const prepared = await bounded.prepare(target, current.id, system);
    expect(prepared.excerpts).toHaveLength(0);
    expect(prepared.messages.at(-1)!.content).toBe(current.content);
    expect(prepared.estimated).toBeLessThanOrEqual(16000);
  });

  it('retrieves only compacted messages from the current chat, with multilingual byte bounds', async () => {
    const s = await conversation();
    const old = await message(s, 'Mango checkpoint remembered.');
    await message(s, 'Mango newest question.');
    const seq = (
      await db.query('SELECT context_seq::text AS seq FROM ai_messages WHERE id=$1', [old.id])
    )[0].seq as string;
    expect((await history.recall(s, 'mango', seq)).map((m) => m.messageId)).toEqual([old.id]);
    await message(await conversation(), 'Mango ' + '文'.repeat(1500));
    expect(
      Buffer.byteLength(JSON.stringify(await history.recall(s, 'mango', '0', 1000)), 'utf8'),
    ).toBeLessThanOrEqual(1000);
  });
});
