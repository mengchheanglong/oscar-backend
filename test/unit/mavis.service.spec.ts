import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { MavisService } from '../../src/modules/mavis/mavis.service';
import {
  MavisMemory,
  MavisMemoryScopeType,
  MavisMemoryStatus,
  MavisMemoryType,
  MavisSourceType,
} from '../../src/modules/mavis/entities/mavis-memory.entity';
import {
  ProjectMember,
  ProjectRole,
} from '../../src/modules/projects/entities/project-member.entity';
import { ProjectStatus } from '../../src/modules/projects/entities/project.entity';
import { User } from '../../src/modules/users/entities/user.entity';
import { Goal } from '../../src/modules/goals/entities/goal.entity';
import { Decision, DecisionStatus } from '../../src/modules/decisions/entities/decision.entity';
import { AgentRun, AgentRunStatus } from '../../src/modules/assistant/entities/agent-run.entity';
import { ChatMessage, MessageRole } from '../../src/modules/assistant/entities/chat-message.entity';
import { RetrievalService } from '../../src/modules/mavis/retrieval/retrieval.service';

describe('MavisService', () => {
  let service: MavisService;
  let memoryRepo: Partial<Repository<MavisMemory>>;
  let memberRepo: Partial<Repository<ProjectMember>>;
  let userRepo: Partial<Repository<User>>;
  let goalRepo: Partial<Repository<Goal>>;
  let decisionRepo: Partial<Repository<Decision>>;
  let agentRunRepo: Partial<Repository<AgentRun>>;
  let messageRepo: Partial<Repository<ChatMessage>>;
  let retrievalService: Partial<RetrievalService>;
  let dataSource: Partial<DataSource>;

  const userId = '11111111-1111-1111-1111-111111111111';
  const otherUserId = '22222222-2222-2222-2222-222222222222';
  const projectId = '33333333-3333-3333-3333-333333333333';
  const otherProjectId = '44444444-4444-4444-4444-444444444444';
  const goalId = '55555555-5555-5555-5555-555555555555';
  const decisionId = '66666666-6666-6666-6666-666666666666';
  const runId = '77777777-7777-7777-7777-777777777777';

  let inMemoryMemories: MavisMemory[] = [];

  beforeEach(() => {
    inMemoryMemories = [];

    userRepo = {
      findOne: jest.fn().mockImplementation(async ({ where }) => {
        if (where.id === userId) return { id: userId, isActive: true } as User;
        if (where.id === otherUserId) return { id: otherUserId, isActive: true } as User;
        return null;
      }),
    };

    memberRepo = {
      findOne: jest.fn().mockImplementation(async ({ where }) => {
        if (where.projectId === projectId && where.userId === userId) {
          return {
            projectId,
            userId,
            accessRole: ProjectRole.OWNER,
            project: { id: projectId, name: 'Main Project', status: ProjectStatus.ACTIVE },
          } as ProjectMember;
        }
        if (where.projectId === otherProjectId && where.userId === otherUserId) {
          return {
            accessRole: ProjectRole.OWNER,
            projectId: otherProjectId,
            userId: otherUserId,
            project: { id: otherProjectId, name: 'Other Project', status: ProjectStatus.ACTIVE },
          } as ProjectMember;
        }
        return null;
      }),
      find: jest.fn().mockImplementation(async () => [{ projectId, userId } as ProjectMember]),
    };

    goalRepo = {
      findOne: jest.fn().mockImplementation(async ({ where }) => {
        if (where.id === goalId) {
          return { id: goalId, userId, projectId, title: 'Test Goal' } as Goal;
        }
        return null;
      }),
    };

    decisionRepo = {
      findOne: jest.fn().mockImplementation(async ({ where }) => {
        if (where.id === decisionId) {
          return {
            id: decisionId,
            projectId,
            number: 42,
            title: 'Use PostgreSQL and pgvector',
            decisionText: 'We standardize on Postgres with pgvector for storage.',
            rationale: 'Mature relational model and robust vector indexing.',
            status: DecisionStatus.ACCEPTED,
            decidedAt: new Date('2026-10-18T10:00:00Z'),
            version: 1,
          } as Decision;
        }
        return null;
      }),
    };

    agentRunRepo = {
      findOne: jest.fn().mockImplementation(async ({ where }) => {
        if (where.id === runId && where.projectId === projectId) {
          return {
            id: runId,
            projectId,
            userId,
            model: 'deepseek-v4-pro',
            prompt: 'Research database performance and lessons learned',
            artifact: 'Lesson: connection pooling avoids socket exhaustion under load.',
            status: AgentRunStatus.SUCCEEDED,
            updatedAt: new Date('2026-10-18T11:00:00Z'),
          } as AgentRun;
        }
        return null;
      }),
      find: jest.fn().mockResolvedValue([
        {
          id: runId,
          projectId,
          userId,
          model: 'deepseek-v4-pro',
          prompt: 'Research database performance',
          artifact: 'Lesson: connection pooling avoids socket exhaustion',
          status: AgentRunStatus.SUCCEEDED,
          updatedAt: new Date('2026-10-18T11:00:00Z'),
        },
      ]),
    };

    messageRepo = {
      findOne: jest.fn().mockImplementation(async ({ where }) => ({
        id: where.id,
        conversationId: 'conv-1',
        role: MessageRole.USER,
        content: 'Remember that our API version is v1',
        conversation: { projectId },
      })),
      createQueryBuilder: jest.fn().mockImplementation(() => ({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'msg-1',
            conversationId: 'conv-1',
            role: MessageRole.USER,
            content: 'Remember that our API version is v1',
            createdAt: new Date('2026-10-18T10:00:00Z'),
          },
        ]),
      })),
    };

    retrievalService = {
      retrieve: jest.fn().mockResolvedValue([
        {
          chunkId: 'chunk-1',
          sourceId: 'doc-1',
          sourceType: 'DOCUMENT',
          title: 'Architecture Blueprint',
          revision: 1,
          locator: 'sec-1',
          text: 'Continuum architecture uses NestJS and PostgreSQL.',
        },
      ]),
    };

    memoryRepo = {
      update: jest.fn(async (criteria: unknown, changes: unknown) => {
        const where = criteria as { id: string; version?: number; status?: MavisMemoryStatus };
        const patch = changes as Partial<MavisMemory>;
        const index = inMemoryMemories.findIndex(
          (m) =>
            m.id === where.id &&
            (where.version === undefined || m.version === where.version) &&
            (where.status === undefined || m.status === where.status),
        );
        if (index < 0) return { affected: 0, raw: [], generatedMaps: [] };
        inMemoryMemories[index] = { ...inMemoryMemories[index]!, ...patch };
        return { affected: 1, raw: [], generatedMaps: [] };
      }),
      create: jest.fn().mockImplementation((dto) => ({
        id: `mem-${inMemoryMemories.length + 1}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        version: 1,
        ...dto,
      })),
      save: jest.fn().mockImplementation(async (entity) => {
        const existingIdx = inMemoryMemories.findIndex((m) => m.id === entity.id);
        if (existingIdx >= 0) {
          inMemoryMemories[existingIdx] = entity;
        } else {
          inMemoryMemories.push(entity);
        }
        return entity;
      }),
      findOne: jest.fn().mockImplementation(async ({ where }) => {
        return inMemoryMemories.find((m) => m.id === where.id && !m.deletedAt) || null;
      }),
      createQueryBuilder: jest.fn().mockImplementation(() => {
        const filters: ((m: MavisMemory) => boolean)[] = [(m) => !m.deletedAt];
        let limitCount = 50;

        const qb: Record<string, unknown> = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest
            .fn()
            .mockImplementation((_clause: string, _params?: Record<string, unknown>) => {
              filters.push((m) => !m.deletedAt);
              return qb;
            }),
          andWhere: jest
            .fn()
            .mockImplementation((clause: string, params?: Record<string, unknown>) => {
              if (clause.includes('status = :approved')) {
                filters.push((m) => m.status === MavisMemoryStatus.APPROVED);
              }
              if (clause.includes('validUntil > NOW()')) {
                filters.push((m) => !m.validUntil || new Date(m.validUntil) > new Date());
              }
              if (clause.includes('statement ILIKE :search')) {
                const query = String(params?.search || '')
                  .replace(/%/g, '')
                  .toLowerCase();
                filters.push(
                  (m) =>
                    m.statement.toLowerCase().includes(query) ||
                    Boolean(m.rationale?.toLowerCase().includes(query)),
                );
              }
              if (clause.includes('scopeType = :scopeType')) {
                filters.push((m) => m.scopeType === params?.scopeType);
              }
              if (clause.includes('status = :status')) {
                filters.push((m) => m.status === params?.status);
              }
              return qb;
            }),
          orderBy: jest.fn().mockReturnThis(),
          addOrderBy: jest.fn().mockReturnThis(),
          skip: jest.fn().mockReturnThis(),
          take: jest.fn().mockImplementation((num: number) => {
            limitCount = num;
            return qb;
          }),
          getMany: jest.fn().mockImplementation(async () => {
            return inMemoryMemories
              .filter((m) => filters.every((fn) => fn(m)))
              .slice(0, limitCount);
          }),
          getManyAndCount: jest.fn().mockImplementation(async () => {
            const filtered = inMemoryMemories.filter((m) => filters.every((fn) => fn(m)));
            return [filtered.slice(0, limitCount), filtered.length];
          }),
        };
        return qb;
      }),
    };

    dataSource = {
      transaction: jest.fn().mockImplementation(async (callback) => {
        const manager: { create: jest.Mock; save: jest.Mock; update: jest.Mock } = {
          update: jest.fn((_entity, where, patch) => memoryRepo.update!(where, patch)),
          create: jest.fn((entityClass: unknown, dto?: unknown) =>
            memoryRepo.create!((dto || entityClass) as never),
          ),
          save: jest.fn((entityClass: unknown, entity?: unknown) =>
            memoryRepo.save!((entity || entityClass) as never),
          ),
        };
        return callback(manager);
      }),
    };

    service = new MavisService(
      memoryRepo as Repository<MavisMemory>,
      memberRepo as Repository<ProjectMember>,
      userRepo as Repository<User>,
      goalRepo as Repository<Goal>,
      decisionRepo as Repository<Decision>,
      agentRunRepo as Repository<AgentRun>,
      messageRepo as Repository<ChatMessage>,
      retrievalService as RetrievalService,
      dataSource as DataSource,
    );
  });

  describe('1. Candidate Memory Creation', () => {
    it('proposes a candidate memory with status PROPOSED', async () => {
      const candidate = await service.proposeCandidate(userId, {
        statement: 'Prefer Postgres for relational structures',
        type: MavisMemoryType.DECISION,
        scopeType: MavisMemoryScopeType.PROJECT,
        projectId,
      });

      expect(candidate.status).toBe(MavisMemoryStatus.PROPOSED);
      expect(candidate.statement).toBe('Prefer Postgres for relational structures');
      expect(candidate.userId).toBe(userId);
      expect(candidate.projectId).toBe(projectId);
    });

    it('rejects candidate with empty or oversized statement', async () => {
      await expect(
        service.proposeCandidate(userId, {
          statement: '',
          type: MavisMemoryType.FACT,
          scopeType: MavisMemoryScopeType.PERSONAL,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.proposeCandidate(userId, {
          statement: 'a'.repeat(2001),
          type: MavisMemoryType.FACT,
          scopeType: MavisMemoryScopeType.PERSONAL,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates candidate memory from completed agent run with provenance', async () => {
      const candidate = await service.createCandidateFromAgentRun(userId, projectId, runId);

      expect(candidate.status).toBe(MavisMemoryStatus.PROPOSED);
      expect(candidate.type).toBe(MavisMemoryType.LESSON);
      expect(candidate.sourcePlatform).toBe('hermes');
      expect(candidate.sourceType).toBe(MavisSourceType.AGENT_RUN);
      expect(candidate.sourceId).toBe(runId);
      expect(candidate.statement).toContain('connection pooling avoids socket exhaustion');
    });

    it('creates candidate memory from project decision with provenance', async () => {
      const candidate = await service.createCandidateFromDecision(userId, projectId, decisionId);

      expect(candidate.status).toBe(MavisMemoryStatus.PROPOSED);
      expect(candidate.type).toBe(MavisMemoryType.DECISION);
      expect(candidate.sourcePlatform).toBe('oscar');
      expect(candidate.sourceType).toBe(MavisSourceType.DECISION);
      expect(candidate.sourceId).toBe(decisionId);
      expect(candidate.statement).toContain('Decision #42');
      expect(candidate.statement).toContain('Use PostgreSQL and pgvector');
    });
  });

  describe('2. Human Review Lifecycle (PROPOSED -> APPROVED / REJECTED / SUPERSEDED)', () => {
    it('approves a candidate memory, updating status to APPROVED and recording reviewer', async () => {
      const candidate = await service.proposeCandidate(userId, {
        statement: 'Release frequency is weekly',
        type: MavisMemoryType.FACT,
        scopeType: MavisMemoryScopeType.PROJECT,
        projectId,
      });

      const approved = await service.approve(userId, candidate.id, candidate.version);

      expect(approved.status).toBe(MavisMemoryStatus.APPROVED);
      expect(approved.reviewedBy).toBe(userId);
      expect(approved.reviewedAt).toBeDefined();
    });

    it('rejects a candidate memory, updating status to REJECTED with reason', async () => {
      const candidate = await service.proposeCandidate(userId, {
        statement: 'Deploy every 10 minutes automatically without tests',
        type: MavisMemoryType.HYPOTHESIS,
        scopeType: MavisMemoryScopeType.PROJECT,
        projectId,
      });

      const rejected = await service.reject(
        userId,
        candidate.id,
        'Too risky without automated tests',
        candidate.version,
      );

      expect(rejected.status).toBe(MavisMemoryStatus.REJECTED);
      expect(rejected.reviewedBy).toBe(userId);
      expect(rejected.rationale).toContain('Too risky without automated tests');
    });

    it('supersedes an approved memory with a new correction and links provenance', async () => {
      const initial = await service.proposeCandidate(userId, {
        statement: 'Database port is 5432',
        type: MavisMemoryType.FACT,
        scopeType: MavisMemoryScopeType.PROJECT,
        projectId,
      });
      const approved = await service.approve(userId, initial.id);

      const { superseded, replacement } = await service.supersede(
        userId,
        approved.id,
        'Database port is 55432 for isolated development',
        approved.version,
      );

      expect(superseded.status).toBe(MavisMemoryStatus.SUPERSEDED);
      expect(superseded.supersededById).toBe(replacement.id);

      expect(replacement.status).toBe(MavisMemoryStatus.APPROVED);
      expect(replacement.supersedesId).toBe(superseded.id);
      expect(replacement.statement).toBe('Database port is 55432 for isolated development');
    });

    it('enforces optimistic concurrency control on stale version', async () => {
      const candidate = await service.proposeCandidate(userId, {
        statement: 'Cache expiration is 60s',
        type: MavisMemoryType.FACT,
        scopeType: MavisMemoryScopeType.PROJECT,
        projectId,
      });

      await expect(service.approve(userId, candidate.id, 999)).rejects.toThrow(ConflictException);
    });
  });

  describe('3. Recall, Contradictions, Leakage, and Stale-source Measurements', () => {
    it('Exit criterion: retrieves relevant prior decision with provenance in context pack', async () => {
      // 1. Create candidate from decision
      const candidate = await service.createCandidateFromDecision(userId, projectId, decisionId);
      // 2. Human reviews and approves it
      await service.approve(userId, candidate.id);

      // 3. New agent session retrieves context
      const pack = await service.retrieveContext({
        actorId: userId,
        projectId,
        query: 'PostgreSQL',
      });

      expect(pack.approvedMemories.length).toBeGreaterThan(0);
      const retrieved = pack.approvedMemories[0]!;
      expect(retrieved.statement).toContain('Use PostgreSQL and pgvector');
      expect(retrieved.provenance.sourceType).toBe(MavisSourceType.DECISION);
      expect(retrieved.provenance.sourceId).toBe(decisionId);
      expect(retrieved.provenance.reviewedBy).toBe(userId);

      // Distinct architectural sections formatted
      expect(pack.formattedContext).toContain('REVIEWED CONTEXT] APPROVED MEMORIES');
      expect(pack.formattedContext).toContain('SOURCED EVIDENCE] PROJECT DOCUMENTS & FILES');
    });

    it('Contradiction test: superseded memory is excluded from active retrieval and replacement is returned', async () => {
      const original = await service.proposeCandidate(userId, {
        statement: 'Authentication token TTL is 15 minutes',
        type: MavisMemoryType.DECISION,
        scopeType: MavisMemoryScopeType.PROJECT,
        projectId,
      });
      const approved = await service.approve(userId, original.id);

      // Supersede with correction
      await service.supersede(userId, approved.id, 'Authentication token TTL is 60 minutes');

      // Query context for "Authentication"
      const pack = await service.retrieveContext({
        actorId: userId,
        projectId,
        query: 'Authentication',
      });

      expect(pack.approvedMemories.length).toBe(1);
      expect(pack.approvedMemories[0]!.statement).toBe('Authentication token TTL is 60 minutes');
      expect(pack.approvedMemories[0]!.provenance.supersedesId).toBe(approved.id);
      // Old claim not returned as approved
      expect(pack.formattedContext).not.toContain('Authentication token TTL is 15 minutes');
    });

    it('Recall test: candidate (PROPOSED) and REJECTED memories are NOT included in active context pack', async () => {
      await service.proposeCandidate(userId, {
        statement: 'Proposed unreviewed feature',
        type: MavisMemoryType.HYPOTHESIS,
        scopeType: MavisMemoryScopeType.PROJECT,
        projectId,
      });

      const rejectedCandidate = await service.proposeCandidate(userId, {
        statement: 'Rejected architecture proposal',
        type: MavisMemoryType.DECISION,
        scopeType: MavisMemoryScopeType.PROJECT,
        projectId,
      });
      await service.reject(userId, rejectedCandidate.id, 'Rejected');

      const pack = await service.retrieveContext({
        actorId: userId,
        projectId,
        query: 'architecture',
      });

      expect(pack.approvedMemories.length).toBe(0);
    });

    it('Leakage test: non-member of Project X is forbidden from retrieving Project X memories', async () => {
      await expect(
        service.retrieveContext({
          actorId: otherUserId, // other user is NOT a member of projectId
          projectId,
          query: 'database',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('Stale-source test: expired memory (validUntil in past) is excluded from active retrieval', async () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      const expiredCandidate = await service.proposeCandidate(userId, {
        statement: 'Temporary maintenance window on 2026-10-15',
        type: MavisMemoryType.FACT,
        scopeType: MavisMemoryScopeType.PROJECT,
        projectId,
        validUntil: pastDate,
      });
      await service.approve(userId, expiredCandidate.id);

      const pack = await service.retrieveContext({
        actorId: userId,
        projectId,
        query: 'maintenance',
      });

      expect(pack.approvedMemories.length).toBe(0);
    });
  });
  describe('security regressions', () => {
    it('denies another user direct reads, review and deletion of personal memory', async () => {
      const memory = await service.proposeCandidate(userId, {
        statement: 'Private preference',
        type: MavisMemoryType.PREFERENCE,
        scopeType: MavisMemoryScopeType.PERSONAL,
      });
      await expect(service.getById(otherUserId, memory.id)).rejects.toThrow(NotFoundException);
      await expect(service.approve(otherUserId, memory.id)).rejects.toThrow(NotFoundException);
      await expect(service.reject(otherUserId, memory.id)).rejects.toThrow(NotFoundException);
      await expect(service.delete(otherUserId, memory.id)).rejects.toThrow(NotFoundException);
    });
    it('does not trust a private run belonging to another user', async () => {
      (agentRunRepo.findOne as jest.Mock).mockResolvedValueOnce({
        id: runId,
        userId: otherUserId,
        projectId,
        status: AgentRunStatus.SUCCEEDED,
        artifact: 'Private output',
      });
      await expect(service.createCandidateFromAgentRun(userId, projectId, runId)).rejects.toThrow(
        NotFoundException,
      );
    });
    it('denies viewers memory mutations', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValue({
        accessRole: ProjectRole.VIEWER,
        project: { id: projectId, status: ProjectStatus.ACTIVE },
      });
      await expect(
        service.proposeCandidate(userId, {
          statement: 'Cannot write',
          type: MavisMemoryType.FACT,
          scopeType: MavisMemoryScopeType.PROJECT,
          projectId,
        }),
      ).rejects.toThrow();
    });
    it('does not reactivate superseded claims', async () => {
      const proposed = await service.proposeCandidate(userId, {
        statement: 'Old claim',
        type: MavisMemoryType.FACT,
        scopeType: MavisMemoryScopeType.PERSONAL,
      });
      const approved = await service.approve(userId, proposed.id);
      const corrected = await service.supersede(
        userId,
        approved.id,
        'Corrected claim',
        approved.version,
      );
      await expect(
        service.approve(userId, proposed.id, corrected.superseded.version),
      ).rejects.toThrow(ConflictException);
    });
    it('rejects an update that loses the database version race', async () => {
      const proposed = await service.proposeCandidate(userId, {
        statement: 'Race check',
        type: MavisMemoryType.FACT,
        scopeType: MavisMemoryScopeType.PERSONAL,
      });
      (memoryRepo.update as jest.Mock).mockResolvedValueOnce({ affected: 0 });
      await expect(service.approve(userId, proposed.id, proposed.version)).rejects.toThrow(
        ConflictException,
      );
    });
    it('keeps personal scope separate from shared project and goal scope', async () => {
      await expect(
        service.proposeCandidate(userId, {
          statement: 'Private note',
          type: MavisMemoryType.FACT,
          scopeType: MavisMemoryScopeType.PERSONAL,
          projectId,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
