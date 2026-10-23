import 'reflect-metadata';
import { ExecutionContext, INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { ChiefController } from '../../src/modules/chief-of-staff/chief.controller';
import { ChiefService } from '../../src/modules/chief-of-staff/chief.service';
import { SessionAuthGuard } from '../../src/common/guards/session-auth.guard';
import { SessionService } from '../../src/modules/auth/services/session.service';
import { User } from '../../src/modules/users/entities/user.entity';
import { Session } from '../../src/modules/auth/entities/session.entity';
import { configureApp } from '../../src/common/configure-app';

// Authentication itself is covered by auth E2E. These controller tests exercise real CSRF,
// human-review and validation guards with an injected authenticated session or token context.
describe('Chief HTTP review boundary', () => {
  let app: INestApplication;
  const userId = randomUUID(),
    runId = randomUUID();
  const service = {
    briefing: jest.fn().mockResolvedValue({ goals: [], tasks: [], work: [] }),
    preferences: jest.fn(),
    savePreferences: jest.fn().mockResolvedValue({ cadence: 'OFF' }),
    getReview: jest.fn().mockResolvedValue(null),
    review: jest.fn().mockResolvedValue({
      id: randomUUID(),
      verdict: 'ACCEPTED',
      observation: 'Checked',
      reportedCostUsd: null,
      memoryId: null,
      payloadHash: 'must-not-leak',
    }),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ChiefController],
      providers: [
        { provide: ChiefService, useValue: service },
        {
          provide: ConfigService,
          useValue: new ConfigService({ NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:43100' }),
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
          if (!req.headers['x-test-session'] && !req.headers.authorization)
            throw new UnauthorizedException();
          req.user = { id: userId } as User;
          if (req.headers['x-test-session']) req.session = { userId } as Session;
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
  const url = () => `/api/v1/chief/executions/hermes/${runId}/review`;
  const body = () => ({
    idempotencyKey: randomUUID(),
    verdict: 'ACCEPTED',
    observation: 'Checked the expected result',
  });
  it('requires authentication and validates project scope and platform identifiers', async () => {
    await request(app.getHttpServer()).get('/api/v1/chief/briefing').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/chief/briefing?projectId=bad')
      .set('x-test-session', '1')
      .expect(400);
    await request(app.getHttpServer())
      .get(`/api/v1/chief/executions/other/${runId}/review`)
      .set('x-test-session', '1')
      .expect(400);
  });
  it('prevents agent tokens from reviewing outcomes or enabling recurrence', async () => {
    await request(app.getHttpServer())
      .post(url())
      .set('Authorization', 'Bearer test-token')
      .send(body())
      .expect(403);
    await request(app.getHttpServer())
      .put('/api/v1/chief/preferences')
      .set('Authorization', 'Bearer test-token')
      .send({ cadence: 'DAILY', hourUtc: 2, monthlyBudgetUsd: null })
      .expect(403);
    expect(service.review).not.toHaveBeenCalled();
  });
  it('requires CSRF for a signed-in human review', async () => {
    await request(app.getHttpServer())
      .post(url())
      .set('x-test-session', '1')
      .send(body())
      .expect(403);
    const result = await request(app.getHttpServer())
      .post(url())
      .set('x-test-session', '1')
      .set('x-csrf-token', 'valid-csrf')
      .send(body())
      .expect(201);
    expect(result.body.payloadHash).toBeUndefined();
  });
  it('rejects negative cost, excess precision and undocumented fields', async () => {
    for (const extra of [
      { reportedCostUsd: -1 },
      { reportedCostUsd: 0.00001 },
      { goalProgress: 100 },
    ]) {
      await request(app.getHttpServer())
        .post(url())
        .set('x-test-session', '1')
        .set('x-csrf-token', 'valid-csrf')
        .send({ ...body(), ...extra })
        .expect(400);
    }
  });
  it('validates the opt-in schedule and nullable threshold', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/chief/preferences')
      .set('x-test-session', '1')
      .set('x-csrf-token', 'valid-csrf')
      .send({ cadence: 'OFF', hourUtc: 2, monthlyBudgetUsd: null })
      .expect(200);
    await request(app.getHttpServer())
      .put('/api/v1/chief/preferences')
      .set('x-test-session', '1')
      .set('x-csrf-token', 'valid-csrf')
      .send({ cadence: 'DAILY', hourUtc: 24, monthlyBudgetUsd: null })
      .expect(400);
    await request(app.getHttpServer())
      .put('/api/v1/chief/preferences')
      .set('x-test-session', '1')
      .set('x-csrf-token', 'valid-csrf')
      .send({ cadence: 'DAILY', hourUtc: 2 })
      .expect(400);
  });
  it('returns an explicit nullable review envelope', async () => {
    const response = await request(app.getHttpServer())
      .get(url())
      .set('x-test-session', '1')
      .expect(200);
    expect(response.body).toEqual({ data: null });
  });
});
