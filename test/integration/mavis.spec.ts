import 'reflect-metadata';
import { DataSource, In } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { databaseOptions } from '../../src/database/database-options';
import { MavisService } from '../../src/modules/mavis/mavis.service';
import {
  MavisMemory,
  MavisMemoryScopeType,
  MavisMemoryStatus,
  MavisMemoryType,
  MavisSourceType,
} from '../../src/modules/mavis/entities/mavis-memory.entity';
import { User, SystemRole, ProfessionalRole } from '../../src/modules/users/entities/user.entity';
import { Project, ProjectStatus } from '../../src/modules/projects/entities/project.entity';
import {
  ProjectMember,
  ProjectRole,
} from '../../src/modules/projects/entities/project-member.entity';
import { Goal } from '../../src/modules/goals/entities/goal.entity';
import { Decision, DecisionStatus } from '../../src/modules/decisions/entities/decision.entity';
import { AgentRun } from '../../src/modules/assistant/entities/agent-run.entity';
import { ChatMessage } from '../../src/modules/assistant/entities/chat-message.entity';
import { RetrievalService } from '../../src/modules/mavis/retrieval/retrieval.service';

describe('MAVIS continuity layer (PostgreSQL integration)', () => {
  let database: DataSource;
  let service: MavisService;
  let userA: User;
  let userB: User;
  let projectA: Project;
  let projectB: Project;
  let decisionA: Decision;
  const projectIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (process.env.NODE_ENV !== 'test' || !url || !new URL(url).pathname.endsWith('_test')) {
      throw new Error(
        'Integration tests require a dedicated _test database. Use pnpm test:integration.',
      );
    }

    database = await new DataSource(databaseOptions(url)).initialize();
    await database.runMigrations({ transaction: 'all' });

    const userRepo = database.getRepository(User);
    userA = await userRepo.save(
      userRepo.create({
        email: `${randomUUID()}@mavis.test`,
        displayName: 'Mavis User A',
        passwordHash: 'synthetic-hash-test',
        systemRole: SystemRole.USER,
        professionalRole: ProfessionalRole.DEVELOPER,
        isActive: true,
      }),
    );
    userIds.push(userA.id);

    userB = await userRepo.save(
      userRepo.create({
        email: `${randomUUID()}@mavis.test`,
        displayName: 'Mavis User B',
        passwordHash: 'synthetic-hash-test',
        systemRole: SystemRole.USER,
        professionalRole: ProfessionalRole.DEVELOPER,
        isActive: true,
      }),
    );
    userIds.push(userB.id);

    const projectRepo = database.getRepository(Project);
    projectA = await projectRepo.save(
      projectRepo.create({
        key: `MAV${randomUUID().slice(0, 5).toUpperCase()}`,
        name: 'Mavis Project Alpha',
        createdBy: userA.id,
        status: ProjectStatus.ACTIVE,
      }),
    );
    projectIds.push(projectA.id);

    projectB = await projectRepo.save(
      projectRepo.create({
        key: `MAV${randomUUID().slice(0, 5).toUpperCase()}`,
        name: 'Mavis Project Beta',
        createdBy: userB.id,
        status: ProjectStatus.ACTIVE,
      }),
    );
    projectIds.push(projectB.id);

    const memberRepo = database.getRepository(ProjectMember);
    await memberRepo.save([
      memberRepo.create({
        projectId: projectA.id,
        userId: userA.id,
        accessRole: ProjectRole.OWNER,
      }),
      memberRepo.create({
        projectId: projectB.id,
        userId: userB.id,
        accessRole: ProjectRole.OWNER,
      }),
    ]);

    const decisionRepo = database.getRepository(Decision);
    decisionA = await decisionRepo.save(
      decisionRepo.create({
        projectId: projectA.id,
        number: 1,
        title: 'Use PostgreSQL for persistent continuity',
        decisionText: 'Use PostgreSQL for persistent continuity',
        rationale: 'PostgreSQL provides ACID guarantees, tsvector, and pgvector support.',
        status: DecisionStatus.ACCEPTED,
        createdBy: userA.id,
        updatedBy: userA.id,
      }),
    );

    const mockRetrievalService = {
      retrieve: jest.fn().mockResolvedValue([]),
    } as unknown as RetrievalService;

    service = new MavisService(
      database.getRepository(MavisMemory),
      memberRepo,
      userRepo,
      database.getRepository(Goal),
      decisionRepo,
      database.getRepository(AgentRun),
      database.getRepository(ChatMessage),
      mockRetrievalService,
      database,
    );
  });

  afterAll(async () => {
    if (!database?.isInitialized) return;
    try {
      if (projectIds.length) {
        await database.getRepository(MavisMemory).delete({ projectId: In(projectIds) });
        await database.getRepository(Decision).delete({ projectId: In(projectIds) });
        await database.getRepository(ProjectMember).delete({ projectId: In(projectIds) });
        await database.getRepository(Project).delete({ id: In(projectIds) });
      }
      if (userIds.length) {
        await database.getRepository(MavisMemory).delete({ userId: In(userIds) });
        await database.getRepository(User).delete({ id: In(userIds) });
      }
    } finally {
      await database.destroy();
    }
  });

  describe('PostgreSQL schema, indexes, and full-text search', () => {
    it('persists a proposed candidate with generated FTS searchDocument in PostgreSQL', async () => {
      const memory = await service.proposeCandidate(userA.id, {
        statement: 'Continuous integration must run on Linux runners',
        rationale: 'Avoid platform specific flaky tests',
        type: MavisMemoryType.DECISION,
        scopeType: MavisMemoryScopeType.PROJECT,
        projectId: projectA.id,
        sourcePlatform: 'continuum',
        sourceType: MavisSourceType.MANUAL,
      });

      expect(memory.id).toBeDefined();
      expect(memory.status).toBe(MavisMemoryStatus.PROPOSED);
      expect(memory.version).toBe(1);

      // Verify FTS search_document column was populated by postgres
      const rawRow = await database.query(
        'SELECT id, search_document::text as doc FROM mavis_memories WHERE id = $1',
        [memory.id],
      );
      expect(rawRow).toHaveLength(1);
      expect(rawRow[0].doc).toContain('continu');
      expect(rawRow[0].doc).toContain('linux');
    });

    it('honors idempotencyKey unique constraint for retry safety', async () => {
      const idempotencyKey = randomUUID();
      const first = await service.proposeCandidate(userA.id, {
        statement: 'Unique idempotency test statement',
        type: MavisMemoryType.FACT,
        scopeType: MavisMemoryScopeType.PERSONAL,
        idempotencyKey,
      });

      const second = await service.proposeCandidate(userA.id, {
        statement: 'Unique idempotency test statement',
        type: MavisMemoryType.FACT,
        scopeType: MavisMemoryScopeType.PERSONAL,
        idempotencyKey,
      });

      expect(second.id).toBe(first.id);
    });
  });

  describe('Human review lifecycle & superseding in PostgreSQL', () => {
    it('transitions PROPOSED -> APPROVED -> SUPERSEDED with full audit relations', async () => {
      // 1. Propose
      const proposed = await service.proposeCandidate(userA.id, {
        statement: 'Cache layer should use Redis sentinel',
        type: MavisMemoryType.DECISION,
        scopeType: MavisMemoryScopeType.PROJECT,
        projectId: projectA.id,
      });

      // 2. Approve
      const approved = await service.approve(userA.id, proposed.id, 1);
      expect(approved.status).toBe(MavisMemoryStatus.APPROVED);
      expect(approved.reviewedBy).toBe(userA.id);
      expect(approved.reviewedAt).toBeDefined();

      // 3. Supersede with replacement
      const { superseded, replacement } = await service.supersede(
        userA.id,
        approved.id,
        'Cache layer should use Redis Cluster with TLS',
        approved.version,
      );

      expect(superseded.status).toBe(MavisMemoryStatus.SUPERSEDED);
      expect(superseded.supersededById).toBe(replacement.id);
      expect(replacement.status).toBe(MavisMemoryStatus.APPROVED);
      expect(replacement.supersedesId).toBe(superseded.id);

      // 4. Verify context retrieval only returns the replacement, excluding superseded
      const context = await service.retrieveContext({
        actorId: userA.id,
        projectId: projectA.id,
        query: 'Redis',
      });

      const matchingApproved = context.approvedMemories.filter((m) =>
        m.statement.includes('Redis'),
      );
      expect(matchingApproved).toHaveLength(1);
      expect(matchingApproved[0]!.id).toBe(replacement.id);
      expect(matchingApproved[0]!.statement).toContain('Redis Cluster');
    });
  });

  describe('Temporal validity & provenance', () => {
    it('creates candidate memory from project decision with full provenance', async () => {
      const candidate = await service.createCandidateFromDecision(
        userA.id,
        projectA.id,
        decisionA.id,
      );

      expect(candidate.sourceType).toBe(MavisSourceType.DECISION);
      expect(candidate.sourceId).toBe(decisionA.id);
      expect(candidate.statement).toContain(decisionA.title);
      expect(candidate.rationale).toBe(decisionA.rationale);
    });

    it('filters out expired memories during context retrieval', async () => {
      const expiredDate = new Date(Date.now() - 3600000); // 1 hour ago
      const candidate = await service.proposeCandidate(userA.id, {
        statement: 'Temporary maintenance window will end in 1 hour',
        type: MavisMemoryType.OBSERVATION,
        scopeType: MavisMemoryScopeType.PROJECT,
        projectId: projectA.id,
        validUntil: expiredDate.toISOString(),
      });

      await service.approve(userA.id, candidate.id);

      const context = await service.retrieveContext({
        actorId: userA.id,
        projectId: projectA.id,
        query: 'maintenance',
      });

      const matching = context.approvedMemories.filter((m) => m.id === candidate.id);
      expect(matching).toHaveLength(0);
    });
  });

  describe('Isolation and permission enforcement', () => {
    it('prevents user B from retrieving or querying project A memories', async () => {
      // User A creates approved project memory
      const candidate = await service.proposeCandidate(userA.id, {
        statement: 'Strict confidential secret of Alpha project',
        type: MavisMemoryType.DECISION,
        scopeType: MavisMemoryScopeType.PROJECT,
        projectId: projectA.id,
      });
      await service.approve(userA.id, candidate.id);

      // User B cannot retrieve project A context
      await expect(
        service.retrieveContext({
          actorId: userB.id,
          projectId: projectA.id,
          query: 'secret',
        }),
      ).rejects.toThrow(NotFoundException);

      // User B cannot list project A memories
      await expect(
        service.listMemories(userB.id, {
          projectId: projectA.id,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
  it('recalls across authorized projects and rejects a foreign project in a multi-project request', async () => {
    const candidate = await service.proposeCandidate(userA.id, {
      statement: 'Crossprojectrecall confirms the shared target',
      type: MavisMemoryType.FACT,
      scopeType: MavisMemoryScopeType.PROJECT,
      projectId: projectA.id,
    });
    await service.approve(userA.id, candidate.id, 1);
    const pack = await service.retrieveContext({
      actorId: userA.id,
      projectIds: [projectA.id],
      query: 'Crossprojectrecall',
    });
    expect(pack.approvedMemories.map((memory) => memory.id)).toContain(candidate.id);
    await expect(
      service.retrieveContext({
        actorId: userA.id,
        projectIds: [projectA.id, projectB.id],
        query: 'Crossprojectrecall',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  describe('Concurrent review and private memory boundaries', () => {
    it('allows only one review for the same expected version', async () => {
      const candidate = await service.proposeCandidate(userA.id, {
        statement: 'Concurrent review must have exactly one winner',
        type: MavisMemoryType.FACT,
        scopeType: MavisMemoryScopeType.PERSONAL,
      });
      const results = await Promise.allSettled([
        service.approve(userA.id, candidate.id, 1),
        service.reject(userA.id, candidate.id, 'Not confirmed', 1),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const stored = await database
        .getRepository(MavisMemory)
        .findOneByOrFail({ id: candidate.id });
      expect(stored.version).toBe(2);
    });

    it('does not expose personal memory by ID to another authenticated user', async () => {
      const candidate = await service.proposeCandidate(userA.id, {
        statement: 'My private preferred working hours',
        type: MavisMemoryType.PREFERENCE,
        scopeType: MavisMemoryScopeType.PERSONAL,
      });
      await expect(service.getById(userB.id, candidate.id)).rejects.toThrow(NotFoundException);
      await expect(service.approve(userB.id, candidate.id, 1)).rejects.toThrow(NotFoundException);
      const stored = await database
        .getRepository(MavisMemory)
        .findOneByOrFail({ id: candidate.id });
      expect(stored.status).toBe(MavisMemoryStatus.PROPOSED);
    });
  });
});
