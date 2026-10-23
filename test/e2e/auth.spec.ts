import { ApiKey } from '../../src/modules/auth/entities/api-key.entity';
import { WorkspaceInvitation } from '../../src/modules/users/entities/workspace-invitation.entity';
import 'reflect-metadata';
import { Global, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { configureApp } from '../../src/common/configure-app';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { UsersModule } from '../../src/modules/users/users.module';
import { User, SystemRole, ProfessionalRole } from '../../src/modules/users/entities/user.entity';
import { Session } from '../../src/modules/auth/entities/session.entity';
import { PasswordService } from '../../src/modules/auth/services/password.service';

describe('Auth and Users API (E2E)', () => {
  let app: INestApplication;
  let passwordService: PasswordService;

  const users: User[] = [];
  const sessions: Session[] = [];

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
    count: jest.fn(async (opts?: { where?: { systemRole?: SystemRole; isActive?: boolean } }) => {
      let filtered = users;
      if (opts?.where?.systemRole) {
        filtered = filtered.filter((u) => u.systemRole === opts.where?.systemRole);
      }
      if (opts?.where?.isActive !== undefined) {
        filtered = filtered.filter((u) => u.isActive === opts.where?.isActive);
      }
      return filtered.length;
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
      let targetUserId: string | undefined;
      let excludedId: string | undefined;
      interface MockBuilder {
        update: () => MockBuilder;
        set: () => MockBuilder;
        where: (clause: string, params?: { userId?: string }) => MockBuilder;
        andWhere: (clause: string, params?: { exceptSessionId?: string }) => MockBuilder;
        execute: () => Promise<void>;
      }
      const builder: MockBuilder = {
        update: jest.fn(() => builder),
        set: jest.fn(() => builder),
        where: jest.fn((_clause: string, params?: { userId?: string }) => {
          if (params?.userId) targetUserId = params.userId;
          return builder;
        }),
        andWhere: jest.fn((_clause: string, params?: { exceptSessionId?: string }) => {
          if (params?.exceptSessionId) excludedId = params.exceptSessionId;
          return builder;
        }),
        execute: jest.fn(async () => {
          for (const s of sessions) {
            if (!targetUserId || s.userId === targetUserId) {
              if (!excludedId || s.id !== excludedId) {
                s.revokedAt = new Date();
              }
            }
          }
        }),
      };
      return builder;
    }),
  };

  let adminUser: User;
  let regularUser: User;
  const adminPassword = 'AdminSecretPass123!';
  const userPassword = 'UserSecretPass123!';

  function extractCookies(res: request.Response): string[] {
    const header = res.headers['set-cookie'];
    if (!header) return [];
    const array = Array.isArray(header) ? header : [header];
    return array.map((c) => c.split(';')[0].trim());
  }

  beforeAll(async () => {
    passwordService = new PasswordService();

    adminUser = {
      id: 'admin-uuid-1',
      email: 'admin@workspace.local',
      displayName: 'Admin User',
      passwordHash: await passwordService.hash(adminPassword),
      systemRole: SystemRole.ADMIN,
      professionalRole: ProfessionalRole.INFRASTRUCTURE,
      isActive: true,
      mustChangePassword: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    users.push(adminUser);

    regularUser = {
      id: 'regular-uuid-2',
      email: 'user@workspace.local',
      displayName: 'Regular User',
      passwordHash: await passwordService.hash(userPassword),
      systemRole: SystemRole.USER,
      professionalRole: ProfessionalRole.DEVELOPER,
      isActive: true,
      mustChangePassword: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    users.push(regularUser);

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
      ],
      exports: [ConfigService],
    })
    class TestDependencies {}

    const fixture = await Test.createTestingModule({
      imports: [TestDependencies, UsersModule, AuthModule],
    })
      .overrideProvider(getRepositoryToken(ApiKey))
      .useValue({ findOne: jest.fn().mockResolvedValue(null) })
      .overrideProvider(getRepositoryToken(WorkspaceInvitation))
      .useValue({ findOne: jest.fn().mockResolvedValue(null) })
      .overrideProvider(getRepositoryToken(User))
      .useValue(mockUserRepository)
      .overrideProvider(getRepositoryToken(Session))
      .useValue(mockSessionRepository)
      .compile();

    app = fixture.createNestApplication();
    app.useLogger(false);
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/v1/auth/csrf returns bootstrap null token for anonymous user', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/auth/csrf').expect(200);
    expect(res.body).toEqual({ data: { csrfToken: null } });
  });

  it('POST /api/v1/auth/register rejects invalid email or short password with 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: '123' })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toBeDefined();
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it('POST /api/v1/auth/register succeeds, sets HttpOnly cookie, and returns user profile & CSRF token', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'newbie@workspace.local',
        password: 'NewbiePassword123!',
        displayName: 'Newbie User',
      })
      .expect(201);

    expect(res.body.data.user.email).toBe('newbie@workspace.local');
    expect(res.body.data.user.displayName).toBe('Newbie User');
    expect(res.body.data.user.systemRole).toBe(SystemRole.USER);
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
    expect(res.body.data.csrfToken).toBeTruthy();

    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies).toBeDefined();
    const sessionCookie = cookies.find((c: string) => c.startsWith('aiws_session='));
    expect(sessionCookie).toBeDefined();

    // Rejects duplicate registration with 409
    const dupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'newbie@workspace.local',
        password: 'NewbiePassword123!',
      })
      .expect(409);

    expect(dupRes.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
  });

  it('POST /api/v1/auth/login rejects invalid password with 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@workspace.local', password: 'WrongPassword123!' })
      .expect(401);

    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('POST /api/v1/auth/login succeeds, sets HttpOnly cookie, and returns user profile & CSRF token', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@workspace.local', password: adminPassword })
      .expect(200);

    expect(res.body.data.user.email).toBe('admin@workspace.local');
    expect(res.body.data.user.systemRole).toBe(SystemRole.ADMIN);
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
    expect(res.body.data.csrfToken).toBeTruthy();

    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies).toBeDefined();
    const sessionCookie = cookies.find((c: string) => c.startsWith('aiws_session='));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('Path=/');
  });

  it('GET /api/v1/auth/me requires authentication and returns profile with valid cookie', async () => {
    // Missing cookie -> 401
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);

    // Login to get cookie
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@workspace.local', password: adminPassword })
      .expect(200);

    const cookies = extractCookies(loginRes);

    const meRes = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookies)
      .expect(200);

    expect(meRes.body.data.email).toBe('admin@workspace.local');
  });

  it('PATCH /api/v1/auth/password enforces CSRF and changes password', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'user@workspace.local', password: userPassword })
      .expect(200);

    const cookies = extractCookies(loginRes);
    const csrfToken = loginRes.body.data.csrfToken;

    // Mutation without CSRF token header -> 403 Forbidden
    const noCsrfRes = await request(app.getHttpServer())
      .patch('/api/v1/auth/password')
      .set('Cookie', cookies)
      .send({
        currentPassword: userPassword,
        newPassword: 'BrandNewPassword123!',
      })
      .expect(403);

    expect(noCsrfRes.body.error.code).toBe('CSRF_INVALID');

    // Mutation with CSRF token header -> 200 OK
    await request(app.getHttpServer())
      .patch('/api/v1/auth/password')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({
        currentPassword: userPassword,
        newPassword: 'BrandNewPassword123!',
      })
      .expect(200);

    // Verify login with new password works
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'user@workspace.local', password: 'BrandNewPassword123!' })
      .expect(200);
  });

  it('POST /api/v1/auth/logout revokes session and clears cookie', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@workspace.local', password: adminPassword })
      .expect(200);

    const cookies = extractCookies(loginRes);
    const csrfToken = loginRes.body.data.csrfToken;

    const logoutRes = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .expect(204);

    const rawSetCookies = (logoutRes.headers['set-cookie'] ?? []) as string[];
    expect(
      rawSetCookies.some(
        (c: string) => c.includes('aiws_session=;') || c.startsWith('aiws_session=;'),
      ),
    ).toBe(true);

    // Old cookie should now be rejected as revoked/expired
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookies).expect(401);
  });

  it('enforces system role authorization on /api/v1/users', async () => {
    // Log in as regular user
    const userLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'user@workspace.local', password: 'BrandNewPassword123!' })
      .expect(200);

    // Regular user accessing admin route -> 403
    await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Cookie', extractCookies(userLogin))
      .expect(403);

    // Log in as admin
    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@workspace.local', password: adminPassword })
      .expect(200);

    // Admin accessing admin route -> 200
    const listRes = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Cookie', extractCookies(adminLogin))
      .expect(200);

    expect(Array.isArray(listRes.body.data)).toBe(true);
    expect(listRes.body.meta).toEqual(expect.objectContaining({ page: 1, pageSize: 20 }));
  });

  it('admin creates a new user and updates user details', async () => {
    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@workspace.local', password: adminPassword })
      .expect(200);

    const cookies = extractCookies(adminLogin);
    const csrfToken = adminLogin.body.data.csrfToken;

    // Create user without password -> should receive temporary password
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({
        email: 'bob@workspace.local',
        displayName: 'Bob Builder',
        systemRole: SystemRole.USER,
        professionalRole: ProfessionalRole.QA,
      })
      .expect(201);

    expect(createRes.body.data.email).toBe('bob@workspace.local');
    expect(createRes.body.data.temporaryPassword).toBeTruthy();
    const bobId = createRes.body.data.id;

    // Update bob's display name
    const updateRes = await request(app.getHttpServer())
      .patch(`/api/v1/users/${bobId}`)
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .send({
        displayName: 'Robert Builder',
      })
      .expect(200);

    expect(updateRes.body.data.displayName).toBe('Robert Builder');
  });
});
