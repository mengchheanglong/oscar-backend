import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import request from 'supertest';
import { configureApp } from '../../src/common/configure-app';
import { UploadedFoldersController } from '../../src/modules/local-folders/uploaded-folders.controller';
import { UploadedFoldersService } from '../../src/modules/local-folders/uploaded-folders.service';
import { SessionAuthGuard } from '../../src/common/guards/session-auth.guard';
import { CsrfGuard } from '../../src/common/guards/csrf.guard';
import { ProjectPolicyGuard } from '../../src/common/guards/project-policy.guard';
describe('Folder multipart and original download HTTP contract', () => {
  let app: INestApplication;
  const put = jest.fn();
  const raw = Buffer.from([0, 1, 255, 128, 6]);
  const projectId = randomUUID(),
    folderId = randomUUID();
  beforeAll(async () => {
    const builder = Test.createTestingModule({
      controllers: [UploadedFoldersController],
      providers: [
        {
          provide: UploadedFoldersService,
          useValue: {
            put,
            download: async () => ({
              stream: Readable.from(raw),
              filename: 'original.bin',
              size: raw.length,
            }),
          },
        },
        {
          provide: ConfigService,
          useValue: new ConfigService({ NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:3002' }),
        },
      ],
    });
    for (const guard of [SessionAuthGuard, CsrfGuard, ProjectPolicyGuard])
      builder.overrideGuard(guard).useValue({
        canActivate: (context: { switchToHttp: () => { getRequest: () => { user: unknown } } }) => {
          context.switchToHttp().getRequest().user = { id: randomUUID() };
          return true;
        },
      });
    app = (await builder.compile()).createNestApplication();
    configureApp(app);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it('accepts exactly the browser path/file pair and cleans temporary files after success', async () => {
    let temp = '';
    put.mockImplementation(async (_p, _u, _f, path, file: Express.Multer.File) => {
      temp = file.path;
      expect(path).toBe('nested/original.bin');
      expect(await fs.readFile(temp)).toEqual(raw);
      return { id: randomUUID(), path, reason: 'Binary' };
    });
    await request(app.getHttpServer())
      .put(`/api/v1/projects/${projectId}/uploaded-folders/${folderId}/files`)
      .field('path', 'nested/original.bin')
      .attach('file', raw, 'original.bin')
      .expect(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(fs.access(temp)).rejects.toThrow();
  });
  it('streams original bytes as an attachment instead of serializing its stream', async () => {
    const response = await request(app.getHttpServer())
      .get(
        `/api/v1/projects/${projectId}/uploaded-folders/${folderId}/files/${randomUUID()}/download`,
      )
      .expect(200);
    expect(response.headers['content-disposition']).toContain('attachment;');
    expect(response.headers['content-length']).toBe('5');
    expect(response.body).toEqual(raw);
  });
});
