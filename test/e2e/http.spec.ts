import 'reflect-metadata';
import { Body, Controller, Global, INestApplication, Module, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { IsString, MinLength } from 'class-validator';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { configureApp } from '../../src/common/configure-app';
import { HealthModule } from '../../src/modules/health/health.module';

class TestInput {
  @IsString()
  @MinLength(3)
  title!: string;
}

// Test-only route exercises production validation infrastructure; never registered in AppModule.
@Controller('validation-probe')
class ProbeController {
  @Post()
  create(@Body() input: TestInput) {
    return { data: input };
  }
}

describe('HTTP foundation', () => {
  let app: INestApplication;
  let storageRoot: string;
  const database = { query: jest.fn<Promise<unknown[]>, [string]>() };

  beforeAll(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), 'aiws-http-'));
    @Global()
    @Module({
      providers: [
        { provide: DataSource, useValue: database },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            NODE_ENV: 'development',
            APP_ORIGIN: 'http://localhost:43100',
            STORAGE_LOCAL_ROOT: storageRoot,
          }),
        },
      ],
      exports: [DataSource, ConfigService],
    })
    class TestDependencies {}
    const fixture = await Test.createTestingModule({
      imports: [TestDependencies, HealthModule],
      controllers: [ProbeController],
    }).compile();
    app = fixture.createNestApplication();
    app.useLogger(false);
    configureApp(app);
    await app.init();
  });

  beforeEach(() => {
    database.query.mockReset().mockResolvedValue([{ value: 1 }]);
  });
  afterAll(async () => {
    await app?.close();
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  });

  it('reports liveness without querying dependencies', async () => {
    const result = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(result.body).toEqual({ data: { status: 'ok' } });
    expect(result.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
    expect(result.headers['x-content-type-options']).toBe('nosniff');
    expect(database.query).not.toHaveBeenCalled();
  });

  it('checks database and writable storage for readiness', async () => {
    await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(database.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('returns a safe, correlated 503 when the database fails while liveness stays up', async () => {
    database.query.mockRejectedValue(new Error('postgresql://secret:password@private-host/db'));
    const result = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503);
    expect(result.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(result.body.error.requestId).toBe(result.headers['x-request-id']);
    expect(JSON.stringify(result.body)).not.toContain('password');
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
  });

  it('rejects mass assignment and returns field-level validation errors', async () => {
    const result = await request(app.getHttpServer())
      .post('/api/v1/validation-probe')
      .send({ title: 'ok', projectId: 'forged' })
      .expect(400);
    expect(result.body.error.code).toBe('VALIDATION_ERROR');
    expect(result.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'title' }),
        expect.objectContaining({ field: 'projectId' }),
      ]),
    );
  });

  it('wraps missing routes and does not enable wildcard credentialed CORS', async () => {
    const result = await request(app.getHttpServer())
      .get('/missing')
      .set('Origin', 'https://untrusted.example')
      .expect(404);
    expect(result.body.error.code).toBe('NOT_FOUND');
    expect(result.headers['access-control-allow-origin']).not.toBe('https://untrusted.example');
    expect(result.headers['access-control-allow-origin']).not.toBe('*');
  });

  it.each(['http://localhost:43100', 'http://127.0.0.1:43100'])(
    'permits the dedicated local frontend origin %s',
    async (origin) => {
      const result = await request(app.getHttpServer())
        .get('/api/v1/health/live')
        .set('Origin', origin)
        .expect(200);
      expect(result.headers['access-control-allow-origin']).toBe(origin);
      expect(result.headers['access-control-allow-credentials']).toBe('true');
    },
  );

  it.each(['http://localhost:3000', 'http://localhost:3002'])(
    'does not grant credentialed CORS to another app on %s',
    async (origin) => {
      const result = await request(app.getHttpServer())
        .get('/api/v1/health/live')
        .set('Origin', origin)
        .expect(200);
      expect(result.headers['access-control-allow-origin']).toBeUndefined();
    },
  );
});
