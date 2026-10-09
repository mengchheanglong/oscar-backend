import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, In } from 'typeorm';
import { databaseOptions } from '../../src/database/database-options';
import { AgentRunsService } from '../../src/modules/ai/agent-runs.service';
import { AgentRun, AgentRunStatus } from '../../src/modules/ai/entities/agent-run.entity';
import { CopilotMemoryService } from '../../src/modules/ai/copilot-memory.service';
import {
  CopilotMemory,
  CopilotMemoryKind,
} from '../../src/modules/ai/entities/copilot-memory.entity';
import { ChatMessage } from '../../src/modules/ai/entities/chat-message.entity';
import { ContextAssembler } from '../../src/modules/ai/context/context-assembler';
import { RetrievalService } from '../../src/modules/ai/retrieval/retrieval.service';
import { AgentRuntime } from '../../src/modules/ai/runtime/runtime-contract';
import { User } from '../../src/modules/users/entities/user.entity';
import { Project, ProjectStatus } from '../../src/modules/projects/entities/project.entity';
import {
  ProjectMember,
  ProjectRole,
} from '../../src/modules/projects/entities/project-member.entity';
import { Requirement } from '../../src/modules/requirements/entities/requirement.entity';
import { AIProposal, ProposalStatus } from '../../src/modules/ai/entities/proposal.entity';
import { AuditService } from '../../src/modules/audit/audit.service';
import { AuditLog } from '../../src/modules/audit/entities/audit-log.entity';

describe('Hermes run lifecycle with PostgreSQL', () => {
  let db: DataSource;
  let service: AgentRunsService;
  let user: User;
  let other: User;
  let project: Project;
  let requirement: Requirement;
  const runtime: AgentRuntime = { available: () => true, execute: jest.fn() };
  const execute = runtime.execute as jest.Mock;
  let retrieval: RetrievalService;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (process.env.NODE_ENV !== 'test' || !url || !new URL(url).pathname.endsWith('_test'))
      throw new Error('Dedicated test database required.');
    db = await new DataSource(databaseOptions(url)).initialize();
    await db.runMigrations({ transaction: 'all' });
    const users = db.getRepository(User);
    user = await users.save(
      users.create({
        email: `${randomUUID()}@runs.test`,
        displayName: 'Run A',
        passwordHash: 'synthetic-only',
      }),
    );
    other = await users.save(
      users.create({
        email: `${randomUUID()}@runs.test`,
        displayName: 'Run B',
        passwordHash: 'synthetic-only',
      }),
    );
    const projects = db.getRepository(Project);
    project = await projects.save(
      projects.create({
        key: `R${randomUUID().slice(0, 7).toUpperCase()}`,
        name: 'Synthetic runs',
        createdBy: user.id,
      }),
    );
    await db.getRepository(ProjectMember).save([
      { projectId: project.id, userId: user.id, accessRole: ProjectRole.OWNER },
      { projectId: project.id, userId: other.id, accessRole: ProjectRole.VIEWER },
    ]);
    const requirements = db.getRepository(Requirement);
    requirement = await requirements.save(
      requirements.create({
        projectId: project.id,
        number: 1,
        title: 'Synthetic pricing requirement',
        createdBy: user.id,
        updatedBy: user.id,
      }),
    );
    retrieval = { retrieve: jest.fn().mockResolvedValue([]) } as unknown as RetrievalService;
    service = new AgentRunsService(
      db.getRepository(AgentRun),
      db.getRepository(ProjectMember),
      db,
      new ConfigService({ AI_CHAT_MODEL: 'deepseek-v4-pro' }),
      retrieval,
      new ContextAssembler(),
      new CopilotMemoryService(
        db.getRepository(CopilotMemory),
        db.getRepository(ProjectMember),
        db.getRepository(ChatMessage),
      ),
      runtime,
      new AuditService(db.getRepository(AuditLog)),
    );
  });

  beforeEach(async () => {
    await service.onModuleDestroy();
    await db.getRepository(AgentRun).delete({ projectId: project.id });
    await db.getRepository(AIProposal).delete({ projectId: project.id });
    await db.getRepository(CopilotMemory).delete({ projectId: project.id });
    await db.getRepository(Project).update(project.id, { status: ProjectStatus.ACTIVE });
    await db.getRepository(User).update(user.id, { isActive: true });
    await db
      .getRepository(ProjectMember)
      .update({ projectId: project.id, userId: user.id }, { removedAt: null });
    execute.mockReset().mockResolvedValue('# Synthetic report');
  });
  afterAll(async () => {
    if (!db?.isInitialized) return;
    await service.onModuleDestroy();
    await db.getRepository(Project).delete(project.id);
    await db.getRepository(AuditLog).delete({ actorId: In([user.id, other.id]) });
    await db.getRepository(User).delete({ id: In([user.id, other.id]) });
    await db.destroy();
  });

  async function settled(id: string) {
    for (let i = 0; i < 100; i++) {
      const r = await db.getRepository(AgentRun).findOneByOrFail({ id });
      if (![AgentRunStatus.QUEUED, AgentRunStatus.RUNNING].includes(r.status)) return r;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Run did not settle');
  }

  it('executes scoped retrieval, deterministic calculation and a pending reviewed task', async () => {
    execute.mockImplementation(async (_input, callbacks) => {
      await callbacks.tool('search_project_evidence', { query: 'pricing' });
      const calc = await callbacks.tool('calculate_pricing', {
        price: 20,
        variableCost: 5,
        fixedCost: 100,
        units: 10,
      });
      expect(calc.operatingProfit).toBe(50);
      const draft = await callbacks.tool('request_task_review', {
        requirementId: requirement.id,
        title: 'Review pricing',
      });
      expect(draft.reviewRequired).toBe(true);
      return '# Pricing report\nOperating profit: 50.';
    });
    const created = await service.create(project.id, user.id, {
      prompt: 'Analyze pricing',
      idempotencyKey: randomUUID(),
    });
    const done = await settled(created.id);
    expect(done.status).toBe(AgentRunStatus.SUCCEEDED);
    expect(done.events).toHaveLength(3);
    expect(done.artifact).toContain('50');
    const proposal = await db.getRepository(AIProposal).findOneByOrFail({ id: done.proposalId! });
    expect(proposal).toMatchObject({
      status: ProposalStatus.PENDING,
      sourceEntityId: requirement.id,
      userId: user.id,
    });
    expect(retrieval.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: project.id, actorId: user.id }),
    );
    expect(await service.list(project.id, other.id)).toEqual([]);
    await expect(service.get(project.id, other.id, done.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.cancel(project.id, other.id, done.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('starts exactly one execution for simultaneous creation retries and rejects changed payloads', async () => {
    const dto = { prompt: 'Same request', idempotencyKey: randomUUID() };
    const [a, b] = await Promise.all([
      service.create(project.id, user.id, dto),
      service.create(project.id, user.id, dto),
    ]);
    expect(a.id).toBe(b.id);
    await settled(a.id);
    expect(execute).toHaveBeenCalledTimes(1);
    await expect(
      service.create(project.id, user.id, { ...dto, prompt: 'Changed' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('cancellation wins against late output and never saves its staged proposal', async () => {
    let release!: (s: string) => void;
    let staged!: () => void;
    const ready = new Promise<void>((r) => {
      staged = r;
    });
    execute.mockImplementation(async (_input, callbacks) => {
      await callbacks.tool('request_task_review', {
        requirementId: requirement.id,
        title: 'Cancelled draft',
      });
      staged();
      return new Promise<string>((r) => {
        release = r;
      });
    });
    const run = await service.create(project.id, user.id, {
      prompt: 'Cancel me',
      idempotencyKey: randomUUID(),
    });
    await ready;
    await expect(
      service.create(project.id, user.id, {
        prompt: 'A second active run',
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await service.cancel(project.id, user.id, run.id);
    release('Late output');
    await service.onModuleDestroy();
    const cancelled = await service.get(project.id, user.id, run.id);
    expect(cancelled).toMatchObject({
      status: AgentRunStatus.CANCELLED,
      artifact: null,
      proposalId: null,
    });
    expect(await db.getRepository(AIProposal).countBy({ projectId: project.id })).toBe(0);
  });

  it('denies tools after membership revocation and saves only a safe failure code', async () => {
    execute.mockImplementation(async (_input, callbacks) => {
      await db
        .getRepository(ProjectMember)
        .update({ projectId: project.id, userId: user.id }, { removedAt: new Date() });
      await callbacks.tool('calculate_pricing', {
        price: 1,
        variableCost: 0,
        fixedCost: 0,
        units: 1,
      });
      return 'Must not save';
    });
    const r = await service.create(project.id, user.id, {
      prompt: 'Revocation',
      idempotencyKey: randomUUID(),
    });
    expect(await settled(r.id)).toMatchObject({
      status: AgentRunStatus.FAILED,
      errorCode: 'HERMES_EXECUTION_FAILED',
      artifact: null,
    });
  });

  it('rejects unknown tools and allows an explicit new attempt after failure', async () => {
    execute.mockImplementation(async (_input, callbacks) => {
      await callbacks.tool('terminal', { command: 'malicious' });
      return 'bad';
    });
    const r = await service.create(project.id, user.id, {
      prompt: 'Restricted run',
      idempotencyKey: randomUUID(),
    });
    expect((await settled(r.id)).status).toBe(AgentRunStatus.FAILED);
    execute.mockResolvedValue('# New attempt');
    const retry = await service.create(project.id, user.id, {
      prompt: 'Restricted run',
      idempotencyKey: randomUUID(),
    });
    expect((await settled(retry.id)).status).toBe(AgentRunStatus.SUCCEEDED);
    expect(retry.id).not.toBe(r.id);
  });

  it('blocks archived projects, inactive accounts and cross-project access', async () => {
    await expect(
      service.create(randomUUID(), user.id, { prompt: 'Forbidden', idempotencyKey: randomUUID() }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await db.getRepository(Project).update(project.id, { status: ProjectStatus.ARCHIVED });
    await expect(
      service.create(project.id, user.id, { prompt: 'Archived', idempotencyKey: randomUUID() }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await db.getRepository(Project).update(project.id, { status: ProjectStatus.ACTIVE });
    await db.getRepository(User).update(user.id, { isActive: false });
    await expect(
      service.create(project.id, user.id, { prompt: 'Inactive', idempotencyKey: randomUUID() }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('marks expired interrupted runs failed without executing them again', async () => {
    const repo = db.getRepository(AgentRun);
    const interrupted = await repo.save(
      repo.create({
        projectId: project.id,
        userId: user.id,
        prompt: 'Interrupted',
        model: 'deepseek-v4-pro',
        runtimeRevision: 'test',
        status: AgentRunStatus.RUNNING,
        idempotencyKey: randomUUID(),
        payloadHash: 'a'.repeat(64),
        deadlineAt: new Date(Date.now() - 1000),
      }),
    );
    expect((await service.get(project.id, user.id, interrupted.id)).errorCode).toBe(
      'RUN_INTERRUPTED',
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('passes only the initiating actor’s reviewed project memories to Hermes', async () => {
    const memories = new CopilotMemoryService(
      db.getRepository(CopilotMemory),
      db.getRepository(ProjectMember),
      db.getRepository(ChatMessage),
    );
    await memories.create(project.id, user.id, {
      kind: CopilotMemoryKind.PREFERENCE,
      content: 'Own synthetic preference',
      userConfirmed: true,
      idempotencyKey: randomUUID(),
    });
    await memories.create(project.id, other.id, {
      kind: CopilotMemoryKind.PREFERENCE,
      content: 'Other private synthetic preference',
      userConfirmed: true,
      idempotencyKey: randomUUID(),
    });
    execute.mockImplementation(async (input) => {
      expect(input.context).toContain('Own synthetic preference');
      expect(input.context).not.toContain('Other private synthetic preference');
      return '# Private context report';
    });
    const r = await service.create(project.id, user.id, {
      prompt: 'Use my preferences',
      idempotencyKey: randomUUID(),
    });
    expect((await settled(r.id)).status).toBe(AgentRunStatus.SUCCEEDED);
  });

  it('does not save an artifact or proposal when its source changes during execution', async () => {
    execute.mockImplementation(async (_input, callbacks) => {
      const foreign = await callbacks.tool('request_task_review', {
        requirementId: randomUUID(),
        title: 'Wrong source',
      });
      expect(foreign.error).toBeDefined();
      await callbacks.tool('request_task_review', {
        requirementId: requirement.id,
        title: 'Stale draft',
      });
      await db.getRepository(Requirement).increment({ id: requirement.id }, 'version', 1);
      return '# Outdated report';
    });
    const r = await service.create(project.id, user.id, {
      prompt: 'Source changes',
      idempotencyKey: randomUUID(),
    });
    expect(await settled(r.id)).toMatchObject({
      status: AgentRunStatus.FAILED,
      artifact: null,
      proposalId: null,
    });
    expect(await db.getRepository(AIProposal).countBy({ projectId: project.id })).toBe(0);
  });
});
