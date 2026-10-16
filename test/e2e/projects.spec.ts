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
import { AuditModule } from '../../src/modules/audit/audit.module';
import { User, SystemRole, ProfessionalRole } from '../../src/modules/users/entities/user.entity';
import { Session } from '../../src/modules/auth/entities/session.entity';
import { Project, ProjectStatus } from '../../src/modules/projects/entities/project.entity';
import {
  ProjectMember,
  ProjectRole,
} from '../../src/modules/projects/entities/project-member.entity';
import { AuditLog } from '../../src/modules/audit/entities/audit-log.entity';
import { PasswordService } from '../../src/modules/auth/services/password.service';

describe('Projects and Policies API (E2E)', () => {
  let app: INestApplication;
  let passwordService: PasswordService;

  const users: User[] = [];
  const sessions: Session[] = [];
  const projects: Project[] = [];
  const projectMembers: ProjectMember[] = [];
  const auditLogs: AuditLog[] = [];

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
      if (idx >= 0) {
        users[idx] = user;
      } else {
        users.push(user);
      }
      return user;
    }),
    findOne: jest.fn(async (opts: { where: { email?: string; id?: string } }) => {
      if (opts.where.email) {
        return users.find((u) => u.email.toLowerCase() === opts.where.email?.toLowerCase()) ?? null;
      }
      if (opts.where.id) {
        return users.find((u) => u.id === opts.where.id) ?? null;
      }
      return null;
    }),
    findAndCount: jest.fn(async () => [users, users.length]),
    count: jest.fn(async () => users.length),
    createQueryBuilder: jest.fn(() => {
      let excludedIds: string[] = [];
      let searchTerm: string | undefined;

      interface MockUserBuilder {
        where: (clause: string) => MockUserBuilder;
        andWhere: (clause: string, params?: Record<string, unknown>) => MockUserBuilder;
        take: (limit: number) => MockUserBuilder;
        getMany: () => Promise<User[]>;
      }

      const builder: MockUserBuilder = {
        where: jest.fn((_clause: string) => builder),
        andWhere: jest.fn((clause: string, params?: Record<string, unknown>) => {
          if (params?.activeUserIds) {
            excludedIds = params.activeUserIds as string[];
          }
          if (params?.term) {
            searchTerm = (params.term as string).replace(/%/g, '').toLowerCase();
          }
          return builder;
        }),
        take: jest.fn(() => builder),
        getMany: jest.fn(async () => {
          return users.filter((u) => {
            if (!u.isActive) return false;
            if (excludedIds.includes(u.id)) return false;
            if (searchTerm) {
              const matchesName = u.displayName.toLowerCase().includes(searchTerm);
              const matchesEmail = u.email.toLowerCase().includes(searchTerm);
              return matchesName || matchesEmail;
            }
            return true;
          });
        }),
      };
      return builder;
    }),
  };

  const mockSessionRepository = {
    create: jest.fn(
      (dto: Partial<Session>) =>
        ({
          id: randomUUID(),
          ...dto,
        }) as Session,
    ),
    save: jest.fn(async (session: Session) => {
      const idx = sessions.findIndex((s) => s.id === session.id);
      if (idx >= 0) {
        sessions[idx] = session;
      } else {
        sessions.push(session);
      }
      return session;
    }),
    findOne: jest.fn(async (opts: { where: { tokenHash?: string; id?: string } }) => {
      if (opts.where.tokenHash) {
        const found = sessions.find((s) => s.tokenHash === opts.where.tokenHash);
        if (found) {
          const user = users.find((u) => u.id === found.userId);
          return { ...found, user };
        }
      }
      return null;
    }),
    update: jest.fn(
      async (criteria: { tokenHash?: string; id?: string }, partial: Partial<Session>) => {
        for (const s of sessions) {
          if (
            (criteria.tokenHash && s.tokenHash === criteria.tokenHash) ||
            (criteria.id && s.id === criteria.id)
          ) {
            Object.assign(s, partial);
          }
        }
      },
    ),
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
    save: jest.fn(async (memberOrMembers: ProjectMember | ProjectMember[]) => {
      const list = Array.isArray(memberOrMembers) ? memberOrMembers : [memberOrMembers];
      for (const m of list) {
        const idx = projectMembers.findIndex((existing) => existing.id === m.id);
        if (idx >= 0) {
          projectMembers[idx] = m;
        } else {
          projectMembers.push(m);
        }
      }
      return Array.isArray(memberOrMembers) ? list : list[0];
    }),
    findOne: jest.fn(async (opts: FindOneOptions<ProjectMember>) => {
      const where = opts.where as Record<string, unknown> | undefined;
      if (!where) return null;

      const found = projectMembers.find((m) => {
        if (where.projectId && m.projectId !== where.projectId) return false;
        if (where.userId && m.userId !== where.userId) return false;
        if (where.accessRole && m.accessRole !== where.accessRole) return false;
        if (where.removedAt === null || 'removedAt' in where) {
          if (m.removedAt !== null) return false;
        }
        return true;
      });

      if (found) {
        const project = projects.find((p) => p.id === found.projectId);
        const user = users.find((u) => u.id === found.userId);
        return {
          ...found,
          project: project ?? found.project,
          user: user ?? found.user,
        };
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
          const user = users.find((u) => u.id === m.userId);
          return {
            ...m,
            project: project ?? m.project,
            user: user ?? m.user,
          };
        });
    }),
  };

  const mockAuditRepository = {
    create: jest.fn(
      (dto: Partial<AuditLog>) =>
        ({
          id: randomUUID(),
          createdAt: new Date(),
          ...dto,
        }) as AuditLog,
    ),
    save: jest.fn(async (log: AuditLog) => {
      auditLogs.push(log);
      return log;
    }),
    findAndCount: jest.fn(async (opts?: FindManyOptions<AuditLog>) => {
      const where = opts?.where as Record<string, unknown> | undefined;
      const filtered = auditLogs.filter((l) => {
        if (where?.projectId && l.projectId !== where.projectId) return false;
        return true;
      });
      return [filtered, filtered.length];
    }),
  };

  const mockEntityManager = {
    create: jest.fn((entityClass: unknown, dto: unknown) => {
      if (entityClass === Project) return mockProjectRepository.create(dto as Partial<Project>);
      if (entityClass === ProjectMember)
        return mockMemberRepository.create(dto as Partial<ProjectMember>);
      return { id: randomUUID(), ...(dto as object) };
    }),
    save: jest.fn(async (entityClass: unknown, entityOrEntities: unknown) => {
      if (Array.isArray(entityOrEntities)) {
        if (entityClass === ProjectMember) {
          return mockMemberRepository.save(entityOrEntities as ProjectMember[]);
        }
        return entityOrEntities;
      }
      if (entityClass === Project) {
        return mockProjectRepository.save(entityOrEntities as Project);
      }
      if (entityClass === ProjectMember) {
        return mockMemberRepository.save(entityOrEntities as ProjectMember);
      }
      return entityOrEntities;
    }),
    findOne: jest.fn(async (entityClass: unknown, opts: unknown) => {
      if (entityClass === ProjectMember) {
        return mockMemberRepository.findOne(opts as FindOneOptions<ProjectMember>);
      }
      if (entityClass === Project) {
        return mockProjectRepository.findOne(opts as FindOneOptions<Project>);
      }
      return null;
    }),
  };

  const mockDataSource = {
    transaction: jest.fn(async (cb: (manager: unknown) => Promise<unknown>) => {
      return cb(mockEntityManager);
    }),
  };

  let ownerUser: User;
  let managerUser: User;
  let contributorUser: User;
  let outsiderUser: User;

  const userPassword = 'TestPassword123!';

  let ownerAuth: { cookies: string[]; csrfToken: string };
  let managerAuth: { cookies: string[]; csrfToken: string };
  let contributorAuth: { cookies: string[]; csrfToken: string };
  let outsiderAuth: { cookies: string[]; csrfToken: string };

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

    return {
      cookies: extractCookies(res),
      csrfToken: res.body.data.csrfToken,
    };
  }

  beforeAll(async () => {
    passwordService = new PasswordService();
    const passwordHash = await passwordService.hash(userPassword);

    ownerUser = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'owner@workspace.local',
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

    managerUser = {
      id: '22222222-2222-4222-8222-222222222222',
      email: 'manager@workspace.local',
      displayName: 'Project Manager',
      passwordHash,
      systemRole: SystemRole.USER,
      professionalRole: ProfessionalRole.PM,
      isActive: true,
      mustChangePassword: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    users.push(managerUser);

    contributorUser = {
      id: '33333333-3333-4333-8333-333333333333',
      email: 'contributor@workspace.local',
      displayName: 'Project Contributor',
      passwordHash,
      systemRole: SystemRole.USER,
      professionalRole: ProfessionalRole.QA,
      isActive: true,
      mustChangePassword: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    users.push(contributorUser);

    outsiderUser = {
      id: '44444444-4444-4444-8444-444444444444',
      email: 'outsider@workspace.local',
      displayName: 'Outsider User',
      passwordHash,
      systemRole: SystemRole.USER,
      professionalRole: ProfessionalRole.INFRASTRUCTURE,
      isActive: true,
      mustChangePassword: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    users.push(outsiderUser);

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
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
      exports: [ConfigService, DataSource],
    })
    class TestDependencies {}

    const fixture = await Test.createTestingModule({
      imports: [TestDependencies, UsersModule, AuthModule, ProjectsModule, AuditModule],
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
      .overrideProvider(DataSource)
      .useValue(mockDataSource)
      .compile();

    app = fixture.createNestApplication();
    app.useLogger(false);
    configureApp(app);
    await app.init();

    // Log in all test users
    ownerAuth = await loginUser(ownerUser.email);
    managerAuth = await loginUser(managerUser.email);
    contributorAuth = await loginUser(contributorUser.email);
    outsiderAuth = await loginUser(outsiderUser.email);
  });

  afterAll(async () => {
    await app?.close();
  });

  let createdProjectId: string;

  it('persists shared project preferences behind membership, role and version checks', async () => {
    const result = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Cookie', ownerAuth.cookies)
      .set('x-csrf-token', ownerAuth.csrfToken)
      .send({ key: 'PREFS', name: 'Preferences', icon: '📈', instructions: 'Compare assumptions.' })
      .expect(201);
    const id = result.body.data.id as string;
    expect(result.body.data).toMatchObject({ icon: '📈', instructions: 'Compare assumptions.' });
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${id}`)
      .set('Cookie', outsiderAuth.cookies)
      .set('x-csrf-token', outsiderAuth.csrfToken)
      .send({ instructions: 'Not authorized', version: 1 })
      .expect(404);
    for (const payload of [{ instructions: 'x'.repeat(4001) }, { icon: 'x'.repeat(33) }]) {
      await request(app.getHttpServer())
        .patch(`/api/v1/projects/${id}`)
        .set('Cookie', ownerAuth.cookies)
        .set('x-csrf-token', ownerAuth.csrfToken)
        .send({ ...payload, version: 1 })
        .expect(400);
    }
    const cleared = await request(app.getHttpServer())
      .patch(`/api/v1/projects/${id}`)
      .set('Cookie', ownerAuth.cookies)
      .set('x-csrf-token', ownerAuth.csrfToken)
      .send({ instructions: null, icon: null, version: 1 })
      .expect(200);
    expect(cleared.body.data).toMatchObject({ icon: null, instructions: null });
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${id}`)
      .set('Cookie', ownerAuth.cookies)
      .set('x-csrf-token', ownerAuth.csrfToken)
      .send({ instructions: 'Stale', version: 1 })
      .expect(409);
    projects.splice(
      projects.findIndex((project) => project.id === id),
      1,
    );
    for (let i = projectMembers.length - 1; i >= 0; i--)
      if (projectMembers[i]?.projectId === id) projectMembers.splice(i, 1);
  });

  describe('Project Creation', () => {
    it('POST /api/v1/projects requires authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/projects')
        .send({ key: 'DEMO', name: 'Demo Workspace' })
        .expect(401);
    });

    it('POST /api/v1/projects requires CSRF header', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/projects')
        .set('Cookie', ownerAuth.cookies)
        .send({ key: 'DEMO', name: 'Demo Workspace' })
        .expect(403);
    });

    it('POST /api/v1/projects rejects invalid key format', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/projects')
        .set('Cookie', ownerAuth.cookies)
        .set('x-csrf-token', ownerAuth.csrfToken)
        .send({ key: 'invalid-key!', name: 'Demo Workspace' })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('POST /api/v1/projects successfully creates project and assigns owner role', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/projects')
        .set('Cookie', ownerAuth.cookies)
        .set('x-csrf-token', ownerAuth.csrfToken)
        .send({
          key: 'ALPHA',
          name: 'Alpha Project',
          description: 'A test alpha project',
        })
        .expect(201);

      createdProjectId = res.body.data.id;
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.key).toBe('ALPHA');
      expect(res.body.data.name).toBe('Alpha Project');
      expect(res.body.data.status).toBe('ACTIVE');
      expect(res.body.data.currentUserRole).toBe(ProjectRole.OWNER);
      expect(res.body.data.version).toBe(1);
    });

    it('POST /api/v1/projects rejects duplicate key with 409', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/projects')
        .set('Cookie', ownerAuth.cookies)
        .set('x-csrf-token', ownerAuth.csrfToken)
        .send({
          key: 'ALPHA',
          name: 'Another Alpha Project',
        })
        .expect(409);

      expect(res.body.error.code).toBe('PROJECT_KEY_EXISTS');
    });
  });

  describe('Project Listing & Scoping', () => {
    it('GET /api/v1/projects returns user projects with currentUserRole', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/projects')
        .set('Cookie', ownerAuth.cookies)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].id).toBe(createdProjectId);
      expect(res.body.data[0].currentUserRole).toBe(ProjectRole.OWNER);
    });

    it('GET /api/v1/projects?status=ARCHIVED returns empty when no archived projects exist', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/projects?status=ARCHIVED')
        .set('Cookie', ownerAuth.cookies)
        .expect(200);

      expect(res.body.data).toEqual([]);
    });

    it('GET /api/v1/projects/:projectId allows project member to view project', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/projects/${createdProjectId}`)
        .set('Cookie', ownerAuth.cookies)
        .expect(200);

      expect(res.body.data.id).toBe(createdProjectId);
      expect(res.body.data.currentUserRole).toBe(ProjectRole.OWNER);
    });

    it('GET /api/v1/projects/:projectId returns 404 for inaccessible project (privacy contract)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/projects/${createdProjectId}`)
        .set('Cookie', outsiderAuth.cookies)
        .expect(404);

      expect(res.body.error.code).toBe('PROJECT_NOT_FOUND');
    });

    it('GET /api/v1/projects/:projectId returns 404 for nonexistent project UUID', async () => {
      const nonExistentId = '00000000-0000-4000-8000-000000000000';
      const res = await request(app.getHttpServer())
        .get(`/api/v1/projects/${nonExistentId}`)
        .set('Cookie', ownerAuth.cookies)
        .expect(404);

      expect(res.body.error.code).toBe('PROJECT_NOT_FOUND');
    });
  });

  describe('Project Membership Management', () => {
    it('POST /api/v1/projects/:projectId/members adds manager user', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/projects/${createdProjectId}/members`)
        .set('Cookie', ownerAuth.cookies)
        .set('x-csrf-token', ownerAuth.csrfToken)
        .send({
          userId: managerUser.id,
          accessRole: ProjectRole.MANAGER,
        })
        .expect(201);

      expect(res.body.data.userId).toBe(managerUser.id);
      expect(res.body.data.accessRole).toBe(ProjectRole.MANAGER);
    });

    it('POST /api/v1/projects/:projectId/members rejects assigning OWNER role with 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/projects/${createdProjectId}/members`)
        .set('Cookie', ownerAuth.cookies)
        .set('x-csrf-token', ownerAuth.csrfToken)
        .send({
          userId: contributorUser.id,
          accessRole: ProjectRole.OWNER,
        })
        .expect(400);

      expect(res.body.error.code).toBe('CANNOT_ASSIGN_OWNER');
    });

    it('POST /api/v1/projects/:projectId/members: MANAGER can add a CONTRIBUTOR', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/projects/${createdProjectId}/members`)
        .set('Cookie', managerAuth.cookies)
        .set('x-csrf-token', managerAuth.csrfToken)
        .send({
          userId: contributorUser.id,
          accessRole: ProjectRole.CONTRIBUTOR,
        })
        .expect(201);

      expect(res.body.data.userId).toBe(contributorUser.id);
      expect(res.body.data.accessRole).toBe(ProjectRole.CONTRIBUTOR);
    });

    it('POST /api/v1/projects/:projectId/members: MANAGER cannot add someone as MANAGER (403)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/projects/${createdProjectId}/members`)
        .set('Cookie', managerAuth.cookies)
        .set('x-csrf-token', managerAuth.csrfToken)
        .send({
          userId: outsiderUser.id,
          accessRole: ProjectRole.MANAGER,
        })
        .expect(403);

      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('GET /api/v1/projects/:projectId/members returns active members', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/projects/${createdProjectId}/members`)
        .set('Cookie', contributorAuth.cookies)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(3); // owner, manager, contributor
    });

    it('GET /api/v1/projects/:projectId/member-candidates returns available users', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/projects/${createdProjectId}/member-candidates`)
        .set('Cookie', ownerAuth.cookies)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      const ids = res.body.data.map((u: User) => u.id);
      expect(ids).toContain(outsiderUser.id);
      expect(ids).not.toContain(ownerUser.id);
      expect(ids).not.toContain(managerUser.id);
    });

    it('PATCH /api/v1/projects/:projectId/members/:userId: MANAGER cannot promote to MANAGER', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/projects/${createdProjectId}/members/${contributorUser.id}`)
        .set('Cookie', managerAuth.cookies)
        .set('x-csrf-token', managerAuth.csrfToken)
        .send({ accessRole: ProjectRole.MANAGER })
        .expect(403);

      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('PATCH /api/v1/projects/:projectId/members/:userId: OWNER can update role', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/projects/${createdProjectId}/members/${contributorUser.id}`)
        .set('Cookie', ownerAuth.cookies)
        .set('x-csrf-token', ownerAuth.csrfToken)
        .send({ accessRole: ProjectRole.VIEWER })
        .expect(200);

      expect(res.body.data.accessRole).toBe(ProjectRole.VIEWER);
    });

    it('DELETE /api/v1/projects/:projectId/members/:userId: cannot remove owner', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/projects/${createdProjectId}/members/${ownerUser.id}`)
        .set('Cookie', managerAuth.cookies)
        .set('x-csrf-token', managerAuth.csrfToken)
        .expect(400);

      expect(res.body.error.code).toBe('CANNOT_REMOVE_OWNER');
    });

    it('DELETE /api/v1/projects/:projectId/members/:userId: soft removes member', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/projects/${createdProjectId}/members/${contributorUser.id}`)
        .set('Cookie', ownerAuth.cookies)
        .set('x-csrf-token', ownerAuth.csrfToken)
        .expect(204);

      // Verify member is no longer in list
      const listRes = await request(app.getHttpServer())
        .get(`/api/v1/projects/${createdProjectId}/members`)
        .set('Cookie', ownerAuth.cookies)
        .expect(200);

      const memberIds = listRes.body.data.map((m: { userId: string }) => m.userId);
      expect(memberIds).not.toContain(contributorUser.id);
    });
  });

  describe('Project Settings & Concurrency', () => {
    it('PATCH /api/v1/projects/:projectId allows MANAGER to update project name', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/projects/${createdProjectId}`)
        .set('Cookie', managerAuth.cookies)
        .set('x-csrf-token', managerAuth.csrfToken)
        .send({
          name: 'Updated Alpha Workspace',
          version: 1,
        })
        .expect(200);

      expect(res.body.data.name).toBe('Updated Alpha Workspace');
      expect(res.body.data.version).toBe(2);
    });

    it('PATCH /api/v1/projects/:projectId detects optimistic lock conflict', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/projects/${createdProjectId}`)
        .set('Cookie', ownerAuth.cookies)
        .set('x-csrf-token', ownerAuth.csrfToken)
        .send({
          name: 'Stale Update',
          version: 1, // Current version is 2
        })
        .expect(409);

      expect(res.body.error.code).toBe('CONCURRENCY_CONFLICT');
    });

    it('PATCH /api/v1/projects/:projectId rejects outsider with 404 (privacy contract)', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/projects/${createdProjectId}`)
        .set('Cookie', outsiderAuth.cookies)
        .set('x-csrf-token', outsiderAuth.csrfToken)
        .send({ name: 'Hacked' })
        .expect(404);
    });
  });

  describe('Ownership Transfer', () => {
    it('POST /api/v1/projects/:projectId/ownership-transfer rejects non-owner with 403', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/projects/${createdProjectId}/ownership-transfer`)
        .set('Cookie', managerAuth.cookies)
        .set('x-csrf-token', managerAuth.csrfToken)
        .send({ targetUserId: managerUser.id })
        .expect(403);

      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('POST /api/v1/projects/:projectId/ownership-transfer rejects transferring to self', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/projects/${createdProjectId}/ownership-transfer`)
        .set('Cookie', ownerAuth.cookies)
        .set('x-csrf-token', ownerAuth.csrfToken)
        .send({ targetUserId: ownerUser.id })
        .expect(400);

      expect(res.body.error.code).toBe('ALREADY_OWNER');
    });

    it('POST /api/v1/projects/:projectId/ownership-transfer transfers ownership successfully', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/projects/${createdProjectId}/ownership-transfer`)
        .set('Cookie', ownerAuth.cookies)
        .set('x-csrf-token', ownerAuth.csrfToken)
        .send({ targetUserId: managerUser.id })
        .expect(200);

      expect(res.body.data.newOwner.userId).toBe(managerUser.id);
      expect(res.body.data.newOwner.accessRole).toBe(ProjectRole.OWNER);
      expect(res.body.data.previousOwner.userId).toBe(ownerUser.id);
      expect(res.body.data.previousOwner.accessRole).toBe(ProjectRole.MANAGER);
    });
  });

  describe('Project Archival Lifecycle', () => {
    it('POST /api/v1/projects/:projectId/archive allows new owner to archive project', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/projects/${createdProjectId}/archive`)
        .set('Cookie', managerAuth.cookies)
        .set('x-csrf-token', managerAuth.csrfToken)
        .expect(200);

      expect(res.body.data.status).toBe(ProjectStatus.ARCHIVED);
    });

    it('PATCH /api/v1/projects/:projectId rejects mutations on archived project with 400', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/projects/${createdProjectId}`)
        .set('Cookie', managerAuth.cookies)
        .set('x-csrf-token', managerAuth.csrfToken)
        .send({ name: 'Attempted Change While Archived' })
        .expect(400);

      expect(res.body.error.code).toBe('PROJECT_ARCHIVED');
    });

    it('GET /api/v1/projects/:projectId still allows read access on archived project', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/projects/${createdProjectId}`)
        .set('Cookie', managerAuth.cookies)
        .expect(200);

      expect(res.body.data.status).toBe(ProjectStatus.ARCHIVED);
    });

    it('POST /api/v1/projects/:projectId/unarchive allows owner to restore project', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/projects/${createdProjectId}/unarchive`)
        .set('Cookie', managerAuth.cookies)
        .set('x-csrf-token', managerAuth.csrfToken)
        .expect(200);

      expect(res.body.data.status).toBe(ProjectStatus.ACTIVE);
    });

    it('PATCH /api/v1/projects/:projectId succeeds again after unarchival', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/projects/${createdProjectId}`)
        .set('Cookie', managerAuth.cookies)
        .set('x-csrf-token', managerAuth.csrfToken)
        .send({ name: 'Restored Active Workspace' })
        .expect(200);

      expect(res.body.data.name).toBe('Restored Active Workspace');
    });
  });

  describe('Audit Trail', () => {
    it('GET /api/v1/projects/:projectId/audit returns project audit events for manager/owner', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/projects/${createdProjectId}/audit`)
        .set('Cookie', managerAuth.cookies)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.total).toBeGreaterThan(0);
    });

    it('GET /api/v1/projects/:projectId/audit returns 404 for outsider (privacy contract)', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/projects/${createdProjectId}/audit`)
        .set('Cookie', outsiderAuth.cookies)
        .expect(404);
    });
  });
});
