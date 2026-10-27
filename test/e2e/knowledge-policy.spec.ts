import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { configureApp } from '../../src/common/configure-app';
import { SessionService } from '../../src/modules/auth/services/session.service';
import { KnowledgeClientService } from '../../src/modules/knowledge-client/knowledge-client.service';
import { KnowledgeLibraryController } from '../../src/modules/knowledge-client/knowledge-library.controller';

describe('Reference policy HTTP boundary', () => {
  let app: INestApplication;
  const config = new ConfigService({
    NODE_ENV: 'test',
    APP_ORIGIN: 'http://localhost:43100',
    OSCAR_KNOWLEDGE_ENABLED: true,
    OSCAR_KNOWLEDGE_REQUIRED: true,
    OSCAR_KNOWLEDGE_SERVICE_TOKEN: 'must-not-be-returned',
  });
  const knowledge = new KnowledgeClientService(config);
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [KnowledgeLibraryController],
      providers: [
        { provide: ConfigService, useValue: config },
        { provide: KnowledgeClientService, useValue: knowledge },
        {
          provide: SessionService,
          useValue: {
            getCookieName: () => 'fixture_session',
            validateSession: async (token: string) =>
              token === 'fixture-session'
                ? { user: { id: 'fixture-owner' }, session: { userId: 'fixture-owner' } }
                : null,
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });
  afterAll(async () => app.close());
  it('requires authentication on policy and existing collection routes', async () => {
    await request(app.getHttpServer()).get('/api/v1/knowledge/policy').expect(401);
    await request(app.getHttpServer()).get('/api/v1/knowledge/collections').expect(401);
  });
  it('exposes only the effective nonsecret source policy', async () => {
    const result = await request(app.getHttpServer())
      .get('/api/v1/knowledge/policy')
      .set('Authorization', 'Bearer fixture-session')
      .expect(200);
    expect(result.body).toEqual({ enabled: true, required: true });
  });
  it('preserves the existing owner-scoped collection contract', async () => {
    const collections = jest.spyOn(knowledge, 'collections').mockResolvedValue([]);
    const result = await request(app.getHttpServer())
      .get('/api/v1/knowledge/collections')
      .set('Authorization', 'Bearer fixture-session')
      .expect(200);
    expect(result.body).toEqual([]);
    expect(collections).toHaveBeenCalledWith('fixture-owner');
  });
});
