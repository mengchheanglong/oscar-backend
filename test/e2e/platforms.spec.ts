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
import { PlatformsModule } from '../../src/modules/platforms/platforms.module';
import { AuditModule } from '../../src/modules/audit/audit.module';
import { User, SystemRole, ProfessionalRole } from '../../src/modules/users/entities/user.entity';
import { Session } from '../../src/modules/auth/entities/session.entity';
import { Project, ProjectStatus } from '../../src/modules/projects/entities/project.entity';
import {
  ProjectMember,
  ProjectRole,
} from '../../src/modules/projects/entities/project-member.entity';
import { AuditLog } from '../../src/modules/audit/entities/audit-log.entity';
import {
  Goal,
  GoalStatus,
  GoalCategory,
  GoalReviewCadence,
} from '../../src/modules/goals/entities';
import {
  PlatformConnection,
  PlatformConnectionStatus,
  PlatformType,
  PlatformAuthType,
} from '../../src/modules/platforms/entities/platform-connection.entity';
import {
  ExternalEntityType,
  ExternalLink,
} from '../../src/modules/platforms/entities/external-link.entity';
import { PasswordService } from '../../src/modules/auth/services/password.service';
import { ApiKey } from '../../src/modules/auth/entities/api-key.entity';
import { WorkspaceInvitation } from '../../src/modules/users/entities/workspace-invitation.entity';
import {
  PaperclipAdapter,
  PAPERCLIP_CAPABILITIES,
} from '../../src/modules/platforms/adapters/paperclip.adapter';
import { T3Adapter, T3_CAPABILITIES } from '../../src/modules/platforms/adapters/t3.adapter';

describe('Platforms API (E2E)', () => {
  let csrfToken: string;
  let app: INestApplication;
  let passwordService: PasswordService;

  const users: User[] = [];
  const sessions: Session[] = [];
  const projects: Project[] = [];
  const projectMembers: ProjectMember[] = [];
  const auditLogs: AuditLog[] = [];
  const connections: PlatformConnection[] = [];
  const externalLinks: ExternalLink[] = [];
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
          systemRole: SystemRole.USER,
          professionalRole: ProfessionalRole.DEVELOPER,
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastLoginAt: null,
          passwordHash: 'hash',
          ...dto,
        }) as User,
    ),
    save: jest.fn(async (user: User) => {
      const idx = users.findIndex((u) => u.id === user.id);
      if (idx >= 0) users[idx] = user;
      else users.push(user);
      return user;
    }),
    findOne: jest.fn(async (opts: { where?: { email?: string; id?: string } }) => {
      if (opts?.where?.email)
        return (
          users.find((u) => u.email.toLowerCase() === opts.where!.email!.toLowerCase()) ?? null
        );
      if (opts?.where?.id) return users.find((u) => u.id === opts.where!.id) ?? null;
      return null;
    }),
    count: jest.fn(async () => users.length),
  };

  const mockSessionRepository = {
    create: jest.fn(
      (dto: Partial<Session>) =>
        ({
          id: randomUUID(),
          createdAt: new Date(),
          lastSeenAt: new Date(),
          ipAddress: '127.0.0.1',
          userAgent: 'test-agent',
          ...dto,
        }) as Session,
    ),
    save: jest.fn(async (s: Session) => {
      sessions.push(s);
      return s;
    }),
    findOne: jest.fn(async ({ where }) => {
      if (where.tokenHash) {
        const found = sessions.find((s) => s.tokenHash === where.tokenHash);
        if (found) {
          const user = users.find((u) => u.id === found.userId);
          return { ...found, user };
        }
      }
      if (where.id) return sessions.find((s) => s.id === where.id) ?? null;
      return null;
    }),
    update: jest.fn(async () => {}),
    delete: jest.fn(async (crit) => {
      if (crit.id) {
        const i = sessions.findIndex((s) => s.id === crit.id);
        if (i >= 0) sessions.splice(i, 1);
      }
    }),
  };

  const mockProjectRepository = {
    create: jest.fn((dto) => ({
      id: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...dto,
    })),
    save: jest.fn(async (p) => {
      projects.push(p);
      return p;
    }),
    findOne: jest.fn(async ({ where }) => projects.find((p) => p.id === where.id) ?? null),
  };

  const mockProjectMemberRepository = {
    create: jest.fn((dto) => ({ id: randomUUID(), joinedAt: new Date(), ...dto })),
    save: jest.fn(async (m) => {
      projectMembers.push(m);
      return m;
    }),
    findOne: jest.fn(async ({ where }) => {
      return (
        projectMembers.find((m) => {
          return m.projectId === where.projectId && m.userId === where.userId && !m.removedAt;
        }) ?? null
      );
    }),
    find: jest.fn(async ({ where }) => {
      return projectMembers.filter((m) => m.userId === where.userId && !m.removedAt);
    }),
  };

  const mockConnectionRepository = {
    create: jest.fn((dto) => ({
      id: randomUUID(),
      status: PlatformConnectionStatus.HEALTHY,
      capabilities: [],
      versionInfo: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      ...dto,
    })),
    save: jest.fn(async (conn: PlatformConnection) => {
      const idx = connections.findIndex((c) => c.id === conn.id);
      if (idx >= 0) {
        connections[idx] = { ...connections[idx], ...conn };
        return connections[idx];
      }
      connections.push(conn);
      return conn;
    }),
    findOne: jest.fn(async ({ where }) => {
      return connections.find((c) => c.id === where.id) ?? null;
    }),
    remove: jest.fn(async (conn: PlatformConnection) => {
      const idx = connections.findIndex((c) => c.id === conn.id);
      if (idx >= 0) connections.splice(idx, 1);
    }),
    createQueryBuilder: jest.fn(() => {
      const filters: ((c: PlatformConnection) => boolean)[] = [];
      let limitCount = 50;

      const qb: Record<string, unknown> = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockImplementation((clause: string, params?: Record<string, unknown>) => {
          if (clause.includes('conn.projectId = :projectId')) {
            filters.push((c) => c.projectId === params?.projectId);
          } else if (clause.includes('conn.userId = :actorId')) {
            filters.push(
              (c) =>
                c.userId === params?.actorId ||
                (Array.isArray(params?.accessibleProjectIds) &&
                  params.accessibleProjectIds.includes(c.projectId)),
            );
          }
          return qb;
        }),
        andWhere: jest
          .fn()
          .mockImplementation((clause: string, params?: Record<string, unknown>) => {
            if (clause.includes('conn.platformType = :platformType')) {
              filters.push((c) => c.platformType === params?.platformType);
            }
            if (clause.includes('conn.status = :status')) {
              filters.push((c) => c.status === params?.status);
            }
            return qb;
          }),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockImplementation((num: number) => {
          limitCount = num;
          return qb;
        }),
        getManyAndCount: jest.fn().mockImplementation(async () => {
          const filtered = connections.filter((c) => filters.every((fn) => fn(c)));
          return [filtered.slice(0, limitCount), filtered.length];
        }),
      };
      return qb;
    }),
  };

  const mockLinkRepository = {
    create: jest.fn((dto) => ({
      id: randomUUID(),
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      ...dto,
    })),
    save: jest.fn(async (l: ExternalLink) => {
      const idx = externalLinks.findIndex((x) => x.id === l.id);
      if (idx >= 0) {
        externalLinks[idx] = { ...externalLinks[idx], ...l };
        return externalLinks[idx];
      }
      externalLinks.push(l);
      return l;
    }),
    findOne: jest.fn(async ({ where }) => {
      return externalLinks.find((l) => l.id === where.id) ?? null;
    }),
    remove: jest.fn(async (l: ExternalLink) => {
      const idx = externalLinks.findIndex((x) => x.id === l.id);
      if (idx >= 0) externalLinks.splice(idx, 1);
    }),
    createQueryBuilder: jest.fn(() => {
      const filters: ((l: ExternalLink) => boolean)[] = [];
      let limitCount = 50;

      const qb: Record<string, unknown> = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockImplementation((clause: string, params?: Record<string, unknown>) => {
          if (clause.includes('link.projectId = :projectId')) {
            filters.push((l) => l.projectId === params?.projectId);
          } else if (clause.includes('link.userId = :actorId')) {
            filters.push(
              (l) =>
                l.userId === params?.actorId ||
                (Array.isArray(params?.accessibleProjectIds) &&
                  params.accessibleProjectIds.includes(l.projectId)),
            );
          }
          return qb;
        }),
        andWhere: jest
          .fn()
          .mockImplementation((clause: string, params?: Record<string, unknown>) => {
            if (clause.includes('link.goalId = :goalId')) {
              filters.push((l) => l.goalId === params?.goalId);
            }
            if (clause.includes('link.platformType = :platformType')) {
              filters.push((l) => l.platformType === params?.platformType);
            }
            return qb;
          }),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockImplementation((num: number) => {
          limitCount = num;
          return qb;
        }),
        getManyAndCount: jest.fn().mockImplementation(async () => {
          const filtered = externalLinks.filter((l) => filters.every((fn) => fn(l)));
          return [filtered.slice(0, limitCount), filtered.length];
        }),
      };
      return qb;
    }),
  };

  const mockGoalRepository = {
    findOne: jest.fn(async ({ where }) => goals.find((g) => g.id === where.id) ?? null),
  };

  const mockAuditLogRepository = {
    create: jest.fn((dto) => ({ id: randomUUID(), createdAt: new Date(), ...dto })),
    save: jest.fn(async (log) => {
      auditLogs.push(log);
      return log;
    }),
  };

  const mockApiKeyRepository = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
  };

  const mockInvitationRepository = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
  };

  const mockDataSource = {
    entityMetadatas: [] as unknown[],
    options: { type: 'postgres' },
    transaction: jest.fn().mockImplementation(async (callback) => {
      return callback({
        create: (entityClass: unknown, dto?: unknown) => ({
          ...((dto || entityClass) as Record<string, unknown>),
        }),
        save: (entityClass: unknown, entity?: unknown) => entity || entityClass,
      });
    }),
    getRepository: jest.fn((entityClass: unknown) => {
      if (entityClass === PlatformConnection) return mockConnectionRepository;
      if (entityClass === ExternalLink) return mockLinkRepository;
      if (entityClass === User) return mockUserRepository;
      if (entityClass === ProjectMember) return mockProjectMemberRepository;
      if (entityClass === Project) return mockProjectRepository;
      if (entityClass === Goal) return mockGoalRepository;
      if (entityClass === AuditLog) return mockAuditLogRepository;
      if (entityClass === Session) return mockSessionRepository;
      if (entityClass === ApiKey) return mockApiKeyRepository;
      if (entityClass === WorkspaceInvitation) return mockInvitationRepository;
      return mockConnectionRepository;
    }),
  };

  let testUser: User;
  let testProject: Project;
  let sessionCookie: string[];

  function extractCookies(res: request.Response): string[] {
    const header = res.headers['set-cookie'];
    if (!header) return [];
    const array = Array.isArray(header) ? header : [header];
    return array.map((c) => c.split(';')[0]!.trim());
  }

  beforeAll(async () => {
    @Global()
    @Module({
      providers: [
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
        { provide: DataSource, useValue: mockDataSource },
        { provide: getRepositoryToken(User), useValue: mockUserRepository },
        { provide: getRepositoryToken(Session), useValue: mockSessionRepository },
        { provide: getRepositoryToken(Project), useValue: mockProjectRepository },
        { provide: getRepositoryToken(ProjectMember), useValue: mockProjectMemberRepository },
        { provide: getRepositoryToken(PlatformConnection), useValue: mockConnectionRepository },
        { provide: getRepositoryToken(ExternalLink), useValue: mockLinkRepository },
        { provide: getRepositoryToken(Goal), useValue: mockGoalRepository },
        { provide: getRepositoryToken(AuditLog), useValue: mockAuditLogRepository },
        { provide: getRepositoryToken(ApiKey), useValue: mockApiKeyRepository },
        { provide: getRepositoryToken(WorkspaceInvitation), useValue: mockInvitationRepository },
      ],
      exports: [
        ConfigService,
        DataSource,
        getRepositoryToken(User),
        getRepositoryToken(Session),
        getRepositoryToken(Project),
        getRepositoryToken(ProjectMember),
        getRepositoryToken(PlatformConnection),
        getRepositoryToken(ExternalLink),
        getRepositoryToken(Goal),
        getRepositoryToken(AuditLog),
        getRepositoryToken(ApiKey),
        getRepositoryToken(WorkspaceInvitation),
      ],
    })
    class MockDbModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        MockDbModule,
        AuthModule,
        UsersModule,
        ProjectsModule,
        PlatformsModule,
        AuditModule,
      ],
    })
      .overrideProvider(PaperclipAdapter)
      .useValue({
        platformType: PlatformType.PAPERCLIP,
        checkHealth: jest.fn().mockResolvedValue({
          status: PlatformConnectionStatus.HEALTHY,
          capabilities: PAPERCLIP_CAPABILITIES,
          versionInfo: { apiVersion: '1.2.0', versionDrift: false },
        }),
        fetchEntities: jest.fn().mockResolvedValue({
          type: PlatformType.PAPERCLIP,
          data: {
            agents: [{ id: 'ag-1', name: 'Strategic Planner', status: 'ACTIVE' }],
            teams: [{ id: 'tm-1', name: 'Execution Unit', memberCount: 2 }],
            issues: [
              {
                id: 'iss-1',
                title: 'Verify platform connectivity',
                status: 'OPEN',
                url: 'https://paperclip.test/issues/iss-1',
              },
            ],
          },
        }),
        fetchEntity: jest.fn().mockResolvedValue({
          found: true,
          accessible: true,
          entityType: ExternalEntityType.ISSUE,
          id: 'iss-1',
          title: 'Verify platform connectivity',
          url: 'https://paperclip.test/issues/iss-1',
        }),
      })
      .overrideProvider(T3Adapter)
      .useValue({
        platformType: PlatformType.T3,
        checkHealth: jest.fn().mockResolvedValue({
          status: PlatformConnectionStatus.HEALTHY,
          capabilities: T3_CAPABILITIES,
          versionInfo: { apiVersion: '1.0.0', versionDrift: false },
        }),
        fetchEntities: jest.fn().mockResolvedValue({
          type: PlatformType.T3,
          data: {
            workspaces: [{ id: 'ws-1', name: 'Continuum Backend' }],
            threads: [
              {
                id: 'th-1',
                title: 'Phase 3 Implementation',
                status: 'ACTIVE',
                url: 'https://t3.test/threads/th-1',
              },
            ],
            runs: [
              {
                id: 'run-1',
                threadId: 'th-1',
                status: 'COMPLETED',
                url: 'https://t3.test/runs/run-1',
              },
            ],
          },
        }),
        fetchEntity: jest.fn().mockResolvedValue({
          found: true,
          accessible: true,
          entityType: ExternalEntityType.THREAD,
          id: 'th-1',
          title: 'Phase 3 Implementation',
          url: 'https://t3.test/threads/th-1',
        }),
      })
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    passwordService = app.get(PasswordService);

    // Create test user and project
    const passwordHash = await passwordService.hash('Password123!');
    testUser = await mockUserRepository.save(
      mockUserRepository.create({
        email: 'founder@oscar.local',
        passwordHash,
        displayName: 'Founder User',
        isActive: true,
      }),
    );

    testProject = await mockProjectRepository.save(
      mockProjectRepository.create({
        name: 'OSCAR Core',
        slug: 'oscar-core',
        ownerId: testUser.id,
        status: ProjectStatus.ACTIVE,
      }),
    );

    await mockProjectMemberRepository.save(
      mockProjectMemberRepository.create({
        projectId: testProject.id,
        userId: testUser.id,
        accessRole: ProjectRole.OWNER,
        removedAt: null,
      }),
    );

    // Create a goal
    goals.push({
      id: randomUUID(),
      userId: testUser.id,
      projectId: testProject.id,
      title: 'Platform Interoperability',
      description: 'Connect Paperclip and T3',
      motivation: 'Prove multi-agent coordination',
      status: GoalStatus.ACTIVE,
      timeframe: 'Q4 2026',
      startDate: '2026-10-01',
      targetDate: '2026-12-31',
      baseline: '0 platforms',
      target: '2 platforms',
      progress: 50,
      confidence: null,
      category: GoalCategory.BUSINESS,
      dependencies: null,
      risks: null,
      reviewCadence: GoalReviewCadence.WEEKLY,
      initiatives: [],
      milestones: [],
      version: 1,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      metrics: [],
      revisions: [],
      project: testProject,
    });

    // Authenticate test user
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'founder@oscar.local', password: 'Password123!' });

    sessionCookie = extractCookies(loginRes);
    csrfToken = loginRes.body.data.csrfToken;
    process.env.PLATFORM_ALLOWED_ORIGINS =
      'https://paperclip.test,https://t3.test,http://localhost:3100';
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('Unauthenticated access', () => {
    it('returns 401 when not logged in', async () => {
      await request(app.getHttpServer()).get('/api/v1/platforms/connections').expect(401);
      await request(app.getHttpServer()).get('/api/v1/platforms/overview').expect(401);
    });
  });

  describe('Connection Registry CRUD', () => {
    let createdConnId: string;

    it('creates a new Paperclip connection in read-only mode', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/platforms/connections')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          name: 'Paperclip Production',
          platformType: PlatformType.PAPERCLIP,
          baseUrl: 'https://paperclip.test',
          authType: PlatformAuthType.BEARER,
          authToken: 'p-secret-key-8888',
          projectId: testProject.id,
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('Paperclip Production');
      expect(res.body.status).toBe(PlatformConnectionStatus.HEALTHY);
      expect(res.body.authToken).toBe('[configured]');
      expect(res.body.capabilities).toEqual(PAPERCLIP_CAPABILITIES);

      createdConnId = res.body.id;
    });

    it('creates a new T3 connection in read-only mode', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/platforms/connections')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          name: 'T3 Code Local',
          platformType: PlatformType.T3,
          baseUrl: 'http://localhost:3100',
          authType: PlatformAuthType.BEARER,
          projectId: testProject.id,
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.platformType).toBe(PlatformType.T3);
      expect(res.body.authToken).toBeNull();
      expect(res.body.authType).toBe(PlatformAuthType.OAUTH);
      expect(res.body.status).toBe(PlatformConnectionStatus.DISCONNECTED);
    });

    it('lists connections and masks auth tokens', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/platforms/connections')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .expect(200);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.total).toBe(2);
      expect(
        res.body.items
          .filter((item: { authToken?: string | null }) => item.authToken)
          .every((item: { authToken?: string | null }) => item.authToken === '[configured]'),
      ).toBe(true);
    });

    it('retrieves single connection by ID', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/platforms/connections/${createdConnId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .expect(200);

      expect(res.body.id).toBe(createdConnId);
      expect(res.body.name).toBe('Paperclip Production');
    });

    it('returns the typed activity snapshot inside the API data envelope', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/platforms/connections/${createdConnId}/entities`)
        .set('Cookie', sessionCookie)
        .expect(200);
      expect(res.body.data.type).toBe(PlatformType.PAPERCLIP);
      expect(res.body.data.data.issues[0].id).toBe('iss-1');
    });

    it('updates connection details', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/platforms/connections/${createdConnId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Paperclip Staging' })
        .expect(200);

      expect(res.body.name).toBe('Paperclip Staging');
    });

    it('triggers a health check probe', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/platforms/connections/${createdConnId}/test`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .expect(200);

      expect(res.body.status).toBe(PlatformConnectionStatus.HEALTHY);
    });
  });

  describe('External Links Mapping', () => {
    let linkId: string;

    it('creates an external link mapping an issue to a goal and project', async () => {
      const conn = connections[0]!;
      const goal = goals[0]!;

      const res = await request(app.getHttpServer())
        .post('/api/v1/platforms/links')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          connectionId: conn.id,
          externalEntityType: ExternalEntityType.ISSUE,
          externalId: 'iss-1',
          externalTitle: 'Verify platform connectivity',
          externalUrl: 'https://paperclip.test/issues/iss-1',
          projectId: testProject.id,
          goalId: goal.id,
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.externalId).toBe('iss-1');
      expect(res.body.goalId).toBe(goal.id);

      linkId = res.body.id;
    });

    it('lists external links', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/platforms/links')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].externalId).toBe('iss-1');
    });

    it('deletes an external link', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/platforms/links/${linkId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .expect(204);

      expect(externalLinks).toHaveLength(0);
    });
  });

  describe('OSCAR Platform Overview', () => {
    it('accurately answers what is happening in Paperclip and T3 with links', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/platforms/overview')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .expect(200);

      expect(res.body.totalPlatforms).toBe(2);
      expect(res.body.healthyPlatforms).toBe(2);
      expect(res.body.paperclip.connected).toBe(true);
      expect(res.body.paperclip.agents).toHaveLength(1);
      expect(res.body.paperclip.issues).toHaveLength(1);
      expect(res.body.paperclip.issues[0].nativeUrl).toBe('https://paperclip.test/issues/iss-1');

      expect(res.body.t3.connected).toBe(true);
      expect(res.body.t3.threads).toHaveLength(1);
      expect(res.body.t3.threads[0].nativeUrl).toBe('https://t3.test/threads/th-1');

      expect(res.body.oscarAnswer).toContain(
        '2/2 connections provided a verified read-only snapshot.',
      );
      expect(res.body.oscarAnswer).toContain('Paperclip: 1 accessible agents');
      expect(res.body.oscarAnswer).toContain('T3: 1 projects, 1 threads');
      expect(res.body.paperclip.issues[0].nativeUrl).toContain('iss-1');
      expect(res.body.t3.threads[0].nativeUrl).toContain('th-1');
    });
  });
});
