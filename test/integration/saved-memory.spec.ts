import 'reflect-metadata';
import { DeepSeekLlmProvider } from '../../src/modules/assistant/llm/deepseek-llm-provider';
import { ContextAssembler } from '../../src/modules/assistant/context/context-assembler';
import { ConversationContextService } from '../../src/modules/assistant/context/conversation-context.service';
import { ConversationHistoryRepository } from '../../src/modules/assistant/context/conversation-history.repository';
import { HistoryRecallService } from '../../src/modules/assistant/context/history-recall.service';
import { HistoryVectorRepository } from '../../src/modules/assistant/context/history-vector.repository';
import { ConfigService } from '@nestjs/config';
import { LlmProvider } from '../../src/modules/assistant/llm/llm-provider.interface';
import { AssistantService } from '../../src/modules/assistant/assistant.service';
import { RetrievalService } from '../../src/modules/mavis/retrieval/retrieval.service';
import { IngestionService } from '../../src/modules/ingestion/ingestion.service';
import { PrivateMemoryService } from '../../src/modules/assistant/memory/private-memory.service';
import { PrivateMemoryRepository } from '../../src/modules/assistant/memory/private-memory.repository';
import { embeddingIdentity } from '../../src/modules/assistant/memory/private-memory.contract';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { databaseOptions } from '../../src/database/database-options';
import { SavedMemoryService } from '../../src/modules/assistant/saved-memory.service';
import {
  SavedMemory,
  SavedMemoryKind,
} from '../../src/modules/assistant/entities/saved-memory.entity';
import {
  AssistantMode,
  Conversation,
} from '../../src/modules/assistant/entities/conversation.entity';
import { ChatMessage, MessageRole } from '../../src/modules/assistant/entities/chat-message.entity';
import { User } from '../../src/modules/users/entities/user.entity';
import { Project, ProjectStatus } from '../../src/modules/projects/entities/project.entity';
import {
  ProjectMember,
  ProjectRole,
} from '../../src/modules/projects/entities/project-member.entity';

describe('Private copilot memory with PostgreSQL', () => {
  let database: DataSource;
  let service: SavedMemoryService;
  let userA: User;
  let userB: User;
  let projectA: Project;
  let projectB: Project;
  const projectIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (process.env.NODE_ENV !== 'test' || !url || !new URL(url).pathname.endsWith('_test'))
      throw new Error('Use the dedicated test database.');
    database = await new DataSource(databaseOptions(url)).initialize();
    await database.runMigrations({ transaction: 'all' });
    const users = database.getRepository(User);
    userA = await users.save(
      users.create({
        email: `${randomUUID()}@memory.test`,
        displayName: 'Memory A',
        passwordHash: 'synthetic-test-only',
      }),
    );
    userIds.push(userA.id);
    userB = await users.save(
      users.create({
        email: `${randomUUID()}@memory.test`,
        displayName: 'Memory B',
        passwordHash: 'synthetic-test-only',
      }),
    );
    userIds.push(userB.id);
    const projects = database.getRepository(Project);
    projectA = await projects.save(
      projects.create({
        key: `M${randomUUID().slice(0, 7).toUpperCase()}`,
        name: 'Memory A',
        createdBy: userA.id,
      }),
    );
    projectIds.push(projectA.id);
    projectB = await projects.save(
      projects.create({
        key: `M${randomUUID().slice(0, 7).toUpperCase()}`,
        name: 'Memory B',
        createdBy: userB.id,
      }),
    );
    projectIds.push(projectB.id);
    const members = database.getRepository(ProjectMember);
    await members.save([
      members.create({ projectId: projectA.id, userId: userA.id, accessRole: ProjectRole.OWNER }),
      members.create({ projectId: projectA.id, userId: userB.id, accessRole: ProjectRole.VIEWER }),
      members.create({ projectId: projectB.id, userId: userB.id, accessRole: ProjectRole.OWNER }),
    ]);
    service = new SavedMemoryService(
      database.getRepository(SavedMemory),
      members,
      database.getRepository(ChatMessage),
    );
  });

  beforeEach(async () => {
    await database.getRepository(SavedMemory).delete({ projectId: In(projectIds) });
  });

  afterAll(async () => {
    if (!database?.isInitialized) return;
    try {
      if (projectIds.length) await database.getRepository(Project).delete({ id: In(projectIds) });
      if (userIds.length) await database.getRepository(User).delete({ id: In(userIds) });
    } finally {
      await database.destroy();
    }
  });

  const draft = (content = 'Compare the assumptions before selecting a plan.') => ({
    kind: SavedMemoryKind.CONTEXT,
    content,
    userConfirmed: true as const,
    idempotencyKey: randomUUID(),
  });

  async function longConversation() {
    const conv = await database
      .getRepository(Conversation)
      .save({ projectId: projectA.id, userId: userA.id, title: 'Synthetic context test' });
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 29; i++)
      messages.push(
        await database.getRepository(ChatMessage).save({
          conversationId: conv.id,
          role: i % 2 ? MessageRole.ASSISTANT : MessageRole.USER,
          mode: AssistantMode.WORKSPACE,
          content: i === 28 ? 'Latest synthetic request' : 'Synthetic history. '.repeat(60),
        }),
      );
    return {
      scope: { projectId: projectA.id, userId: userA.id, conversationId: conv.id },
      messages,
    };
  }
  const contextService = (
    summarize = async () => ({
      data: { summary: 'Earlier user requirements and unverified assistant suggestions.' },
      modelName: 'scripted',
      rawJson: '',
      promptTokens: 100,
      completionTokens: 10,
    }),
  ) =>
    new ConversationContextService(
      database,
      new ConfigService({ AI_CHAT_MODEL: 'deepseek-v4-pro', AI_CONTEXT_INPUT_BUDGET: 16000 }),
      { generateStructuredOutput: summarize } as unknown as LlmProvider,
      new ConversationHistoryRepository(database),
      new HistoryRecallService(
        new ConversationHistoryRepository(database),
        new HistoryVectorRepository(database),
        null,
      ),
    );

  it('persists compacted context across service instances without deleting original messages', async () => {
    const { scope, messages } = await longConversation();
    const context = contextService();
    const prepared = await context.prepare(scope, messages.at(-1)!.id, 'Synthetic system');
    expect(prepared.compactions).toBeGreaterThan(0);
    expect(prepared.messages.at(-1)?.content).toBe('Latest synthetic request');
    expect(
      await database.query('SELECT * FROM ai_conversation_context WHERE conversation_id=$1', [
        scope.conversationId,
      ]),
    ).toHaveLength(0);
    await context.commit(scope, prepared);
    const again = await contextService().prepare(scope, messages.at(-1)!.id, 'Synthetic system');
    expect(again.summary).toContain('Earlier user requirements');
    expect(again.compactions).toBe(0);
    expect(
      await database
        .getRepository(ChatMessage)
        .count({ where: { conversationId: scope.conversationId } }),
    ).toBe(29);
    await expect(context.commit(scope, prepared)).rejects.toThrow(ConflictException);
    await expect(
      context.prepare({ ...scope, userId: userB.id }, messages.at(-1)!.id, 'system'),
    ).rejects.toThrow(NotFoundException);
  });

  it('keeps the durable boundary unchanged on summary failure or access revocation', async () => {
    const { scope, messages } = await longConversation();
    await expect(
      contextService(async () => {
        throw new Error('scripted failure');
      }).prepare(scope, messages.at(-1)!.id, 'system'),
    ).rejects.toThrow();
    const revoked = contextService(async () => {
      await database.getRepository(User).update(userA.id, { isActive: false });
      return {
        data: { summary: 'Do not persist.' },
        modelName: 'scripted',
        rawJson: '',
        promptTokens: 1,
        completionTokens: 1,
      };
    });
    try {
      await expect(revoked.prepare(scope, messages.at(-1)!.id, 'system')).rejects.toThrow();
    } finally {
      await database.getRepository(User).update(userA.id, { isActive: true });
    }
    expect(
      await database.query('SELECT * FROM ai_conversation_context WHERE conversation_id=$1', [
        scope.conversationId,
      ]),
    ).toHaveLength(0);
    expect(
      await database
        .getRepository(ChatMessage)
        .count({ where: { conversationId: scope.conversationId } }),
    ).toBe(29);
  });

  it('rolls back summary advancement if the generated answer cannot be saved', async () => {
    const { scope, messages } = await longConversation();
    const context = contextService();
    const prepared = await context.prepare(scope, messages.at(-1)!.id, 'system');
    const invalid = database.getRepository(ChatMessage).create({
      conversationId: scope.conversationId,
      role: MessageRole.ASSISTANT,
      mode: AssistantMode.WORKSPACE,
      content: null as unknown as string,
    });
    await expect(context.commit(scope, prepared, invalid)).rejects.toThrow();
    expect(
      await database.query('SELECT * FROM ai_conversation_context WHERE conversation_id=$1', [
        scope.conversationId,
      ]),
    ).toHaveLength(0);
    expect(
      await database
        .getRepository(ChatMessage)
        .count({ where: { conversationId: scope.conversationId } }),
    ).toBe(29);
  });

  it('serializes turns across service instances and releases the lock on failures', async () => {
    const { scope } = await longConversation();
    const context = contextService();
    await context.withTurn(scope, async () => {
      await expect(contextService().withTurn(scope, async () => undefined)).rejects.toThrow(
        ConflictException,
      );
    });
    await expect(
      context.withTurn(scope, async () => {
        throw new Error('scripted');
      }),
    ).rejects.toThrow('scripted');
    await expect(contextService().withTurn(scope, async () => true)).resolves.toBe(true);
  });

  it('runs the chat service with real history beyond ten messages and persists the answer', async () => {
    const { scope } = await longConversation();
    const provider = {
      generateAnswer: jest.fn(async () => ({
        content: 'Synthetic answer.',
        citations: [],
        modelName: 'scripted',
        promptTokens: 100,
        completionTokens: 5,
      })),
    } as unknown as LlmProvider;
    const context = new ConversationContextService(
      database,
      new ConfigService({ AI_CHAT_MODEL: 'deepseek-v4-pro' }),
      provider,
      new ConversationHistoryRepository(database),
      new HistoryRecallService(
        new ConversationHistoryRepository(database),
        new HistoryVectorRepository(database),
        null,
      ),
    );
    const chat = new AssistantService(
      database.getRepository(Conversation),
      database.getRepository(ChatMessage),
      database.getRepository(Project),
      database.getRepository(ProjectMember),
      database.getRepository(User),
      { retrieve: async () => [] } as unknown as RetrievalService,
      new ContextAssembler(),
      provider,
      {} as IngestionService,
      new PrivateMemoryService(new PrivateMemoryRepository(database), null),
      context,
    );
    const result = await chat.postMessage(scope.projectId, scope.userId, scope.conversationId, {
      content: 'New current request',
      mode: AssistantMode.WORKSPACE,
    });
    expect(result.assistantMessage.id).toBeDefined();
    expect(
      await database
        .getRepository(ChatMessage)
        .count({ where: { conversationId: scope.conversationId } }),
    ).toBe(31);
    const generate = provider.generateAnswer as jest.Mock;
    expect(generate.mock.calls[0]![0].messages.length).toBeGreaterThan(11);
    expect(generate.mock.calls[0]![0].messages.at(-1).content).toBe('New current request');
  });

  it('sends selected private memory to the configured DeepSeek adapter without an embedding call', async () => {
    await service.create(
      projectA.id,
      userA.id,
      draft('For forecast reviews, show assumptions first.'),
    );
    await service.create(projectA.id, userB.id, draft('Private colleague forecast instructions.'));
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      expect(String(url)).toBe('https://api.deepseek.com/chat/completions');
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        messages: { content: string }[];
      };
      expect(body.model).toBe('deepseek-v4-pro');
      expect(body.messages[0]?.content).toContain('show assumptions first');
      expect(body.messages[0]?.content).not.toContain('Private colleague');
      return new Response(
        JSON.stringify({
          model: 'deepseek-v4-pro',
          choices: [
            {
              message: { role: 'assistant', content: 'Synthetic forecast answer.' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 10 },
        }),
      );
    });
    try {
      const memories = await new PrivateMemoryService(
        new PrivateMemoryRepository(database),
        null,
      ).select(projectA.id, userA.id, 'forecast review');
      expect(fetch).not.toHaveBeenCalled();
      const context = new ContextAssembler().assemble(
        'Synthetic project',
        AssistantMode.WORKSPACE,
        [],
        false,
        undefined,
        memories,
      );
      const result = await new DeepSeekLlmProvider(
        'synthetic-key',
        'https://api.deepseek.com',
        'deepseek-v4-pro',
      ).generateAnswer({
        messages: [
          { role: 'system', content: context.systemPrompt },
          { role: 'user', content: 'forecast review' },
        ],
        evidence: [],
      });
      expect(result.content).toBe('Synthetic forecast answer.');
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      fetch.mockRestore();
    }
  });

  it('recalls old relevant entries beyond the listing limit without crossing actor/project scope', async () => {
    const saved = await service.create(
      projectA.id,
      userA.id,
      draft('Use the AZ-7 pricing constraint.'),
    );
    for (let i = 0; i < 101; i++)
      await service.create(projectA.id, userA.id, draft(`Unrelated gardening note ${i}`));
    await service.create(projectA.id, userB.id, draft('AZ-7 private colleague constraint'));
    await service.create(projectB.id, userB.id, draft('AZ-7 foreign project constraint'));
    const recall = new PrivateMemoryService(new PrivateMemoryRepository(database), null);
    expect((await service.list(projectA.id, userA.id)).map((m) => m.id)).not.toContain(saved.id);
    expect(
      (await recall.select(projectA.id, userA.id, 'pricing constraint AZ-7')).map((m) => m.id),
    ).toEqual([saved.id]);
    expect(await recall.select(projectA.id, userA.id, 'astronaut')).toEqual([]);
    expect(await recall.select(projectA.id, userA.id, '')).toEqual([]);
    await expect(recall.select(projectB.id, userA.id, 'pricing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('selects exact compatible vectors and invalidates edited/deleted versions immediately', async () => {
    const saved = await service.create(projectA.id, userA.id, draft('Keep the original budget.'));
    const identity = embeddingIdentity('synthetic', 'model-a');
    const vector = [1, ...Array<number>(1535).fill(0)];
    const repo = new PrivateMemoryRepository(database);
    const scope = { projectId: projectA.id, userId: userA.id };
    const recall = new PrivateMemoryService(repo, {
      identity,
      embed: async (texts) => texts.map(() => vector),
    });
    await recall.indexBatch(scope);
    await recall.indexBatch(scope);
    expect((await recall.select(projectA.id, userA.id, 'allocation')).map((m) => m.id)).toEqual([
      saved.id,
    ]);
    expect(await repo.hasVectors(scope, embeddingIdentity('synthetic', 'model-b'))).toBe(false);
    const edited = await service.update(projectA.id, userA.id, saved.id, {
      ...draft('Reviewed replacement ceiling.'),
      version: saved.version,
    });
    expect(await repo.hasVectors(scope, identity)).toBe(false);
    await repo.activate(scope, saved, identity, randomUUID(), vector);
    expect(await repo.hasVectors(scope, identity)).toBe(false);
    await recall.indexBatch(scope);
    expect(await repo.hasVectors(scope, identity)).toBe(true);
    await service.remove(projectA.id, userA.id, edited.id, edited.version);
    expect(await recall.select(projectA.id, userA.id, 'allocation')).toEqual([]);
    expect(await repo.hasVectors(scope, identity)).toBe(false);
  });

  it('keeps one actor’s private memories separate across authorized projects and respects inactive accounts', async () => {
    const members = database.getRepository(ProjectMember);
    await members.save(
      members.create({ projectId: projectB.id, userId: userA.id, accessRole: ProjectRole.VIEWER }),
    );
    try {
      const own = await service.create(
        projectA.id,
        userA.id,
        draft('Private forecast preference.'),
      );
      await service.create(projectB.id, userA.id, draft('Other project forecast preference.'));
      const recall = new PrivateMemoryService(new PrivateMemoryRepository(database), null);
      expect((await recall.select(projectA.id, userA.id, 'forecast')).map((m) => m.id)).toEqual([
        own.id,
      ]);
      await database.getRepository(User).update(userA.id, { isActive: false });
      await expect(recall.select(projectA.id, userA.id, 'forecast')).rejects.toThrow(
        NotFoundException,
      );
    } finally {
      await database.getRepository(User).update(userA.id, { isActive: true });
      await members.delete({ projectId: projectB.id, userId: userA.id });
    }
  });

  it('drops deleted candidates when deletion happens during query embedding', async () => {
    const saved = await service.create(
      projectA.id,
      userA.id,
      draft('Private forecast preference.'),
    );
    const repo = new PrivateMemoryRepository(database);
    const identity = embeddingIdentity('synthetic', 'delete-test');
    const vector = [1, ...Array<number>(1535).fill(0)];
    await new PrivateMemoryService(repo, {
      identity,
      embed: async (texts) => texts.map(() => vector),
    }).indexBatch({ projectId: projectA.id, userId: userA.id });
    const recall = new PrivateMemoryService(repo, {
      identity,
      embed: async (texts) => {
        await service.remove(projectA.id, userA.id, saved.id, saved.version);
        return texts.map(() => vector);
      },
    });
    expect(await recall.select(projectA.id, userA.id, 'forecast')).toEqual([]);
  });

  it('rejects stale indexing after edits during the provider call and supports safe model reindexing', async () => {
    const saved = await service.create(projectA.id, userA.id, draft('Initial ceiling.'));
    const scope = { projectId: projectA.id, userId: userA.id };
    const repo = new PrivateMemoryRepository(database);
    const identity = embeddingIdentity('synthetic', 'old');
    const vector = [1, ...Array<number>(1535).fill(0)];
    const delayed = new PrivateMemoryService(repo, {
      identity,
      embed: async (texts) => {
        await service.update(projectA.id, userA.id, saved.id, {
          ...draft('Current ceiling.'),
          version: saved.version,
        });
        return texts.map(() => vector);
      },
    });
    expect((await delayed.indexBatch(scope)).remaining).toBe(true);
    expect(await repo.hasVectors(scope, identity)).toBe(false);
    const old = new PrivateMemoryService(repo, {
      identity,
      embed: async (texts) => texts.map(() => vector),
    });
    await old.indexBatch(scope);
    const nextIdentity = embeddingIdentity('synthetic', 'new');
    const next = new PrivateMemoryService(repo, {
      identity: nextIdentity,
      embed: async (texts) => texts.map(() => vector),
    });
    expect(await repo.hasVectors(scope, nextIdentity)).toBe(false);
    await next.indexBatch(scope);
    expect(await repo.hasVectors(scope, identity)).toBe(true);
    expect(await repo.hasVectors(scope, nextIdentity)).toBe(true);
  });

  it('denies indexing and recall after membership revocation during external work', async () => {
    await service.create(projectA.id, userA.id, draft('A private constraint.'));
    const scope = { projectId: projectA.id, userId: userA.id };
    const repo = new PrivateMemoryRepository(database);
    const identity = embeddingIdentity('synthetic', 'model');
    const vector = [1, ...Array<number>(1535).fill(0)];
    const members = database.getRepository(ProjectMember);
    const recall = new PrivateMemoryService(repo, {
      identity,
      embed: async (texts) => {
        await members.update(scope, { removedAt: new Date() });
        return texts.map(() => vector);
      },
    });
    try {
      await expect(recall.indexBatch(scope)).rejects.toThrow(NotFoundException);
    } finally {
      await members.update(scope, { removedAt: null });
    }
    expect(await repo.hasVectors(scope, identity)).toBe(false);
    await new PrivateMemoryService(repo, {
      identity,
      embed: async (texts) => texts.map(() => vector),
    }).indexBatch(scope);
    try {
      await expect(recall.select(projectA.id, userA.id, 'constraint')).rejects.toThrow(
        NotFoundException,
      );
    } finally {
      await members.update(scope, { removedAt: null });
    }
  });

  it('enforces database dimensions and composite owner/project references', async () => {
    const saved = await service.create(projectA.id, userA.id, draft());
    const sql = `INSERT INTO private_memory_vectors(memory_id,project_id,user_id,source_version,content_hash,embedding_identity,generation_id,embedding)
      VALUES ($1,$2,$3,1,$4,$4,$5,$6::vector)`;
    const args = [saved.id, projectA.id, userA.id, 'a'.repeat(64), randomUUID()];
    await expect(database.query(sql, [...args, '[1,0]'])).rejects.toThrow();
    await expect(
      database.query(sql, [
        saved.id,
        projectA.id,
        userB.id,
        'a'.repeat(64),
        randomUUID(),
        JSON.stringify([1, ...Array<number>(1535).fill(0)]),
      ]),
    ).rejects.toThrow();
  });

  it('isolates memories between users in the same project and between projects', async () => {
    const memory = await service.create(projectA.id, userA.id, draft());
    await service.create(projectB.id, userB.id, draft('Other project context.'));
    expect((await service.list(projectA.id, userA.id)).map((m) => m.id)).toEqual([memory.id]);
    expect(await service.list(projectA.id, userB.id)).toEqual([]);
    await expect(service.list(projectB.id, userA.id)).rejects.toThrow(NotFoundException);
    await expect(
      service.update(projectA.id, userB.id, memory.id, {
        ...draft('Overwrite'),
        version: memory.version,
      }),
    ).rejects.toThrow(NotFoundException);
    await expect(service.remove(projectB.id, userB.id, memory.id, memory.version)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('persists one memory for simultaneous retries and rejects changed payloads without overwriting it', async () => {
    const input = draft();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => service.create(projectA.id, userA.id, input)),
    );
    expect(new Set(results.map((m) => m.id)).size).toBe(1);
    expect(
      await database.getRepository(SavedMemory).count({ where: { projectId: projectA.id } }),
    ).toBe(1);
    await expect(
      service.create(projectA.id, userA.id, { ...input, content: 'Changed payload' }),
    ).rejects.toThrow(ConflictException);
    expect((await service.list(projectA.id, userA.id))[0]?.content).toBe(input.content);
    const freshService = new SavedMemoryService(
      database.getRepository(SavedMemory),
      database.getRepository(ProjectMember),
      database.getRepository(ChatMessage),
    );
    expect((await freshService.list(projectA.id, userA.id))[0]?.id).toBe(results[0]?.id);
  });

  it('rejects stale edits/removals and never resurrects a removed memory on retry', async () => {
    const input = draft();
    const saved = await service.create(projectA.id, userA.id, input);
    const updated = await service.update(projectA.id, userA.id, saved.id, {
      ...input,
      content: 'Reviewed correction.',
      version: saved.version,
    });
    expect(updated.version).toBe(saved.version + 1);
    await expect(
      service.update(projectA.id, userA.id, saved.id, { ...input, version: saved.version }),
    ).rejects.toThrow(ConflictException);
    await expect(service.remove(projectA.id, userA.id, saved.id, saved.version)).rejects.toThrow(
      ConflictException,
    );
    await service.remove(projectA.id, userA.id, saved.id, updated.version);
    expect(await service.list(projectA.id, userA.id)).toEqual([]);
    await expect(service.create(projectA.id, userA.id, input)).rejects.toThrow(ConflictException);
  });

  it('accepts provenance only from the same private, live conversation scope', async () => {
    const conversations = database.getRepository(Conversation);
    const messages = database.getRepository(ChatMessage);
    const other = await conversations.save(
      conversations.create({ projectId: projectA.id, userId: userB.id }),
    );
    const otherMessage = await messages.save(
      messages.create({
        conversationId: other.id,
        role: MessageRole.ASSISTANT,
        mode: AssistantMode.WORKSPACE,
        content: 'Private other-user reply.',
      }),
    );
    await expect(
      service.create(projectA.id, userA.id, { ...draft(), sourceMessageId: otherMessage.id }),
    ).rejects.toThrow(NotFoundException);
    const own = await conversations.save(
      conversations.create({ projectId: projectA.id, userId: userA.id }),
    );
    const ownMessage = await messages.save(
      messages.create({
        conversationId: own.id,
        role: MessageRole.ASSISTANT,
        mode: AssistantMode.WORKSPACE,
        content: 'Review this lesson.',
      }),
    );
    expect(
      (await service.create(projectA.id, userA.id, { ...draft(), sourceMessageId: ownMessage.id }))
        .sourceMessageId,
    ).toBe(ownMessage.id);
    await conversations.update(own.id, { deletedAt: new Date() });
    await expect(
      service.create(projectA.id, userA.id, { ...draft(), sourceMessageId: ownMessage.id }),
    ).rejects.toThrow(NotFoundException);
  });

  it('requires explicit review, active membership/account, and a writable project for mutations', async () => {
    await expect(
      service.create(projectA.id, userA.id, {
        ...draft(),
        userConfirmed: false as unknown as true,
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(service.create(projectA.id, userA.id, draft('   '))).rejects.toThrow(
      BadRequestException,
    );
    await database
      .getRepository(ProjectMember)
      .update({ projectId: projectA.id, userId: userB.id }, { removedAt: new Date() });
    try {
      await expect(service.list(projectA.id, userB.id)).rejects.toThrow(NotFoundException);
    } finally {
      await database
        .getRepository(ProjectMember)
        .update({ projectId: projectA.id, userId: userB.id }, { removedAt: null });
    }
    await database.getRepository(User).update(userB.id, { isActive: false });
    try {
      await expect(service.list(projectA.id, userB.id)).rejects.toThrow(NotFoundException);
    } finally {
      await database.getRepository(User).update(userB.id, { isActive: true });
    }
    await database.getRepository(Project).update(projectA.id, { status: ProjectStatus.ARCHIVED });
    try {
      await expect(service.create(projectA.id, userA.id, draft())).rejects.toThrow(
        BadRequestException,
      );
    } finally {
      await database.getRepository(Project).update(projectA.id, { status: ProjectStatus.ACTIVE });
    }
  });
});
