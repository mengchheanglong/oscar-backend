import 'reflect-metadata';
import { Global, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { configureApp } from '../../src/common/configure-app';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { UsersModule } from '../../src/modules/users/users.module';
import { ProjectsModule } from '../../src/modules/projects/projects.module';
import { MavisModule } from '../../src/modules/mavis/mavis.module';
import { AuditModule } from '../../src/modules/audit/audit.module';
import { User, SystemRole, ProfessionalRole } from '../../src/modules/users/entities/user.entity';
import { Session } from '../../src/modules/auth/entities/session.entity';
import { Project, ProjectStatus } from '../../src/modules/projects/entities/project.entity';
import {
  ProjectMember,
  ProjectRole,
} from '../../src/modules/projects/entities/project-member.entity';
import { AuditLog } from '../../src/modules/audit/entities/audit-log.entity';
import { Goal } from '../../src/modules/goals/entities/goal.entity';
import { Decision } from '../../src/modules/decisions/entities/decision.entity';
import { AgentRun } from '../../src/modules/assistant/entities/agent-run.entity';
import { ChatMessage } from '../../src/modules/assistant/entities/chat-message.entity';
import {
  MavisMemory,
  MavisMemoryStatus,
} from '../../src/modules/mavis/entities/mavis-memory.entity';
import { MavisMemoryVector } from '../../src/modules/mavis/entities/mavis-memory-vector.entity';
import { PasswordService } from '../../src/modules/auth/services/password.service';
import { ApiKey } from '../../src/modules/auth/entities/api-key.entity';
import { WorkspaceInvitation } from '../../src/modules/users/entities/workspace-invitation.entity';
import { RetrievalService } from '../../src/modules/mavis/retrieval/retrieval.service';

describe('MAVIS API (E2E)', () => {
  let csrfA: string;
  let csrfB: string;
  let app: INestApplication;
  let passwordService: PasswordService;

  const users: User[] = [];
  const sessions: Session[] = [];
  const projects: Project[] = [];
  const projectMembers: ProjectMember[] = [];
  const auditLogs: AuditLog[] = [];
  const mavisMemories: MavisMemory[] = [];
  const decisions: Decision[] = [];
  const agentRuns: AgentRun[] = [];
  const messages: ChatMessage[] = [];
  const goals: Goal[] = [];

  const mockUserRepository = {
    create: jest.fn(
      (dto: Partial<User>) =>
        ({
          id: randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
          isActive: true,
          mustChangePassword: false,
          ...dto,
        }) as User,
    ),
    save: jest.fn(async (user: User) => {
      const idx = users.findIndex((u) => u.id === user.id);
      if (idx >= 0) users[idx] = user;
      else users.push(user);
      return user;
    }),
    findOne: jest.fn(async (opts: { where: { email?: string; id?: string } }) => {
      if (opts.where.email)
        return users.find((u) => u.email.toLowerCase() === opts.where.email?.toLowerCase()) ?? null;
      if (opts.where.id) return users.find((u) => u.id === opts.where.id) ?? null;
      return null;
    }),
    count: jest.fn(async () => users.length),
  };

  const mockSessionRepository = {
    create: jest.fn((dto: Partial<Session>) => ({ id: randomUUID(), ...dto }) as Session),
    save: jest.fn(async (session: Session) => {
      const idx = sessions.findIndex((s) => s.id === session.id);
      if (idx >= 0) sessions[idx] = session;
      else sessions.push(session);
      return session;
    }),
    findOne: jest.fn(async (opts: { where: { tokenHash?: string } }) => {
      if (opts.where.tokenHash) {
        const found = sessions.find((s) => s.tokenHash === opts.where.tokenHash);
        if (found) {
          const user = users.find((u) => u.id === found.userId);
          return { ...found, user };
        }
      }
      return null;
    }),
    update: jest.fn(async () => {}),
  };

  const mockProjectRepository = {
    create: jest.fn(
      (dto: Partial<Project>) =>
        ({
          id: randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
          status: ProjectStatus.ACTIVE,
          ...dto,
        }) as Project,
    ),
    save: jest.fn(async (project: Project) => {
      const idx = projects.findIndex((p) => p.id === project.id);
      if (idx >= 0) projects[idx] = project;
      else projects.push(project);
      return project;
    }),
    findOne: jest.fn(async (opts: { where: { id?: string } }) => {
      if (opts.where.id) return projects.find((p) => p.id === opts.where.id) ?? null;
      return null;
    }),
  };

  const mockProjectMemberRepository = {
    create: jest.fn(
      (dto: Partial<ProjectMember>) => ({ id: randomUUID(), ...dto }) as ProjectMember,
    ),
    save: jest.fn(async (member: ProjectMember) => {
      const idx = projectMembers.findIndex((m) => m.id === member.id);
      if (idx >= 0) projectMembers[idx] = member;
      else projectMembers.push(member);
      return member;
    }),
    findOne: jest.fn(async (opts: { where: { projectId?: string; userId?: string } }) => {
      const found = projectMembers.find(
        (m) =>
          m.projectId === opts.where.projectId &&
          m.userId === opts.where.userId &&
          m.removedAt === null,
      );
      if (found) {
        found.project = projects.find((p) => p.id === found.projectId)!;
        found.user = users.find((u) => u.id === found.userId)!;
      }
      return found ?? null;
    }),
    find: jest.fn(async (opts?: { where?: { userId?: string } }) => {
      if (opts?.where?.userId) {
        return projectMembers.filter(
          (m) => m.userId === opts.where!.userId && m.removedAt === null,
        );
      }
      return projectMembers.filter((m) => m.removedAt === null);
    }),
  };

  const mockAuditRepository = {
    create: jest.fn((dto: Partial<AuditLog>) => ({ id: randomUUID(), ...dto }) as AuditLog),
    save: jest.fn(async (log: AuditLog) => {
      auditLogs.push(log);
      return log;
    }),
  };

  const mockMavisMemoryRepository = {
    update: jest.fn(
      async (
        where: { id: string; version?: number; status?: MavisMemoryStatus },
        patch: Partial<MavisMemory>,
      ) => {
        const index = mavisMemories.findIndex(
          (m) =>
            m.id === where.id &&
            (where.version === undefined || m.version === where.version) &&
            (where.status === undefined || m.status === where.status),
        );
        if (index < 0) return { affected: 0 };
        mavisMemories[index] = { ...mavisMemories[index]!, ...patch };
        return { affected: 1 };
      },
    ),
    create: jest.fn(
      (dto: Partial<MavisMemory>) =>
        ({
          id: randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          status: MavisMemoryStatus.PROPOSED,
          version: 1,
          ...dto,
        }) as MavisMemory,
    ),
    save: jest.fn(async (mem: MavisMemory) => {
      const idx = mavisMemories.findIndex((m) => m.id === mem.id);
      if (idx >= 0) mavisMemories[idx] = mem;
      else mavisMemories.push(mem);
      return mem;
    }),
    findOne: jest.fn(async (opts: { where: { id?: string; userId?: string } }) => {
      return (
        mavisMemories.find((m) => {
          if (opts.where.id && m.id !== opts.where.id) return false;
          if (opts.where.userId && m.userId !== opts.where.userId) return false;
          if (m.deletedAt !== null) return false;
          return true;
        }) ?? null
      );
    }),
    createQueryBuilder: jest.fn(() => {
      const filters: ((m: MavisMemory) => boolean)[] = [(m) => m.deletedAt === null];
      let limitCount = 50;

      const qb: Record<string, unknown> = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest
          .fn()
          .mockImplementation((clause: string, params?: Record<string, unknown>) => {
            if (clause.includes('status = :approved')) {
              filters.push((m) => m.status === MavisMemoryStatus.APPROVED);
            }
            if (clause.includes('status = :status') && params?.status) {
              filters.push((m) => m.status === params.status);
            }
            if (clause.includes('statement ILIKE :search')) {
              const searchStr = typeof params?.search === 'string' ? params.search : '';
              const query = searchStr.replace(/%/g, '').toLowerCase();
              filters.push((m) => m.statement.toLowerCase().includes(query));
            }
            return qb;
          }),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockImplementation((n: number) => {
          limitCount = n;
          return qb;
        }),
        getMany: jest.fn().mockImplementation(async () => {
          return mavisMemories.filter((m) => filters.every((fn) => fn(m))).slice(0, limitCount);
        }),
        getManyAndCount: jest.fn().mockImplementation(async () => {
          const list = mavisMemories.filter((m) => filters.every((fn) => fn(m)));
          return [list.slice(0, limitCount), list.length];
        }),
      };
      return qb;
    }),
  };

  const mockDecisionRepository = {
    findOne: jest.fn(async (opts: { where: { id?: string } }) => {
      return decisions.find((d) => d.id === opts.where.id && !d.deletedAt) ?? null;
    }),
  };

  const mockAgentRunRepository = {
    findOne: jest.fn(async (opts: { where: { id?: string } }) => {
      return agentRuns.find((r) => r.id === opts.where.id) ?? null;
    }),
    find: jest.fn(async () => agentRuns),
  };

  const mockMessageRepository = {
    findOne: jest.fn(async (opts: { where: { id?: string } }) => {
      return messages.find((m) => m.id === opts.where.id) ?? null;
    }),
    createQueryBuilder: jest.fn(() => ({
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    })),
  };

  const mockGoalRepository = {
    findOne: jest.fn(async (opts: { where: { id?: string } }) => {
      return goals.find((g) => g.id === opts.where.id && !g.deletedAt) ?? null;
    }),
  };

  const mockRetrievalService = {
    retrieve: jest.fn().mockResolvedValue([]),
  };

  const mockEntityManager = {
    update: jest.fn(
      (
        _entity: unknown,
        where: { id: string; version?: number; status?: MavisMemoryStatus },
        patch: Partial<MavisMemory>,
      ) => mockMavisMemoryRepository.update(where, patch),
    ),
    create: jest.fn((entityClass: unknown, dto: unknown) => {
      if (entityClass === MavisMemory)
        return mockMavisMemoryRepository.create(dto as Partial<MavisMemory>);
      return { id: randomUUID(), ...(dto as object) };
    }),
    save: jest.fn(async (entityClass: unknown, entity: unknown) => {
      if (entityClass === MavisMemory) return mockMavisMemoryRepository.save(entity as MavisMemory);
      return entity;
    }),
  };

  const mockDataSource = {
    entityMetadatas: [] as unknown[],
    options: { type: 'postgres' },
    transaction: jest.fn(async (cb: (manager: unknown) => Promise<unknown>) =>
      cb(mockEntityManager),
    ),
    getRepository: jest.fn((entityClass: unknown) => {
      if (entityClass === MavisMemory) return mockMavisMemoryRepository;
      if (entityClass === MavisMemoryVector) return {};
      if (entityClass === User) return mockUserRepository;
      if (entityClass === ProjectMember) return mockProjectMemberRepository;
      if (entityClass === Project) return mockProjectRepository;
      if (entityClass === Goal) return mockGoalRepository;
      if (entityClass === Decision) return mockDecisionRepository;
      if (entityClass === AgentRun) return mockAgentRunRepository;
      if (entityClass === ChatMessage) return mockMessageRepository;
      if (entityClass === AuditLog) return mockAuditRepository;
      if (entityClass === Session) return mockSessionRepository;
      return mockMavisMemoryRepository;
    }),
  };

  @Global()
  @Module({
    providers: [
      { provide: getRepositoryToken(User), useValue: mockUserRepository },
      { provide: getRepositoryToken(Session), useValue: mockSessionRepository },
      { provide: getRepositoryToken(Project), useValue: mockProjectRepository },
      { provide: getRepositoryToken(ProjectMember), useValue: mockProjectMemberRepository },
      { provide: getRepositoryToken(AuditLog), useValue: mockAuditRepository },
      { provide: getRepositoryToken(MavisMemory), useValue: mockMavisMemoryRepository },
      { provide: getRepositoryToken(MavisMemoryVector), useValue: {} },
      { provide: getRepositoryToken(Decision), useValue: mockDecisionRepository },
      { provide: getRepositoryToken(AgentRun), useValue: mockAgentRunRepository },
      { provide: getRepositoryToken(ChatMessage), useValue: mockMessageRepository },
      { provide: getRepositoryToken(Goal), useValue: mockGoalRepository },
      { provide: getRepositoryToken(ApiKey), useValue: {} },
      { provide: getRepositoryToken(WorkspaceInvitation), useValue: {} },
      { provide: RetrievalService, useValue: mockRetrievalService },
      { provide: DataSource, useValue: mockDataSource },
      {
        provide: ConfigService,
        useValue: new ConfigService({
          NODE_ENV: 'development',
          PORT: 3000,
          APP_ORIGIN: 'http://localhost:3001',
          SESSION_IDLE_HOURS: 8,
          SESSION_ABSOLUTE_DAYS: 7,
          STORAGE_LOCAL_ROOT: './var/uploads',
        }),
      },
    ],
    exports: [
      getRepositoryToken(User),
      getRepositoryToken(Session),
      getRepositoryToken(Project),
      getRepositoryToken(ProjectMember),
      getRepositoryToken(AuditLog),
      getRepositoryToken(MavisMemory),
      getRepositoryToken(MavisMemoryVector),
      getRepositoryToken(Decision),
      getRepositoryToken(AgentRun),
      getRepositoryToken(ChatMessage),
      getRepositoryToken(Goal),
      getRepositoryToken(ApiKey),
      getRepositoryToken(WorkspaceInvitation),
      RetrievalService,
      DataSource,
      ConfigService,
    ],
  })
  class TestDbModule {}

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestDbModule, AuthModule, UsersModule, ProjectsModule, AuditModule, MavisModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    passwordService = moduleRef.get<PasswordService>(PasswordService);
  });

  afterAll(async () => {
    await app?.close();
  });

  function extractCookies(res: request.Response): string[] {
    const header = res.headers['set-cookie'];
    if (!header) return [];
    const array = Array.isArray(header) ? header : [header];
    return array.map((c) => c.split(';')[0].trim());
  }

  let userA: User;
  let userB: User;
  let projectA: Project;
  let projectB: Project;
  let cookiesA: string[];
  let cookiesB: string[];

  beforeEach(async () => {
    users.length = 0;
    sessions.length = 0;
    projects.length = 0;
    projectMembers.length = 0;
    auditLogs.length = 0;
    mavisMemories.length = 0;
    decisions.length = 0;
    agentRuns.length = 0;

    const pwHash = await passwordService.hash('Password123!');

    userA = mockUserRepository.create({
      email: 'user-a@example.com',
      displayName: 'User A',
      passwordHash: pwHash,
      systemRole: SystemRole.USER,
      professionalRole: ProfessionalRole.DEVELOPER,
      isActive: true,
    });
    users.push(userA);

    userB = mockUserRepository.create({
      email: 'user-b@example.com',
      displayName: 'User B',
      passwordHash: pwHash,
      systemRole: SystemRole.USER,
      professionalRole: ProfessionalRole.DEVELOPER,
      isActive: true,
    });
    users.push(userB);

    projectA = mockProjectRepository.create({
      name: 'Project Alpha',
      key: 'ALPHA',
      description: 'Project Alpha',
      createdBy: userA.id,
      status: ProjectStatus.ACTIVE,
    });
    projects.push(projectA);

    projectMembers.push(
      mockProjectMemberRepository.create({
        projectId: projectA.id,
        userId: userA.id,
        accessRole: ProjectRole.OWNER,
        removedAt: null,
      }),
    );

    projectB = mockProjectRepository.create({
      name: 'Project Beta',
      key: 'BETA',
      description: 'Project Beta',
      createdBy: userB.id,
      status: ProjectStatus.ACTIVE,
    });
    projects.push(projectB);

    projectMembers.push(
      mockProjectMemberRepository.create({
        projectId: projectB.id,
        userId: userB.id,
        accessRole: ProjectRole.OWNER,
        removedAt: null,
      }),
    );

    // Login user A
    const loginResA = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      email: 'user-a@example.com',
      password: 'Password123!',
    });
    cookiesA = extractCookies(loginResA);
    csrfA = loginResA.body.data.csrfToken;

    // Login user B
    const loginResB = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      email: 'user-b@example.com',
      password: 'Password123!',
    });
    cookiesB = extractCookies(loginResB);
    csrfB = loginResB.body.data.csrfToken;
  });

  describe('Full MAVIS End-to-End Flow', () => {
    it('proposes a candidate memory, reviews it (approves), supersedes it, and tests permissioned retrieval', async () => {
      // 1. User A proposes a candidate memory for Project Alpha
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/mavis/memories/candidate')
        .set('Cookie', cookiesA)
        .set('x-csrf-token', csrfA)
        .send({
          statement: 'Use PostgreSQL for persistent continuity',
          type: 'DECISION',
          scopeType: 'PROJECT',
          projectId: projectA.id,
          sourcePlatform: 'continuum',
          sourceType: 'MANUAL',
        })
        .expect(201);

      const candidateId = createRes.body.data.id;
      expect(createRes.body.data.status).toBe('PROPOSED');
      expect(createRes.body.data.statement).toBe('Use PostgreSQL for persistent continuity');

      // 2. User A lists memories filtering by PROPOSED
      const listCandidatesRes = await request(app.getHttpServer())
        .get('/api/v1/mavis/memories?status=PROPOSED')
        .set('Cookie', cookiesA)
        .set('x-csrf-token', csrfA)
        .expect(200);

      expect(listCandidatesRes.body.data.items.length).toBeGreaterThan(0);

      // 3. User A approves candidate memory
      const approveRes = await request(app.getHttpServer())
        .post(`/api/v1/mavis/memories/${candidateId}/approve`)
        .set('Cookie', cookiesA)
        .set('x-csrf-token', csrfA)
        .send({ expectedVersion: 1 })
        .expect(200);

      expect(approveRes.body.data.status).toBe('APPROVED');
      expect(approveRes.body.data.reviewedBy).toBe(userA.id);

      // 4. Retrieve context: should find approved memory
      const retrieveRes = await request(app.getHttpServer())
        .post('/api/v1/mavis/context/retrieve')
        .set('Cookie', cookiesA)
        .set('x-csrf-token', csrfA)
        .send({
          query: 'PostgreSQL',
          projectId: projectA.id,
        })
        .expect(200);

      expect(retrieveRes.body.data.approvedMemories.length).toBe(1);
      expect(retrieveRes.body.data.approvedMemories[0].statement).toBe(
        'Use PostgreSQL for persistent continuity',
      );
      expect(retrieveRes.body.data.formattedContext).toContain(
        'REVIEWED CONTEXT] APPROVED MEMORIES',
      );

      // 5. User A supersedes approved memory with updated correction
      const supersedeRes = await request(app.getHttpServer())
        .post(`/api/v1/mavis/memories/${candidateId}/supersede`)
        .set('Cookie', cookiesA)
        .set('x-csrf-token', csrfA)
        .send({
          supersedingStatement:
            'Use PostgreSQL with pgvector for persistent continuity and embeddings',
          expectedVersion: approveRes.body.data.version,
        })
        .expect(200);

      expect(supersedeRes.body.data.superseded.status).toBe('SUPERSEDED');
      expect(supersedeRes.body.data.replacement.status).toBe('APPROVED');
      expect(supersedeRes.body.data.replacement.statement).toContain('pgvector');

      // 6. Retrieve context again: should return replacement, NOT old superseded claim
      const retrieveUpdatedRes = await request(app.getHttpServer())
        .post('/api/v1/mavis/context/retrieve')
        .set('Cookie', cookiesA)
        .set('x-csrf-token', csrfA)
        .send({
          query: 'PostgreSQL',
          projectId: projectA.id,
        })
        .expect(200);

      expect(retrieveUpdatedRes.body.data.approvedMemories.length).toBe(1);
      expect(retrieveUpdatedRes.body.data.approvedMemories[0].statement).toContain('pgvector');
    });

    it('Enforces access control and project scoping: User B cannot retrieve Project Alpha memories', async () => {
      // User A creates and approves a memory in Project Alpha
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/mavis/memories/candidate')
        .set('Cookie', cookiesA)
        .set('x-csrf-token', csrfA)
        .send({
          statement: 'Secret project alpha strategy',
          type: 'DECISION',
          scopeType: 'PROJECT',
          projectId: projectA.id,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/mavis/memories/${createRes.body.data.id}/approve`)
        .set('Cookie', cookiesA)
        .set('x-csrf-token', csrfA)
        .expect(200);

      // User B attempts to retrieve context for Project Alpha
      await request(app.getHttpServer())
        .post('/api/v1/mavis/context/retrieve')
        .set('Cookie', cookiesB)
        .set('x-csrf-token', csrfB)
        .send({
          query: 'secret',
          projectId: projectA.id, // User B is not a member!
        })
        .expect(404);
    });
  });
});
