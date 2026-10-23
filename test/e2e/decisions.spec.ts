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
import { DecisionsModule } from '../../src/modules/decisions/decisions.module';
import { AuditModule } from '../../src/modules/audit/audit.module';
import { User, SystemRole, ProfessionalRole } from '../../src/modules/users/entities/user.entity';
import { Session } from '../../src/modules/auth/entities/session.entity';
import { Project, ProjectStatus } from '../../src/modules/projects/entities/project.entity';
import {
  ProjectMember,
  ProjectRole,
} from '../../src/modules/projects/entities/project-member.entity';
import { AuditLog } from '../../src/modules/audit/entities/audit-log.entity';
import { Decision } from '../../src/modules/decisions/entities/decision.entity';
import { DecisionRevision } from '../../src/modules/decisions/entities/decision-revision.entity';
import { Task } from '../../src/modules/tasks/entities/task.entity';
import { Goal } from '../../src/modules/goals/entities/goal.entity';
import { PasswordService } from '../../src/modules/auth/services/password.service';
import { OutboxService } from '../../src/modules/ingestion/outbox.service';

describe('Decisions API (E2E)', () => {
  let app: INestApplication;
  let passwordService: PasswordService;

  const users: User[] = [];
  const sessions: Session[] = [];
  const projects: Project[] = [];
  const projectMembers: ProjectMember[] = [];
  const auditLogs: AuditLog[] = [];
  const decisions: Decision[] = [];
  const decisionRevisions: DecisionRevision[] = [];

  // ── Mock repositories ─────────────────────────────────────────────

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
        project.version = (project.version ?? 1) + 1;
        projects[idx] = project;
      } else projects.push(project);
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
        ({ id: randomUUID(), joinedAt: new Date(), removedAt: null, ...dto }) as ProjectMember,
    ),
    save: jest.fn(async (memberOrMembers: ProjectMember | ProjectMember[]) => {
      const list = Array.isArray(memberOrMembers) ? memberOrMembers : [memberOrMembers];
      for (const m of list) {
        const idx = projectMembers.findIndex((existing) => existing.id === m.id);
        if (idx >= 0) projectMembers[idx] = m;
        else projectMembers.push(m);
      }
      return Array.isArray(memberOrMembers) ? list : list[0];
    }),
    findOne: jest.fn(async (opts: FindOneOptions<ProjectMember>) => {
      const where = opts.where as Record<string, unknown> | undefined;
      if (!where) return null;
      const found = projectMembers.find((m) => {
        if (where.projectId && m.projectId !== where.projectId) return false;
        if (where.userId && m.userId !== where.userId) return false;
        if (where.removedAt === null || 'removedAt' in where) {
          if (m.removedAt !== null) return false;
        }
        return true;
      });
      if (found) {
        const project = projects.find((p) => p.id === found.projectId);
        return { ...found, project: project ?? found.project };
      }
      return null;
    }),
    find: jest.fn(async (opts?: FindManyOptions<ProjectMember>) => {
      const where = opts?.where as Record<string, unknown> | undefined;
      return projectMembers
        .filter((m) => {
          if (!where) return true;
          if (where.projectId && m.projectId !== where.projectId) return false;
          if (where.userId && m.userId !== where.userId) return false;
          if (m.removedAt !== null) return false;
          return true;
        })
        .map((m) => {
          const project = projects.find((p) => p.id === m.projectId);
          return { ...m, project: project ?? m.project };
        });
    }),
  };

  const mockAuditRepository = {
    create: jest.fn(
      (dto: Partial<AuditLog>) => ({ id: randomUUID(), createdAt: new Date(), ...dto }) as AuditLog,
    ),
    save: jest.fn(async (log: AuditLog) => {
      auditLogs.push(log);
      return log;
    }),
    findAndCount: jest.fn(async () => [auditLogs, auditLogs.length]),
  };

  const mockDecisionRepository = {
    create: jest.fn(
      (dto: Partial<Decision>) =>
        ({
          id: randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
          version: 1,
          deletedAt: null,
          ...dto,
        }) as Decision,
    ),
    save: jest.fn(async (dec: Decision) => {
      const idx = decisions.findIndex((d) => d.id === dec.id);
      if (idx >= 0) {
        dec.version = (dec.version ?? 1) + 1;
        dec.updatedAt = new Date();
        decisions[idx] = dec;
      } else decisions.push(dec);
      return dec;
    }),
    findOne: jest.fn(async (opts: FindOneOptions<Decision>) => {
      const where = opts.where as Record<string, unknown> | undefined;
      if (!where) return null;
      return (
        decisions.find((d) => {
          if (where.id && d.id !== where.id) return false;
          if (where.projectId && d.projectId !== where.projectId) return false;
          if ('deletedAt' in where && d.deletedAt !== null) return false;
          return true;
        }) ?? null
      );
    }),
    createQueryBuilder: jest.fn(() => {
      let filtered = [...decisions];
      interface MockDecBuilder {
        where: (clause: string, params?: Record<string, unknown>) => MockDecBuilder;
        andWhere: (clause: string, params?: Record<string, unknown>) => MockDecBuilder;
        orderBy: (col: string, order: string) => MockDecBuilder;
        addOrderBy: (col: string, order: string) => MockDecBuilder;
        skip: (n: number) => MockDecBuilder;
        take: (n: number) => MockDecBuilder;
        getManyAndCount: () => Promise<[Decision[], number]>;
      }
      const builder: MockDecBuilder = {
        where: jest.fn((_clause: string, params?: Record<string, unknown>) => {
          if (params?.projectId) {
            filtered = decisions.filter(
              (d) => d.projectId === params.projectId && d.deletedAt === null,
            );
          }
          return builder;
        }),
        andWhere: jest.fn((_clause: string, params?: Record<string, unknown>) => {
          if (params?.status) {
            filtered = filtered.filter((d) => d.status === params.status);
          }
          return builder;
        }),
        orderBy: jest.fn(() => builder),
        addOrderBy: jest.fn(() => builder),
        skip: jest.fn(() => builder),
        take: jest.fn(() => builder),
        getManyAndCount: jest.fn(async () => [filtered, filtered.length] as [Decision[], number]),
      };
      return builder;
    }),
  };

  const mockDecisionRevisionRepository = {
    create: jest.fn(
      (dto: Partial<DecisionRevision>) =>
        ({ id: randomUUID(), createdAt: new Date(), ...dto }) as DecisionRevision,
    ),
    save: jest.fn(async (rev: DecisionRevision) => {
      decisionRevisions.push(rev);
      return rev;
    }),
    find: jest.fn(async (opts?: FindManyOptions<DecisionRevision>) => {
      const where = opts?.where as Record<string, unknown> | undefined;
      if (!where) return decisionRevisions;
      return decisionRevisions.filter((r) => {
        if (where.decisionId && r.decisionId !== where.decisionId) return false;
        return true;
      });
    }),
  };

  const mockEntityManager = {
    create: jest.fn((entityClass: unknown, dto: unknown) => {
      if (entityClass === Project) return mockProjectRepository.create(dto as Partial<Project>);
      if (entityClass === ProjectMember)
        return mockMemberRepository.create(dto as Partial<ProjectMember>);
      if (entityClass === Decision) return mockDecisionRepository.create(dto as Partial<Decision>);
      if (entityClass === DecisionRevision)
        return mockDecisionRevisionRepository.create(dto as Partial<DecisionRevision>);
      return { id: randomUUID(), ...(dto as object) };
    }),
    save: jest.fn(async (entityClass: unknown, entity: unknown) => {
      if (entityClass === Project) return mockProjectRepository.save(entity as Project);
      if (entityClass === ProjectMember) return mockMemberRepository.save(entity as ProjectMember);
      if (entityClass === Decision) return mockDecisionRepository.save(entity as Decision);
      if (entityClass === DecisionRevision)
        return mockDecisionRevisionRepository.save(entity as DecisionRevision);
      return entity;
    }),
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('MAX("number")') && sql.includes('decisions')) {
        const projectId = (params as string[])?.[0];
        const maxNum = decisions
          .filter((d) => d.projectId === projectId)
          .reduce((max, d) => Math.max(max, d.number ?? 0), 0);
        return [{ max: maxNum || null }];
      }
      return [{ max: null }];
    }),
  };

  const mockDataSource = {
    entityMetadatas: [] as unknown[],
    options: { type: 'postgres' },
    getRepository: jest.fn(() => ({
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    })),
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
  const testProjectKey = 'REQTEST';

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

    // Create project + memberships manually
    testProjectId = randomUUID();
    const project: Project = {
      id: testProjectId,
      key: testProjectKey,
      name: 'Req Test Project',
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
        DecisionsModule,
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
      .overrideProvider(getRepositoryToken(Decision))
      .useValue(mockDecisionRepository)
      .overrideProvider(getRepositoryToken(DecisionRevision))
      .useValue(mockDecisionRevisionRepository)
      .overrideProvider(getRepositoryToken(Task))
      .useValue({ find: jest.fn().mockResolvedValue([]), findOne: jest.fn() })
      .overrideProvider(getRepositoryToken(Goal))
      .useValue({
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
      })
      .overrideProvider(DataSource)
      .useValue(mockDataSource)
      .compile();

    app = fixture.createNestApplication();
    app.useLogger(false);
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

  const BASE = () => `/api/v1/projects/${testProjectId}`;

  // ──────────────── DECISIONS ────────────────

  let createdDecId: string;

  describe('Decisions - Create', () => {
    it('should create a decision as Owner', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE()}/decisions`)
        .set('Cookie', ownerAuth.cookies)
        .set('x-csrf-token', ownerAuth.csrfToken)
        .send({
          title: 'Use PostgreSQL',
          decisionText: 'We will use PostgreSQL as primary database',
          rationale: 'Good for pgvector',
        })
        .expect(201);

      expect(res.body.data.title).toBe('Use PostgreSQL');
      expect(res.body.data.number).toBe(1);
      expect(res.body.data.displayKey).toBe(`${testProjectKey}-DEC-1`);
      expect(res.body.data.status).toBe('PROPOSED');
      createdDecId = res.body.data.id;
    });

    it('should reject creation by VIEWER', async () => {
      await request(app.getHttpServer())
        .post(`${BASE()}/decisions`)
        .set('Cookie', viewerAuth.cookies)
        .set('x-csrf-token', viewerAuth.csrfToken)
        .send({ title: 'No', decisionText: 'Nope' })
        .expect(403);
    });

    it('should return 404 for outsider', async () => {
      await request(app.getHttpServer())
        .post(`${BASE()}/decisions`)
        .set('Cookie', outsiderAuth.cookies)
        .set('x-csrf-token', outsiderAuth.csrfToken)
        .send({ title: 'No', decisionText: 'Nope' })
        .expect(404);
    });
  });

  describe('Decisions - List', () => {
    it('should list decisions for member', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE()}/decisions`)
        .set('Cookie', ownerAuth.cookies)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Decisions - Get by ID', () => {
    it('should get decision details', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE()}/decisions/${createdDecId}`)
        .set('Cookie', ownerAuth.cookies)
        .expect(200);

      expect(res.body.data.id).toBe(createdDecId);
    });
  });

  describe('Decisions - Update', () => {
    it('should update decision and set decidedAt on acceptance', async () => {
      const current = decisions.find((d) => d.id === createdDecId)!;
      const res = await request(app.getHttpServer())
        .patch(`${BASE()}/decisions/${createdDecId}`)
        .set('Cookie', ownerAuth.cookies)
        .set('x-csrf-token', ownerAuth.csrfToken)
        .send({ version: current.version, status: 'ACCEPTED' })
        .expect(200);

      expect(res.body.data.status).toBe('ACCEPTED');
      expect(res.body.data.decidedAt).toBeTruthy();
      expect(res.body.data.decidedBy).toBe(ownerUser.id);
    });

    it('should reject stale version (409)', async () => {
      await request(app.getHttpServer())
        .patch(`${BASE()}/decisions/${createdDecId}`)
        .set('Cookie', ownerAuth.cookies)
        .set('x-csrf-token', ownerAuth.csrfToken)
        .send({ version: 1, title: 'Stale' })
        .expect(409);
    });
  });

  describe('Decisions - Supersession', () => {
    it('should create superseding decision', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE()}/decisions`)
        .set('Cookie', ownerAuth.cookies)
        .set('x-csrf-token', ownerAuth.csrfToken)
        .send({
          title: 'Superseding decision',
          decisionText: 'Replace previous decision',
          supersedesDecisionId: createdDecId,
        })
        .expect(201);

      expect(res.body.data.supersedesDecisionId).toBe(createdDecId);
    });
  });

  describe('Decisions - Revisions', () => {
    it('should list revisions', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE()}/decisions/${createdDecId}/revisions`)
        .set('Cookie', ownerAuth.cookies)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Decisions - Soft Delete', () => {
    it('should soft-delete as Owner', async () => {
      const createRes = await request(app.getHttpServer())
        .post(`${BASE()}/decisions`)
        .set('Cookie', contributorAuth.cookies)
        .set('x-csrf-token', contributorAuth.csrfToken)
        .send({ title: 'To delete', decisionText: 'Will be deleted' })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`${BASE()}/decisions/${createRes.body.data.id}`)
        .set('Cookie', ownerAuth.cookies)
        .set('x-csrf-token', ownerAuth.csrfToken)
        .expect(204);
    });

    it('should forbid Contributor from deleting others decision', async () => {
      const createRes = await request(app.getHttpServer())
        .post(`${BASE()}/decisions`)
        .set('Cookie', ownerAuth.cookies)
        .set('x-csrf-token', ownerAuth.csrfToken)
        .send({ title: 'Owner only', decisionText: 'text' })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`${BASE()}/decisions/${createRes.body.data.id}`)
        .set('Cookie', contributorAuth.cookies)
        .set('x-csrf-token', contributorAuth.csrfToken)
        .expect(403);
    });
  });
});
