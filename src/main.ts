import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './common/configure-app';
import { Environment } from './config/environment';
import { createOpenApiDocument } from './openapi';
import { SessionService } from './modules/auth/services/session.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: false });
  configureApp(app);
  app.enableShutdownHooks();
  const config = app.get(ConfigService<Environment, true>);
  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    SwaggerModule.setup(
      'api/docs',
      app,
      createOpenApiDocument(app, app.get(SessionService).getCookieName()),
    );
  }
  const port = config.get('PORT', { infer: true });
  const host =
    process.env.RENDER || process.env.NODE_ENV === 'production'
      ? '0.0.0.0'
      : config.get('HOST', { infer: true });
  const server = await app.listen(port, host);
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
}

void bootstrap().catch((err) => {
  // Avoid dumping configuration, DB connection strings, or raw provider errors.
  process.stderr.write(`Application startup failed: ${err?.message || err}\n`);
  process.exitCode = 1;
});
