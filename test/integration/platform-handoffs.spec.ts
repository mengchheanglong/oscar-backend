import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { databaseOptions } from '../../src/database/database-options';
import { PlatformHandoffsService } from '../../src/modules/assistant/platform-handoffs.service';
import { PlatformHandoff } from '../../src/modules/assistant/entities/platform-handoff.entity';
import { Conversation } from '../../src/modules/assistant/entities/conversation.entity';
import { ChatMessage } from '../../src/modules/assistant/entities/chat-message.entity';
import { ConversationContextService } from '../../src/modules/assistant/context/conversation-context.service';
import { User } from '../../src/modules/users/entities/user.entity';
import { Project } from '../../src/modules/projects/entities/project.entity';
import {
  ProjectMember,
  ProjectRole,
} from '../../src/modules/projects/entities/project-member.entity';
import {
  PlatformConnection,
  PlatformType,
} from '../../src/modules/platforms/entities/platform-connection.entity';
import { ExternalLink } from '../../src/modules/platforms/entities/external-link.entity';
import { Goal } from '../../src/modules/goals/entities/goal.entity';
import { PlatformsService } from '../../src/modules/platforms/platforms.service';
import { T3Adapter } from '../../src/modules/platforms/adapters/t3.adapter';
import { PaperclipAdapter } from '../../src/modules/platforms/adapters/paperclip.adapter';

describe('Durable OSCAR platform handoffs', () => {
  let db: DataSource,
    service: PlatformHandoffsService,
    user: User,
    project: Project,
    connection: PlatformConnection;
  const t3 = {
    requireExecution: jest.fn(),
    models: jest.fn(),
    fetchEntities: jest.fn(),
    launch: jest.fn(),
    readThread: jest.fn(),
    interrupt: jest.fn(),
    findHandoffThread: jest.fn(),
  };
  const llm = { generateAnswer: jest.fn(), generateStructuredOutput: jest.fn() };
  const paperclip = {
    executionTargets: jest.fn(),
    launch: jest.fn(),
    readIssue: jest.fn(),
    resultComments: jest.fn(),
    findHandoffIssue: jest.fn(),
    cancelIssue: jest.fn(),
  };
  const paperclipAgentId = randomUUID(),
    paperclipIssueId = randomUUID(),
    companyId = randomUUID();
  let conversation: Conversation;
  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (process.env.NODE_ENV !== 'test' || !url || !new URL(url).pathname.endsWith('_test'))
      throw Error('Dedicated test database required');
    db = await new DataSource(databaseOptions(url)).initialize();
    await db.runMigrations({ transaction: 'all' });
    user = await db.getRepository(User).save({
      email: `${randomUUID()}@handoff.test`,
      displayName: 'Handoff QA',
      passwordHash: 'synthetic',
      isActive: true,
    });
    project = await db
      .getRepository(Project)
      .save({ key: `T${randomUUID().slice(0, 7)}`, name: 'Handoff fixture', createdBy: user.id });
    await db
      .getRepository(ProjectMember)
      .save({ userId: user.id, projectId: project.id, accessRole: ProjectRole.OWNER });
    connection = await db.getRepository(PlatformConnection).save({
      userId: user.id,
      projectId: project.id,
      name: 'T3 fixture',
      baseUrl: 'http://localhost:3773',
      platformType: PlatformType.T3,
      metadata: { t3Access: 'supervised' },
    });
    const platforms = new PlatformsService(
      db.getRepository(PlatformConnection),
      db.getRepository(ExternalLink),
      db.getRepository(ProjectMember),
      db.getRepository(Goal),
      paperclip as unknown as PaperclipAdapter,
      t3 as unknown as T3Adapter,
    );
    const context = new ConversationContextService(db, new ConfigService(), llm, null!, null!);
    service = new PlatformHandoffsService(
      db.getRepository(PlatformHandoff),
      db,
      platforms,
      t3 as unknown as T3Adapter,
      context,
      llm,
      paperclip as unknown as PaperclipAdapter,
    );
  });
  beforeEach(async () => {
    jest.resetAllMocks();
    await db.getRepository(PlatformConnection).update(connection.id, {
      platformType: PlatformType.T3,
      metadata: { t3Access: 'supervised' },
    });
    conversation = await db
      .getRepository(Conversation)
      .save({ projectId: project.id, userId: user.id });
    t3.fetchEntities.mockResolvedValue({
      type: 't3',
      data: { workspaces: [{ id: 'remote-project', name: 'Fixture' }] },
    });
    t3.launch.mockResolvedValue({ threadId: randomUUID(), runId: 'run-1' });
    t3.models.mockResolvedValue([{ provider: 'codex', instanceId: 'codex', model: 'test-model' }]);
    llm.generateAnswer.mockResolvedValue({
      content: 'T3 reports that the requested change is complete.',
    });
  });
  async function paperclipInput() {
    await db.getRepository(PlatformConnection).update(connection.id, {
      platformType: PlatformType.PAPERCLIP,
      metadata: { companyId, paperclipAccess: 'supervised' },
    });
    paperclip.executionTargets.mockResolvedValue({
      agents: [{ id: paperclipAgentId, name: 'Worker' }],
      projects: [],
    });
    const issue = {
      id: paperclipIssueId,
      companyId,
      assigneeAgentId: paperclipAgentId,
      projectId: null,
      status: 'done',
      identifier: 'QA-1',
    };
    paperclip.launch.mockResolvedValue(issue);
    paperclip.readIssue.mockResolvedValue(issue);
    paperclip.resultComments.mockResolvedValue('Paperclip agent completed the requested review.');
    return {
      ...input(),
      platformType: 'paperclip' as const,
      providerInstanceId: undefined,
      model: undefined,
      remoteAgentId: paperclipAgentId,
      remoteProjectId: undefined,
    };
  }
  it('returns a Paperclip agent result to its originating chat with an issue link', async () => {
    const dto = await paperclipInput();
    const row = await service.create(project.id, user.id, dto);
    expect((await service.create(project.id, user.id, dto)).id).toBe(row.id);
    const done = await service.refresh(project.id, user.id, row.id);
    expect(done.status).toBe('SUCCEEDED');
    expect(done.result).toContain('Paperclip agent');
    const message = await db
      .getRepository(ChatMessage)
      .findOneByOrFail({ id: done.assistantMessageId! });
    expect(message.conversationId).toBe(conversation.id);
    expect(message.content).toContain('Open Paperclip issue');
    expect(paperclip.launch).toHaveBeenCalledTimes(1);
  });
  it('reconciles an uncertain Paperclip creation without assigning twice', async () => {
    const dto = await paperclipInput();
    paperclip.launch.mockRejectedValueOnce(Error('lost response'));
    const row = await service.create(project.id, user.id, dto);
    expect((await service.refresh(project.id, user.id, row.id)).status).toBe('UNCERTAIN');
    paperclip.findHandoffIssue.mockResolvedValue(await paperclip.readIssue());
    expect((await service.refresh(project.id, user.id, row.id)).status).toBe('SUCCEEDED');
    expect(paperclip.launch).toHaveBeenCalledTimes(1);
  });
  it('waits on blocked issues and confirms cancellation instead of inventing a result', async () => {
    const dto = await paperclipInput();
    const issue = await paperclip.readIssue();
    paperclip.readIssue.mockResolvedValue({ ...issue, status: 'blocked' });
    const row = await service.create(project.id, user.id, dto);
    expect((await service.refresh(project.id, user.id, row.id)).status).toBe('WAITING');
    expect((await service.cancel(project.id, user.id, row.id)).status).toBe('WAITING');
    expect(paperclip.cancelIssue).toHaveBeenCalledTimes(1);
    paperclip.readIssue.mockResolvedValue({ ...issue, status: 'cancelled' });
    expect((await service.refresh(project.id, user.id, row.id)).status).toBe('CANCELLED');
  });
  it('refuses a switched Paperclip company before dispatch and rejects empty final results', async () => {
    const dto = await paperclipInput();
    const row = await service.create(project.id, user.id, dto);
    await db.getRepository(PlatformConnection).update(connection.id, {
      metadata: { companyId: randomUUID(), paperclipAccess: 'supervised' },
    });
    expect((await service.refresh(project.id, user.id, row.id)).status).toBe('FAILED');
    expect(paperclip.launch).not.toHaveBeenCalled();
    const fresh = await service.create(project.id, user.id, await paperclipInput());
    paperclip.resultComments.mockResolvedValue(null);
    expect((await service.refresh(project.id, user.id, fresh.id)).status).toBe('FAILED');
  });
  afterAll(async () => {
    if (db?.isInitialized) {
      await db.getRepository(Project).delete(project.id);
      await db.getRepository(User).delete(user.id);
      await db.destroy();
    }
  });
  const input = () => ({
    providerInstanceId: 'codex',
    model: 'test-model',
    conversationId: conversation.id,
    connectionId: connection.id,
    remoteProjectId: 'remote-project',
    prompt: 'Create a small fixture and report checks.',
    idempotencyKey: randomUUID(),
  });
  async function refresh(status: string, items: object[] = []) {
    t3.readThread.mockImplementation(async (_connection, threadId) => ({
      thread: { threadId, projectId: 'remote-project', status },
      recentRuns: [{ runId: 'run-1', status }],
      items,
      hasMore: false,
    }));
    const row = await service.create(project.id, user.id, input());
    return service.refresh(project.id, user.id, row.id);
  }
  it('concurrent retries create one task and user turn; changed payload is rejected', async () => {
    const dto = input();
    const rows = await Promise.all([
      service.create(project.id, user.id, dto),
      service.create(project.id, user.id, dto),
    ]);
    expect(rows[0].id).toBe(rows[1].id);
    expect(await db.getRepository(ChatMessage).countBy({ conversationId: conversation.id })).toBe(
      1,
    );
    await expect(
      service.create(project.id, user.id, { ...dto, prompt: 'Different task' }),
    ).rejects.toThrow('different handoff');
  });
  it('reads the final assistant answer for the delegated run, then posts exactly one summary', async () => {
    const row = await refresh('completed', [
      { type: 'assistant_message', runId: 'run-1', text: 'Starting now' },
      { type: 'assistant_message', runId: 'other-run', text: 'Wrong result' },
      { type: 'assistant_message', runId: 'run-1', text: 'Created fixture; node --test passed.' },
    ]);
    expect(row.status).toBe('SUCCEEDED');
    expect(row.result).toBe('Created fixture; node --test passed.');
    expect(llm.generateAnswer.mock.calls[0][0].messages[1].content).toContain(row.result);
    await service.refresh(project.id, user.id, row.id);
    expect(t3.launch).toHaveBeenCalledTimes(1);
    expect(await db.getRepository(ChatMessage).countBy({ conversationId: conversation.id })).toBe(
      2,
    );
  });
  it('survives a lost launch response without sending the task twice', async () => {
    t3.launch.mockRejectedValueOnce(new Error('network lost after launch'));
    const row = await service.create(project.id, user.id, input());
    expect((await service.refresh(project.id, user.id, row.id)).status).toBe('UNCERTAIN');
    t3.findHandoffThread.mockResolvedValue(null);
    await service.refresh(project.id, user.id, row.id);
    expect(t3.launch).toHaveBeenCalledTimes(1);
  });
  it('reports approval requests and waits for a confirmed terminal cancellation', async () => {
    const row = await refresh('waiting');
    expect(row.status).toBe('WAITING');
    expect((await service.cancel(project.id, user.id, row.id)).status).toBe('WAITING');
    expect(t3.interrupt).toHaveBeenCalledTimes(1);
  });
  it('never marks an empty terminal result as success', async () => {
    expect((await refresh('completed')).status).toBe('FAILED');
  });
  it('reports cancellation deterministically without inventing claims from partial progress', async () => {
    const row = await refresh('interrupted', [
      { type: 'assistant_message', runId: 'run-1', text: 'I will begin reviewing.' },
    ]);
    expect(row.status).toBe('CANCELLED');
    expect(llm.generateAnswer).not.toHaveBeenCalled();
    const message = await db
      .getRepository(ChatMessage)
      .findOneByOrFail({ id: row.assistantMessageId! });
    expect(message.content).toContain('partial progress');
    expect(message.content).not.toContain('No files were changed');
  });
  it('accepts native mcp-prefixed thread IDs and paginates through the final result', async () => {
    const threadId = `mcp:${randomUUID()}`;
    t3.launch.mockResolvedValue({ threadId, runId: 'run-1' });
    t3.readThread.mockImplementation(async (_c, id, afterPosition) => ({
      thread: { threadId: id, projectId: 'remote-project', status: 'completed' },
      recentRuns: [{ runId: 'run-1', status: 'completed' }],
      items:
        afterPosition === undefined
          ? [{ type: 'assistant_message', runId: 'run-1', text: 'Early note' }]
          : [{ type: 'assistant_message', runId: 'run-1', text: 'Final paginated result' }],
      hasMore: afterPosition === undefined,
      nextPosition: afterPosition === undefined ? 1 : null,
    }));
    const row = await service.create(project.id, user.id, input());
    const result = await service.refresh(project.id, user.id, row.id);
    expect(result.status).toBe('SUCCEEDED');
    expect(result.result).toBe('Final paginated result');
    expect(result.threadId).toBe(threadId);
  });
  it('recovers a saved uncertain launch without a second remote launch', async () => {
    t3.launch.mockRejectedValueOnce(new Error('lost response'));
    const row = await service.create(project.id, user.id, input());
    await service.refresh(project.id, user.id, row.id);
    const threadId = `mcp:${randomUUID()}`;
    t3.findHandoffThread.mockResolvedValue({ threadId, latestRunId: 'run-1' });
    t3.readThread.mockResolvedValue({
      thread: { threadId, projectId: 'remote-project', status: 'completed' },
      recentRuns: [{ runId: 'run-1', status: 'completed' }],
      items: [{ type: 'assistant_message', runId: 'run-1', text: 'Recovered final result' }],
      hasMore: false,
    });
    expect((await service.refresh(project.id, user.id, row.id)).status).toBe('SUCCEEDED');
    expect(t3.launch).toHaveBeenCalledTimes(1);
  });
  it('does not send or publish an excluded request', async () => {
    const row = await service.create(project.id, user.id, input());
    await db
      .getRepository(ChatMessage)
      .update({ conversationId: conversation.id }, { contextExcluded: true });
    expect((await service.refresh(project.id, user.id, row.id)).status).toBe('FAILED');
    expect(t3.launch).not.toHaveBeenCalled();
    expect(llm.generateAnswer).not.toHaveBeenCalled();
  });
  it('rejects unavailable models before saving a chat turn', async () => {
    await expect(
      service.create(project.id, user.id, { ...input(), model: 'missing-model' }),
    ).rejects.toThrow('available T3 model');
    expect(await db.getRepository(ChatMessage).countBy({ conversationId: conversation.id })).toBe(
      0,
    );
  });
  it('does not redirect queued work when its connection origin changes', async () => {
    const row = await service.create(project.id, user.id, input());
    await db
      .getRepository(PlatformConnection)
      .update(connection.id, { baseUrl: 'http://localhost:4773' });
    try {
      expect((await service.refresh(project.id, user.id, row.id)).status).toBe('FAILED');
      expect(t3.launch).not.toHaveBeenCalled();
    } finally {
      await db
        .getRepository(PlatformConnection)
        .update(connection.id, { baseUrl: connection.baseUrl });
    }
  });
  it('preserves the T3 result when the OSCAR summarizer is unavailable', async () => {
    llm.generateAnswer.mockRejectedValueOnce(new Error('provider unavailable'));
    const row = await refresh('completed', [
      { type: 'assistant_message', runId: 'run-1', text: 'Exact retained result' },
    ]);
    const message = await db
      .getRepository(ChatMessage)
      .findOneByOrFail({ id: row.assistantMessageId! });
    expect(message.content).toContain('Exact retained result');
  });
  it('rejects foreign conversation access and a read-only connection', async () => {
    await expect(service.list(project.id, randomUUID(), conversation.id)).rejects.toThrow(
      'Conversation not found',
    );
    await db.getRepository(PlatformConnection).update(connection.id, { metadata: {} });
    try {
      await expect(service.create(project.id, user.id, input())).rejects.toThrow('supervised');
    } finally {
      await db
        .getRepository(PlatformConnection)
        .update(connection.id, { metadata: { t3Access: 'supervised' } });
    }
  });
  it('rechecks membership after submission before contacting T3', async () => {
    const row = await service.create(project.id, user.id, input());
    await db
      .getRepository(ProjectMember)
      .update({ projectId: project.id, userId: user.id }, { removedAt: new Date() });
    try {
      await expect(service.refresh(project.id, user.id, row.id)).rejects.toThrow(
        'Conversation not found',
      );
      expect(t3.launch).not.toHaveBeenCalled();
    } finally {
      await db
        .getRepository(ProjectMember)
        .update({ projectId: project.id, userId: user.id }, { removedAt: null });
    }
  });
});
