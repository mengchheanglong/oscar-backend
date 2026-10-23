import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../../src/database/database-options';
import { ChiefService } from '../../src/modules/chief-of-staff/chief.service';
import { ChiefPreferences } from '../../src/modules/chief-of-staff/entities/chief-preferences.entity';
import { ExecutionReview } from '../../src/modules/chief-of-staff/entities/execution-review.entity';
import { User } from '../../src/modules/users/entities/user.entity';
import { Project } from '../../src/modules/projects/entities/project.entity';
import {
  ProjectMember,
  ProjectRole,
} from '../../src/modules/projects/entities/project-member.entity';
import { Goal } from '../../src/modules/goals/entities/goal.entity';
import { Conversation } from '../../src/modules/assistant/entities/conversation.entity';
import { AgentRun, AgentRunStatus } from '../../src/modules/assistant/entities/agent-run.entity';
import { PlatformHandoff } from '../../src/modules/assistant/entities/platform-handoff.entity';
import { ChatMessage, MessageRole } from '../../src/modules/assistant/entities/chat-message.entity';
import { AssistantMode } from '../../src/modules/assistant/entities/assistant-mode.enum';
import {
  MavisMemory,
  MavisMemoryStatus,
} from '../../src/modules/mavis/entities/mavis-memory.entity';
import { assertExecutionGoal } from '../../src/modules/assistant/execution-goal';
import { MavisService } from '../../src/modules/mavis/mavis.service';
import { Decision } from '../../src/modules/decisions/entities/decision.entity';
import { RetrievalService } from '../../src/modules/mavis/retrieval/retrieval.service';

describe('Chief-of-staff continuity (PostgreSQL)', () => {
  let db: DataSource,
    chief: ChiefService,
    user: User,
    other: User,
    project: Project,
    goal: Goal,
    chat: Conversation,
    run: AgentRun;
  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (process.env.NODE_ENV !== 'test' || !url || !new URL(url).pathname.endsWith('_test'))
      throw Error('Dedicated test database required.');
    db = await new DataSource(databaseOptions(url)).initialize();
    await db.runMigrations({ transaction: 'all' });
    chief = new ChiefService(db);
    user = await db.getRepository(User).save({
      email: `${randomUUID()}@chief.test`,
      displayName: 'Chief QA',
      passwordHash: 'synthetic',
      isActive: true,
    });
    other = await db.getRepository(User).save({
      email: `${randomUUID()}@chief.test`,
      displayName: 'Other QA',
      passwordHash: 'synthetic',
      isActive: true,
    });
    project = await db
      .getRepository(Project)
      .save({ key: `C${randomUUID().slice(0, 7)}`, name: 'Chief fixture', createdBy: user.id });
    await db
      .getRepository(ProjectMember)
      .save({ userId: user.id, projectId: project.id, accessRole: ProjectRole.OWNER });
    goal = await db
      .getRepository(Goal)
      .save({ userId: user.id, projectId: project.id, title: 'Measured outcome', progress: 17 });
  });
  beforeEach(async () => {
    chat = await db.getRepository(Conversation).save({ userId: user.id, projectId: project.id });
    run = await db.getRepository(AgentRun).save({
      userId: user.id,
      projectId: project.id,
      goalId: goal.id,
      conversationId: chat.id,
      prompt: 'Synthetic workflow',
      status: AgentRunStatus.SUCCEEDED,
      model: 'fixture',
      runtimeRevision: 'fixture',
      idempotencyKey: randomUUID(),
      payloadHash: 'fixture',
      artifact: 'Synthetic result',
    });
  });
  afterAll(async () => {
    chief?.onModuleDestroy();
    if (db?.isInitialized) {
      await db.getRepository(Project).delete(project.id);
      await db.getRepository(User).delete([user.id, other.id]);
      await db.destroy();
    }
  });
  const input = () => ({
    idempotencyKey: randomUUID(),
    verdict: 'ACCEPTED' as const,
    observation: 'Checked the synthetic result against the expected output.',
    lesson: 'Verify reported execution results before changing a goal.',
    reportedCostUsd: 0.125,
  });
  it('atomically records a review and a proposed, goal-scoped lesson without changing goal progress', async () => {
    const result = await chief.review(user.id, 'hermes', run.id, input());
    const memory = await db.getRepository(MavisMemory).findOneByOrFail({ id: result.memoryId! });
    expect(memory).toMatchObject({
      status: MavisMemoryStatus.PROPOSED,
      goalId: goal.id,
      projectId: project.id,
      sourceId: run.id,
      sourceType: 'AGENT_RUN',
    });
    expect(memory.sourceMetadata?.reviewId).toBe(result.id);
    expect((await db.getRepository(Goal).findOneByOrFail({ id: goal.id })).progress).toBe(17);
  });
  it('reuses identical retries and rejects changed payloads and second review keys', async () => {
    const dto = input();
    const results = await Promise.all([
      chief.review(user.id, 'hermes', run.id, dto),
      chief.review(user.id, 'hermes', run.id, dto),
    ]);
    expect(results[0]!.id).toBe(results[1]!.id);
    await expect(
      chief.review(user.id, 'hermes', run.id, { ...dto, observation: 'Different' }),
    ).rejects.toThrow('retry key');
    await expect(chief.review(user.id, 'hermes', run.id, input())).rejects.toThrow(
      'already been reviewed',
    );
    expect(await db.getRepository(MavisMemory).countBy({ sourceId: run.id })).toBe(1);
  });
  it('recalls the lesson in a later answer context only after separate MAVIS approval', async () => {
    const dto = {
      ...input(),
      lesson: 'Observe synthetic continuity checkpoints before goal measurement changes.',
    };
    const result = await chief.review(user.id, 'hermes', run.id, dto);
    const mavis = new MavisService(
      db.getRepository(MavisMemory),
      db.getRepository(ProjectMember),
      db.getRepository(User),
      db.getRepository(Goal),
      db.getRepository(Decision),
      db.getRepository(AgentRun),
      db.getRepository(ChatMessage),
      { retrieve: jest.fn().mockResolvedValue([]) } as unknown as RetrievalService,
      db,
    );
    const request = {
      actorId: user.id,
      projectId: project.id,
      query: 'synthetic continuity checkpoints',
      includeProjectSources: false,
      includeHistoricalConversations: false,
      includeExecutionResults: false,
    };
    expect(
      (await mavis.retrieveContext(request)).approvedMemories.some((m) => m.id === result.memoryId),
    ).toBe(false);
    await mavis.approve(user.id, result.memoryId!, 1);
    const context = await mavis.retrieveContext(request);
    expect(context.approvedMemories.some((m) => m.id === result.memoryId)).toBe(true);
    expect(context.formattedContext).toContain(dto.lesson);
  });
  it('blocks foreign users, wrong platforms and cross-project goal IDs', async () => {
    await expect(chief.review(other.id, 'hermes', run.id, input())).rejects.toThrow('not found');
    await expect(chief.review(user.id, 't3', run.id, input())).rejects.toThrow('not found');
    await expect(assertExecutionGoal(db.manager, randomUUID(), goal.id)).rejects.toThrow(
      'in this project',
    );
  });
  it('rechecks deleted chats and removed memberships for reviews and briefings', async () => {
    await db.getRepository(Conversation).update(chat.id, { deletedAt: new Date() });
    await expect(chief.review(user.id, 'hermes', run.id, input())).rejects.toThrow('unavailable');
    expect((await chief.briefing(user.id)).work.some((w) => w.id === run.id)).toBe(false);
    await db
      .getRepository(ProjectMember)
      .update({ userId: user.id, projectId: project.id }, { removedAt: new Date() });
    try {
      expect((await chief.briefing(user.id)).goals.some((g) => g.id === goal.id)).toBe(false);
      await expect(chief.getReview(user.id, 'hermes', run.id)).rejects.toThrow('unavailable');
    } finally {
      await db
        .getRepository(ProjectMember)
        .update({ userId: user.id, projectId: project.id }, { removedAt: null });
    }
  });
  it('does not accept failed, cancelled or unfinished work as a verified result', async () => {
    for (const status of [
      AgentRunStatus.RUNNING,
      AgentRunStatus.FAILED,
      AgentRunStatus.CANCELLED,
    ]) {
      await db.getRepository(AgentRun).update(run.id, { status });
      await expect(chief.review(user.id, 'hermes', run.id, input())).rejects.toThrow();
    }
    await chief.review(user.id, 'hermes', run.id, {
      idempotencyKey: randomUUID(),
      verdict: 'NEEDS_WORK',
      observation: 'Execution cancelled; no validated output.',
    });
  });
  it('keeps an explicitly unknown cost nullable rather than treating it as zero', async () => {
    const result = await chief.review(user.id, 'hermes', run.id, {
      idempotencyKey: randomUUID(),
      verdict: 'NEEDS_WORK',
      observation: 'Further validation needed.',
      reportedCostUsd: null,
    });
    expect(result.reportedCostUsd).toBeNull();
  });
  it.each(['t3', 'paperclip'] as const)(
    'retains %s result provenance and rolls back when its result is not published',
    async (platform) => {
      const handoff = await db.getRepository(PlatformHandoff).save({
        userId: user.id,
        projectId: project.id,
        conversationId: chat.id,
        goalId: goal.id,
        platformType: platform,
        connectionOrigin: 'http://127.0.0.1:43102',
        idempotencyKey: randomUUID(),
        prompt: 'Fixture',
        status: 'SUCCEEDED',
      });
      const dto = input();
      await expect(chief.review(user.id, platform, handoff.id, dto)).rejects.toThrow('publish');
      expect(await db.getRepository(ExecutionReview).countBy({ runId: handoff.id })).toBe(0);
      const message = await db.getRepository(ChatMessage).save({
        conversationId: chat.id,
        role: MessageRole.ASSISTANT,
        mode: AssistantMode.WORKSPACE,
        content: 'Reported result',
      });
      await db
        .getRepository(PlatformHandoff)
        .update(handoff.id, { assistantMessageId: message.id });
      const result = await chief.review(user.id, platform, handoff.id, dto);
      expect(await db.getRepository(MavisMemory).findOneBy({ id: result.memoryId! })).toMatchObject(
        { sourceId: message.id, sourcePlatform: platform, status: 'PROPOSED' },
      );
    },
  );
  it('shows unknown costs separately and reports a workspace threshold even in a project briefing', async () => {
    await chief.savePreferences(user.id, { cadence: 'OFF', hourUtc: 2, monthlyBudgetUsd: 0.1 });
    await chief.review(user.id, 'hermes', run.id, input());
    const result = await chief.briefing(user.id, project.id);
    expect(result.budget.reportedUsd).toBeGreaterThanOrEqual(0.125);
    expect(result.budget.unknownRuns).toBeGreaterThan(0);
    expect(result.budget.overBudget).toBe(true);
    expect((await chief.briefing(other.id)).budget.trackedRuns).toBe(0);
  });
  it('leaves recurrence off by default and creates a due briefing only once across workers', async () => {
    expect((await chief.preferences(other.id)).cadence).toBe('OFF');
    await chief.savePreferences(user.id, { cadence: 'DAILY', hourUtc: 2, monthlyBudgetUsd: null });
    const due = new Date(Date.now() - 1000);
    await db.getRepository(ChiefPreferences).update(user.id, { nextBriefingAt: due });
    const secondWorker = new ChiefService(db);
    const counts = await Promise.all([
      chief.generateDueBriefings(),
      secondWorker.generateDueBriefings(),
    ]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    const records = (await db.query(
      'SELECT count(*)::int AS count FROM chief_briefings WHERE user_id=$1 AND scheduled_at=$2',
      [user.id, due],
    )) as Array<{ count: number }>;
    expect(records[0]!.count).toBe(1);
    expect((await chief.preferences(user.id)).nextBriefingAt!.getTime()).toBeGreaterThan(
      Date.now(),
    );
    await chief.savePreferences(user.id, { cadence: 'OFF', hourUtc: 2, monthlyBudgetUsd: null });
    expect((await chief.preferences(user.id)).nextBriefingAt).toBeNull();
  });
});
