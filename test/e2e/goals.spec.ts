import { ApiKey } from '../../src/modules/auth/entities/api-key.entity';
import { WorkspaceInvitation } from '../../src/modules/users/entities/workspace-invitation.entity';
import 'reflect-metadata';
import { Global, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, FindManyOptions, FindOneOptions } from 'typeorm';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { configureApp } from '../../src/common/configure-app';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { UsersModule } from '../../src/modules/users/users.module';
import { ProjectsModule } from '../../src/modules/projects/projects.module';
import { GoalsModule } from '../../src/modules/goals/goals.module';
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
  GoalCategory,
  GoalConfidence,
  GoalMetric,
  GoalReviewCadence,
  GoalRevision,
  GoalStatus,
} from '../../src/modules/goals/entities';
import { Task, TaskStatus } from '../../src/modules/tasks/entities/task.entity';
import { Decision } from '../../src/modules/decisions/entities/decision.entity';
import { PasswordService } from '../../src/modules/auth/services/password.service';
import { OutboxService } from '../../src/modules/ingestion/outbox.service';

describe('Goals API (E2E)', () => {
  let app: INestApplication;
  let passwordService: PasswordService;

  const users: User[] = [];
  const sessions: Session[] = [];
  const projects: Project[] = [];
  const projectMembers: ProjectMember[] = [];
  const auditLogs: AuditLog[] = [];
  const goals: Goal[] = [];
  const goalMetrics: GoalMetric[] = [];
  const goalRevisions: GoalRevision[] = [];
  const tasks: Task[] = [];
  const decisions: Decision[] = [];

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
    findAndCount: jest.fn(async () => [users, users.length]),
    count: jest.fn(async () => users.length),
    createQueryBuilder: jest.fn(() => {
      interface MockUserBuilder {
        where: (clause: string) => MockUserBuilder;
        andWhere: (clause: string, params?: Record<string, unknown>) => MockUserBuilder;
        take: (limit: number) => MockUserBuilder;
        getMany: () => Promise<User[]>;
      }
      const builder: MockUserBuilder = {
        where: jest.fn(() => builder),
        andWhere: jest.fn(() => builder),
        take: jest.fn(() => builder),
        getMany: jest.fn(async () => users.filter((u) => u.isActive)),
      };
      return builder;
    }),
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
    createQueryBuilder: jest.fn(() => {
      interface MockSessionBuilder {
        update: () => MockSessionBuilder;
        set: () => MockSessionBuilder;
        where: () => MockSessionBuilder;
        andWhere: () => MockSessionBuilder;
        execute: () => Promise<void>;
      }
      const builder: MockSessionBuilder = {
        update: jest.fn(() => builder),
        set: jest.fn(() => builder),
        where: jest.fn(() => builder),
        andWhere: jest.fn(() => builder),
        execute: jest.fn(async () => {}),
      };
      return builder;
    }),
  };

  const mockProjectRepository = {
    create: jest.fn(
      (dto: Partial<Project>) =>
        ({
          id: randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
          version: 1,
          status: ProjectStatus.ACTIVE,
          ...dto,
        }) as Project,
    ),
    save: jest.fn(async (project: Project) => {
      const idx = projects.findIndex((p) => p.id === project.id);
      if (idx >= 0) {
        projects[idx] = project;
      } else {
        projects.push(project);
      }
      return project;
    }),
    findOne: jest.fn(async (opts: FindOneOptions<Project>) => {
      const where = opts.where as Record<string, unknown> | undefined;
      if (!where) return null;
      return (
        projects.find((p) => {
          if (where.id && p.id !== where.id) return false;
          if (where.key && p.key !== where.key) return false;
          return true;
        }) ?? null
      );
    }),
    find: jest.fn(async () => projects),
  };

  const mockMemberRepository = {
    create: jest.fn(
      (dto: Partial<ProjectMember>) =>
        ({
          id: randomUUID(),
          joinedAt: new Date(),
          removedAt: null,
          ...dto,
        }) as ProjectMember,
    ),
    save: jest.fn(async (member: ProjectMember) => {
      const idx = projectMembers.findIndex((m) => m.id === member.id);
      if (idx >= 0) projectMembers[idx] = member;
      else projectMembers.push(member);
      return member;
    }),
    findOne: jest.fn(async (opts: FindOneOptions<ProjectMember>) => {
      const where = opts.where as Record<string, unknown> | undefined;
      if (!where) return null;
      const m = projectMembers.find((member) => {
        if (where.projectId && member.projectId !== where.projectId) return false;
        if (where.userId && member.userId !== where.userId) return false;
        if ('removedAt' in where && member.removedAt !== null) return false;
        return true;
      });
      if (!m) return null;
      const project = projects.find((p) => p.id === m.projectId) ?? null;
      return { ...m, project } as ProjectMember;
    }),
    find: jest.fn(async (opts?: FindManyOptions<ProjectMember>) => {
      const where = opts?.where as Record<string, unknown> | undefined;
      if (!where) return projectMembers;
      return projectMembers.filter((m) => {
        if (where.userId && m.userId !== where.userId) return false;
        if (where.projectId && m.projectId !== where.projectId) return false;
        if ('removedAt' in where && m.removedAt !== null) return false;
        return true;
      });
    }),
  };

  const mockAuditRepository = {
    create: jest.fn((dto: Partial<AuditLog>) => ({ id: randomUUID(), ...dto }) as AuditLog),
    save: jest.fn(async (log: AuditLog) => {
      auditLogs.push(log);
      return log;
    }),
  };

  const mockGoalRepository = {
    create: jest.fn(
      (dto: Partial<Goal>) =>
        ({
          id: randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          status: GoalStatus.ACTIVE,
          category: GoalCategory.BUSINESS,
          confidence: GoalConfidence.MEDIUM,
          reviewCadence: GoalReviewCadence.BIWEEKLY,
          milestones: [],
          initiatives: [],
          metrics: [],
          ...dto,
        }) as Goal,
    ),
    save: jest.fn(async (goal: Goal) => {
      const idx = goals.findIndex((g) => g.id === goal.id);
      if (idx >= 0) goals[idx] = goal;
      else goals.push(goal);
      return goal;
    }),
    findOne: jest.fn(async (opts: FindOneOptions<Goal>) => {
      const where = opts.where as Record<string, unknown> | undefined;
      if (!where) return null;
      const found = goals.find((g) => {
        if (where.id && g.id !== where.id) return false;
        if (where.projectId && g.projectId !== where.projectId) return false;
        if (where.userId && g.userId !== where.userId) return false;
        if ('deletedAt' in where && g.deletedAt !== null) return false;
        return true;
      });
      if (found) {
        found.metrics = goalMetrics.filter((m) => m.goalId === found.id);
        found.project = projects.find((p) => p.id === found.projectId) ?? null;
      }
      return found ?? null;
    }),
    find: jest.fn(async (opts?: FindManyOptions<Goal>) => {
      const where = opts?.where as Record<string, unknown> | undefined;
      let result = [...goals];
      if (where) {
        result = result.filter((g) => {
          if (where.projectId && g.projectId !== where.projectId) return false;
          if (where.userId && g.userId !== where.userId) return false;
          if (where.status && g.status !== where.status) return false;
          if ('deletedAt' in where && g.deletedAt !== null) return false;
          return true;
        });
      }
      for (const g of result) {
        g.metrics = goalMetrics.filter((m) => m.goalId === g.id);
        g.project = projects.find((p) => p.id === g.projectId) ?? null;
      }
      return result;
    }),
    createQueryBuilder: jest.fn(() => {
      let filtered = [...goals];
      interface MockGoalBuilder {
        leftJoinAndSelect: () => MockGoalBuilder;
        where: (clause: string, params?: Record<string, unknown>) => MockGoalBuilder;
        andWhere: (clause: string, params?: Record<string, unknown>) => MockGoalBuilder;
        orderBy: () => MockGoalBuilder;
        addOrderBy: () => MockGoalBuilder;
        skip: () => MockGoalBuilder;
        take: () => MockGoalBuilder;
        getManyAndCount: () => Promise<[Goal[], number]>;
      }
      const builder: MockGoalBuilder = {
        leftJoinAndSelect: jest.fn(() => builder),
        where: jest.fn((_clause: string, params?: Record<string, unknown>) => {
          if (params?.projectId) {
            filtered = filtered.filter(
              (g) => g.projectId === params.projectId && g.deletedAt === null,
            );
          } else if (params?.userId) {
            filtered = filtered.filter((g) => g.userId === params.userId && g.deletedAt === null);
          }
          return builder;
        }),
        andWhere: jest.fn((_clause: string, params?: Record<string, unknown>) => {
          if (params?.status) {
            filtered = filtered.filter((g) => g.status === params.status);
          }
          if (params?.category) {
            filtered = filtered.filter((g) => g.category === params.category);
          }
          if (params?.q) {
            const s = (params.q as string).toLowerCase();
            filtered = filtered.filter(
              (g) =>
                g.title.toLowerCase().includes(s) ||
                (g.description && g.description.toLowerCase().includes(s)),
            );
          }
          return builder;
        }),
        orderBy: jest.fn(() => builder),
        addOrderBy: jest.fn(() => builder),
        skip: jest.fn(() => builder),
        take: jest.fn(() => builder),
        getManyAndCount: jest.fn(async () => {
          for (const g of filtered) {
            g.metrics = goalMetrics.filter((m) => m.goalId === g.id);
            g.project = projects.find((p) => p.id === g.projectId) ?? null;
          }
          return [filtered, filtered.length] as [Goal[], number];
        }),
      };
      return builder;
    }),
  };

  const mockGoalMetricRepository = {
    create: jest.fn(
      (dto: Partial<GoalMetric>) =>
        ({
          id: randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
          ...dto,
        }) as GoalMetric,
    ),
    save: jest.fn(async (metric: GoalMetric) => {
      const idx = goalMetrics.findIndex((m) => m.id === metric.id);
      if (idx >= 0) goalMetrics[idx] = metric;
      else goalMetrics.push(metric);
      return metric;
    }),
    findOne: jest.fn(async (opts: FindOneOptions<GoalMetric>) => {
      const where = opts.where as Record<string, unknown> | undefined;
      if (!where) return null;
      return (
        goalMetrics.find((m) => {
          if (where.id && m.id !== where.id) return false;
          if (where.goalId && m.goalId !== where.goalId) return false;
          return true;
        }) ?? null
      );
    }),
    find: jest.fn(async (opts?: FindManyOptions<GoalMetric>) => {
      const where = opts?.where as Record<string, unknown> | undefined;
      if (!where) return goalMetrics;
      return goalMetrics.filter((m) => {
        if (where.goalId && m.goalId !== where.goalId) return false;
        return true;
      });
    }),
    delete: jest.fn(async (criteria: { id: string }) => {
      const idx = goalMetrics.findIndex((m) => m.id === criteria.id);
      if (idx >= 0) goalMetrics.splice(idx, 1);
    }),
    remove: jest.fn(async (metric: GoalMetric) => {
      const idx = goalMetrics.findIndex((m) => m.id === metric.id);
      if (idx >= 0) goalMetrics.splice(idx, 1);
      return metric;
    }),
  };

  const mockGoalRevisionRepository = {
    create: jest.fn(
      (dto: Partial<GoalRevision>) =>
        ({
          id: randomUUID(),
          createdAt: new Date(),
          ...dto,
        }) as GoalRevision,
    ),
    save: jest.fn(async (rev: GoalRevision) => {
      goalRevisions.push(rev);
      return rev;
    }),
    find: jest.fn(async (opts?: FindManyOptions<GoalRevision>) => {
      const where = opts?.where as Record<string, unknown> | undefined;
      if (!where) return goalRevisions;
      return goalRevisions.filter((r) => {
        if (where.goalId && r.goalId !== where.goalId) return false;
        return true;
      });
    }),
  };

  const mockTaskRepository = {
    find: jest.fn(async (opts?: FindManyOptions<Task>) => {
      const where = opts?.where as Record<string, unknown> | undefined;
      if (!where) return tasks;
      return tasks.filter((t) => {
        if (where.goalId && t.goalId !== where.goalId) return false;
        if ('deletedAt' in where && t.deletedAt !== null) return false;
        return true;
      });
    }),
  };

  const mockDecisionRepository = {
    find: jest.fn(async (opts?: FindManyOptions<Decision>) => {
      const where = opts?.where as Record<string, unknown> | undefined;
      if (!where) return decisions;
      return decisions.filter((d) => {
        if (where.goalId && d.goalId !== where.goalId) return false;
        if ('deletedAt' in where && d.deletedAt !== null) return false;
        return true;
      });
    }),
  };

  const mockEntityManager = {
    update: jest.fn(
      async (_entity: unknown, where: { id: string; version?: number }, patch: Partial<Goal>) => {
        const goal = goals.find((g) => g.id === where.id && g.version === where.version);
        if (!goal) return { affected: 0 };
        Object.assign(goal, patch);
        return { affected: 1 };
      },
    ),
    create: jest.fn((entityClass: unknown, dto: unknown) => {
      if (entityClass === Goal) return mockGoalRepository.create(dto as Partial<Goal>);
      if (entityClass === GoalMetric)
        return mockGoalMetricRepository.create(dto as Partial<GoalMetric>);
      if (entityClass === GoalRevision)
        return mockGoalRevisionRepository.create(dto as Partial<GoalRevision>);
      return { id: randomUUID(), ...(dto as object) };
    }),
    save: jest.fn(async (entityClass: unknown, entity: unknown) => {
      if (entityClass === Goal) return mockGoalRepository.save(entity as Goal);
      if (entityClass === GoalMetric) return mockGoalMetricRepository.save(entity as GoalMetric);
      if (entityClass === GoalRevision)
        return mockGoalRevisionRepository.save(entity as GoalRevision);
      return entity;
    }),
    delete: jest.fn(async (entityClass: unknown, criteria: { id: string }) => {
      if (entityClass === GoalMetric) return mockGoalMetricRepository.delete(criteria);
    }),
  };

  const mockDataSource = {
    entityMetadatas: [] as unknown[],
    options: { type: 'postgres' },
    transaction: jest.fn(async (cb: (manager: unknown) => Promise<unknown>) =>
      cb(mockEntityManager),
    ),
  };

  let ownerUser: User;
  let contributorUser: User;
  let viewerUser: User;
  let outsiderUser: User;

  const userPassword = 'TestPassword123!';

  let ownerAuth: { cookies: string[]; csrfToken: string };
  let contributorAuth: { cookies: string[]; csrfToken: string };
  let viewerAuth: { cookies: string[]; csrfToken: string };
  let outsiderAuth: { cookies: string[]; csrfToken: string };

  let testProjectId: string;

  function extractCookies(res: request.Response): string[] {
    const header = res.headers['set-cookie'];
    if (!header) return [];
    const array = Array.isArray(header) ? header : [header];
    return array.map((c) => c.split(';')[0].trim());
  }

  async function loginUser(email: string): Promise<{ cookies: string[]; csrfToken: string }> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: userPassword })
      .expect(200);
    return { cookies: extractCookies(res), csrfToken: res.body.data.csrfToken };
  }

  beforeAll(async () => {
    passwordService = new PasswordService();
    const passwordHash = await passwordService.hash(userPassword);

    ownerUser = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'owner@test.local',
      displayName: 'Project Owner',
      passwordHash,
      systemRole: SystemRole.USER,
      professionalRole: ProfessionalRole.DEVELOPER,
      isActive: true,
      mustChangePassword: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    users.push(ownerUser);

    contributorUser = {
      id: '22222222-2222-4222-8222-222222222222',
      email: 'contributor@test.local',
      displayName: 'Contributor',
      passwordHash,
      systemRole: SystemRole.USER,
      professionalRole: ProfessionalRole.QA,
      isActive: true,
      mustChangePassword: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    users.push(contributorUser);

    viewerUser = {
      id: '33333333-3333-4333-8333-333333333333',
      email: 'viewer@test.local',
      displayName: 'Viewer',
      passwordHash,
      systemRole: SystemRole.USER,
      professionalRole: ProfessionalRole.PM,
      isActive: true,
      mustChangePassword: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    users.push(viewerUser);

    outsiderUser = {
      id: '44444444-4444-4444-8444-444444444444',
      email: 'outsider@test.local',
      displayName: 'Outsider',
      passwordHash,
      systemRole: SystemRole.USER,
      professionalRole: ProfessionalRole.INFRASTRUCTURE,
      isActive: true,
      mustChangePassword: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    users.push(outsiderUser);

    testProjectId = randomUUID();
    const project: Project = {
      id: testProjectId,
      key: 'GOALTEST',
      name: 'Goals Test Project',
      description: null,
      status: ProjectStatus.ACTIVE,
      createdBy: ownerUser.id,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    projects.push(project);

    projectMembers.push({
      id: randomUUID(),
      projectId: testProjectId,
      userId: ownerUser.id,
      accessRole: ProjectRole.OWNER,
      joinedAt: new Date(),
      removedAt: null,
    } as ProjectMember);

    projectMembers.push({
      id: randomUUID(),
      projectId: testProjectId,
      userId: contributorUser.id,
      accessRole: ProjectRole.CONTRIBUTOR,
      joinedAt: new Date(),
      removedAt: null,
    } as ProjectMember);

    projectMembers.push({
      id: randomUUID(),
      projectId: testProjectId,
      userId: viewerUser.id,
      accessRole: ProjectRole.VIEWER,
      joinedAt: new Date(),
      removedAt: null,
    } as ProjectMember);

    @Global()
    @Module({
      providers: [
        {
          provide: ConfigService,
          useValue: new ConfigService({
            NODE_ENV: 'development',
            PORT: 3000,
            APP_ORIGIN: 'http://localhost:43101',
            SESSION_IDLE_HOURS: 8,
            SESSION_ABSOLUTE_DAYS: 7,
            STORAGE_LOCAL_ROOT: './var/uploads',
          }),
        },
        { provide: DataSource, useValue: mockDataSource },
        { provide: OutboxService, useValue: { emit: jest.fn().mockResolvedValue({}) } },
      ],
      exports: [ConfigService, DataSource, OutboxService],
    })
    class TestDependencies {}

    const fixture = await Test.createTestingModule({
      imports: [
        TestDependencies,
        UsersModule,
        AuthModule,
        ProjectsModule,
        GoalsModule,
        AuditModule,
      ],
    })
      .overrideProvider(getRepositoryToken(ApiKey))
      .useValue({ findOne: jest.fn().mockResolvedValue(null) })
      .overrideProvider(getRepositoryToken(WorkspaceInvitation))
      .useValue({ findOne: jest.fn().mockResolvedValue(null) })
      .overrideProvider(getRepositoryToken(User))
      .useValue(mockUserRepository)
      .overrideProvider(getRepositoryToken(Session))
      .useValue(mockSessionRepository)
      .overrideProvider(getRepositoryToken(Project))
      .useValue(mockProjectRepository)
      .overrideProvider(getRepositoryToken(ProjectMember))
      .useValue(mockMemberRepository)
      .overrideProvider(getRepositoryToken(AuditLog))
      .useValue(mockAuditRepository)
      .overrideProvider(getRepositoryToken(Goal))
      .useValue(mockGoalRepository)
      .overrideProvider(getRepositoryToken(GoalMetric))
      .useValue(mockGoalMetricRepository)
      .overrideProvider(getRepositoryToken(GoalRevision))
      .useValue(mockGoalRevisionRepository)
      .overrideProvider(getRepositoryToken(Task))
      .useValue(mockTaskRepository)
      .overrideProvider(getRepositoryToken(Decision))
      .useValue(mockDecisionRepository)
      .compile();

    app = fixture.createNestApplication();
    configureApp(app);
    await app.init();

    ownerAuth = await loginUser(ownerUser.email);
    contributorAuth = await loginUser(contributorUser.email);
    viewerAuth = await loginUser(viewerUser.email);
    outsiderAuth = await loginUser(outsiderUser.email);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('Project-scoped Goals Lifecycle', () => {
    let createdGoalId: string;
    let createdMetricId: string;

    it('creates a project goal as contributor', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProjectId}/goals`)
        .set('Cookie', contributorAuth.cookies)
        .set('x-csrf-token', contributorAuth.csrfToken)
        .send({
          title: 'Launch MVP Feature',
          target: 'Reach 100 daily active users with positive feedback',
          motivation: 'Prove market viability',
          category: GoalCategory.BUSINESS,
          reviewCadence: GoalReviewCadence.WEEKLY,
          milestones: [
            { id: 'm-1', title: 'Beta launch', completed: false },
            { id: 'm-2', title: '100 users onboarded', completed: false },
          ],
          initiatives: [
            { id: 'i-1', title: 'Refactor auth flow', status: 'IN_PROGRESS' },
            { id: 'i-2', title: 'Improve onboarding tutorial', status: 'TODO' },
          ],
        })
        .expect(201);

      expect(res.body.data).toBeDefined();
      expect(res.body.data.title).toBe('Launch MVP Feature');
      expect(res.body.data.status).toBe(GoalStatus.ACTIVE);
      expect(res.body.data.milestones).toHaveLength(2);
      expect(res.body.data.initiatives).toHaveLength(2);
      createdGoalId = res.body.data.id;
    });

    it('rejects goal creation by viewer (403)', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProjectId}/goals`)
        .set('Cookie', viewerAuth.cookies)
        .set('x-csrf-token', viewerAuth.csrfToken)
        .send({
          title: 'Unauthorized Goal',
          target: 'Should fail',
        })
        .expect(403);
    });

    it('rejects goal creation by outsider (404)', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProjectId}/goals`)
        .set('Cookie', outsiderAuth.cookies)
        .set('x-csrf-token', outsiderAuth.csrfToken)
        .send({
          title: 'Outsider Goal',
          target: 'Should fail',
        })
        .expect(404);
    });

    it('lists project goals for member', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/projects/${testProjectId}/goals`)
        .set('Cookie', viewerAuth.cookies)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(createdGoalId);
      expect(res.body.meta.total).toBe(1);
    });

    it('adds a metric to the goal', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProjectId}/goals/${createdGoalId}/metrics`)
        .set('Cookie', contributorAuth.cookies)
        .set('x-csrf-token', contributorAuth.csrfToken)
        .send({
          name: 'Daily Active Users',
          targetValue: 100,
          currentValue: 20,
          unit: 'users',
        })
        .expect(201);

      expect(res.body.data).toBeDefined();
      expect(res.body.data.name).toBe('Daily Active Users');
      expect(res.body.data.currentValue).toBe(20);
      createdMetricId = res.body.data.id;
    });

    it('updates metric progress', async () => {
      const res = await request(app.getHttpServer())
        .patch(
          `/api/v1/projects/${testProjectId}/goals/${createdGoalId}/metrics/${createdMetricId}`,
        )
        .set('Cookie', contributorAuth.cookies)
        .set('x-csrf-token', contributorAuth.csrfToken)
        .send({
          currentValue: 50,
          notes: 'Halfway to target with beta users',
        })
        .expect(200);

      expect(res.body.data.currentValue).toBe(50);
      expect(res.body.data.notes).toBe('Halfway to target with beta users');
    });

    it('calculates measured progress summary', async () => {
      // Add a completed task linked to the goal
      tasks.push({
        id: randomUUID(),
        goalId: createdGoalId,
        projectId: testProjectId,
        status: TaskStatus.DONE,
        deletedAt: null,
      } as Task);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/projects/${testProjectId}/goals/${createdGoalId}/summary`)
        .set('Cookie', viewerAuth.cookies)
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(res.body.data.id).toBe(createdGoalId);
      expect(res.body.data.linkedTasks).toHaveLength(1);
      expect(res.body.data.measuredProgress).toBeGreaterThan(0);
      expect(res.body.data.metricsProgress).toBeDefined();
      expect(res.body.data.tasksProgress).toBe(100);
    });

    it('updates goal status with revision recording', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/projects/${testProjectId}/goals/${createdGoalId}`)
        .set('Cookie', contributorAuth.cookies)
        .set('x-csrf-token', contributorAuth.csrfToken)
        .send({
          version: 1,
          status: GoalStatus.ACHIEVED,
          revisionReason: 'All targets reached successfully',
        })
        .expect(200);

      expect(res.body.data.status).toBe(GoalStatus.ACHIEVED);

      const revRes = await request(app.getHttpServer())
        .get(`/api/v1/projects/${testProjectId}/goals/${createdGoalId}/revisions`)
        .set('Cookie', viewerAuth.cookies)
        .expect(200);

      expect(revRes.body.data.length).toBeGreaterThanOrEqual(1);
      expect(
        revRes.body.data.some(
          (r: { reason: string }) => r.reason === 'All targets reached successfully',
        ),
      ).toBe(true);
    });

    it('rejects goal modifications by viewer on both user and project endpoints (403)', async () => {
      // User-level endpoints: PATCH, DELETE, POST metric
      await request(app.getHttpServer())
        .patch(`/api/v1/goals/${createdGoalId}`)
        .set('Cookie', viewerAuth.cookies)
        .set('x-csrf-token', viewerAuth.csrfToken)
        .send({ version: 1, title: 'Viewer hacked title' })
        .expect(403);

      await request(app.getHttpServer())
        .delete(`/api/v1/goals/${createdGoalId}`)
        .set('Cookie', viewerAuth.cookies)
        .set('x-csrf-token', viewerAuth.csrfToken)
        .expect(403);

      await request(app.getHttpServer())
        .post(`/api/v1/goals/${createdGoalId}/metrics`)
        .set('Cookie', viewerAuth.cookies)
        .set('x-csrf-token', viewerAuth.csrfToken)
        .send({
          name: 'Viewer metric',
          targetValue: 50,
          currentValue: 0,
          unit: 'units',
        })
        .expect(403);

      // Project-level endpoints: PATCH, DELETE, POST metric
      await request(app.getHttpServer())
        .patch(`/api/v1/projects/${testProjectId}/goals/${createdGoalId}`)
        .set('Cookie', viewerAuth.cookies)
        .set('x-csrf-token', viewerAuth.csrfToken)
        .send({ version: 1, title: 'Viewer hacked title' })
        .expect(403);

      await request(app.getHttpServer())
        .delete(`/api/v1/projects/${testProjectId}/goals/${createdGoalId}`)
        .set('Cookie', viewerAuth.cookies)
        .set('x-csrf-token', viewerAuth.csrfToken)
        .expect(403);

      await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProjectId}/goals/${createdGoalId}/metrics`)
        .set('Cookie', viewerAuth.cookies)
        .set('x-csrf-token', viewerAuth.csrfToken)
        .send({
          name: 'Viewer metric',
          targetValue: 50,
          currentValue: 0,
          unit: 'units',
        })
        .expect(403);
    });

    it('deletes metric', async () => {
      await request(app.getHttpServer())
        .delete(
          `/api/v1/projects/${testProjectId}/goals/${createdGoalId}/metrics/${createdMetricId}`,
        )
        .set('Cookie', contributorAuth.cookies)
        .set('x-csrf-token', contributorAuth.csrfToken)
        .expect(204);
    });

    it('soft deletes goal as owner', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/projects/${testProjectId}/goals/${createdGoalId}`)
        .set('Cookie', ownerAuth.cookies)
        .set('x-csrf-token', ownerAuth.csrfToken)
        .expect(204);

      const check = await request(app.getHttpServer())
        .get(`/api/v1/projects/${testProjectId}/goals/${createdGoalId}`)
        .set('Cookie', ownerAuth.cookies)
        .expect(404);

      expect(check.body.error).toBeDefined();
    });
  });

  it('rejects an impossible calendar date before writing a goal', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/goals')
      .set('Cookie', outsiderAuth.cookies)
      .set('x-csrf-token', outsiderAuth.csrfToken)
      .send({ title: 'Invalid calendar date', targetDate: '2026-02-30' })
      .expect(400);
  });

  describe('User-owned Goals Lifecycle', () => {
    let userGoalId: string;

    it('creates a user personal goal', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/goals')
        .set('Cookie', outsiderAuth.cookies)
        .set('x-csrf-token', outsiderAuth.csrfToken)
        .send({
          title: 'Master Strategic Planning',
          target: 'Deliver 3 strategic plans by Q4',
          category: GoalCategory.PERSONAL,
          reviewCadence: GoalReviewCadence.MONTHLY,
        })
        .expect(201);

      expect(res.body.data).toBeDefined();
      expect(res.body.data.userId).toBe(outsiderUser.id);
      expect(res.body.data.projectId).toBeNull();
      userGoalId = res.body.data.id;
    });

    it('lists user personal goals only for owner', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/goals')
        .set('Cookie', outsiderAuth.cookies)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(userGoalId);

      const otherRes = await request(app.getHttpServer())
        .get('/api/v1/goals')
        .set('Cookie', ownerAuth.cookies)
        .expect(200);

      expect(otherRes.body.data).toHaveLength(0);
    });

    it('forbids other user from accessing personal goal (403)', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/goals/${userGoalId}`)
        .set('Cookie', ownerAuth.cookies)
        .expect(403);
    });
  });
});
