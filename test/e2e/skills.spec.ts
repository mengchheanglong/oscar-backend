import 'reflect-metadata';
import { ExecutionContext, INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import request from 'supertest';
import { SkillsController } from '../../src/modules/skills/skills.controller';
import { SkillsService } from '../../src/modules/skills/skills.service';
import { SessionAuthGuard } from '../../src/common/guards/session-auth.guard';
import { SessionService } from '../../src/modules/auth/services/session.service';
import { User } from '../../src/modules/users/entities/user.entity';
import { Session } from '../../src/modules/auth/entities/session.entity';
import { configureApp } from '../../src/common/configure-app';
describe('Skills HTTP boundary', () => {
  let app: INestApplication;
  const service = {
    list: jest.fn().mockResolvedValue([]),
    save: jest.fn().mockResolvedValue({ id: 'fixture', version: 1 }),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SkillsController],
      providers: [
        { provide: SkillsService, useValue: service },
        {
          provide: ConfigService,
          useValue: new ConfigService({ NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:3002' }),
        },
        {
          provide: SessionService,
          useValue: {
            verifyCsrfToken: (_session: unknown, token: string) => token === 'valid-csrf',
          },
        },
      ],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({
        canActivate(ctx: ExecutionContext) {
          const req = ctx.switchToHttp().getRequest<Request>();
          if (!req.headers['x-test-session']) throw new UnauthorizedException();
          req.user = { id: 'owner' } as User;
          req.session = { userId: 'owner' } as Session;
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  const body = {
    slug: 'clear-plan',
    name: 'Clear plan',
    description: 'Reusable guidance',
    instructions: 'Check the result.',
  };
  it('requires authentication for the personal library', async () => {
    await request(app.getHttpServer()).get('/api/v1/skills').expect(401);
  });
  it('uses the authenticated identity and rejects cookie writes without CSRF', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/skills')
      .set('x-test-session', 'yes')
      .expect(200);
    expect(service.list).toHaveBeenCalledWith('owner');
    await request(app.getHttpServer())
      .post('/api/v1/skills')
      .set('x-test-session', 'yes')
      .send(body)
      .expect(403);
    expect(service.save).not.toHaveBeenCalled();
  });
  it('validates skill commands and instruction bounds before saving', async () => {
    for (const invalid of [
      { ...body, slug: '../escape' },
      { ...body, instructions: 'x'.repeat(4001) },
      { ...body, extra: true },
    ])
      await request(app.getHttpServer())
        .post('/api/v1/skills')
        .set('x-test-session', 'yes')
        .set('x-csrf-token', 'valid-csrf')
        .send(invalid)
        .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/skills')
      .set('x-test-session', 'yes')
      .set('x-csrf-token', 'valid-csrf')
      .send(body)
      .expect(201);
    expect(service.save).toHaveBeenCalledWith('owner', expect.objectContaining(body));
  });
});
