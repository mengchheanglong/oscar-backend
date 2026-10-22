import { LocalFoldersModule } from './modules/local-folders/local-folders.module';
import { ChiefModule } from './modules/chief-of-staff/chief.module';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { Environment, validateEnvironment } from './config/environment';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { AuditModule } from './modules/audit/audit.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { DecisionsModule } from './modules/decisions/decisions.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { StorageModule } from './modules/storage/storage.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { SearchModule } from './modules/search/search.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { OutboxModule } from './modules/ingestion/outbox.module';
import { AssistantModule } from './modules/assistant/assistant.module';
import { GitHubIntegrationModule } from './modules/integrations/github/github-integration.module';
import { GoalsModule } from './modules/goals/goals.module';
import { MavisModule } from './modules/mavis/mavis.module';
import { PlatformsModule } from './modules/platforms/platforms.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnvironment }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          genReqId: (_request, response) =>
            String(response.getHeader('x-request-id') ?? randomUUID()),
          redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
          serializers: {
            // Query strings and full headers can contain secrets; don't serialize them.
            req: (request: { id: string; method: string }) => ({
              id: request.id,
              method: request.method,
            }),
            res: (response: { statusCode: number }) => ({ statusCode: response.statusCode }),
            err: () => ({ message: 'Request failed' }),
          },
        },
      }),
    }),
    DatabaseModule,
    HealthModule,
    UsersModule,
    AuthModule,
    AuditModule,
    ProjectsModule,
    DecisionsModule,
    TasksModule,
    StorageModule,
    DocumentsModule,
    SearchModule,
    OutboxModule,
    IngestionModule,
    AssistantModule,
    LocalFoldersModule,
    GitHubIntegrationModule,
    GoalsModule,
    MavisModule,
    PlatformsModule,
    ChiefModule,
  ],
})
export class AppModule {}
