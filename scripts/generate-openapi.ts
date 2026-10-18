import { UploadedFoldersController } from '../src/modules/local-folders/uploaded-folders.controller';
import { UploadedFoldersService } from '../src/modules/local-folders/uploaded-folders.service';
import 'reflect-metadata';
import { LocalFoldersController } from '../src/modules/local-folders/local-folders.controller';
import { LiveFoldersService } from '../src/modules/local-folders/live-folders.service';
import { NativeFolderPickerService } from '../src/modules/local-folders/native-folder-picker.service';
import { LocalFoldersService } from '../src/modules/local-folders/local-folders.service';
import { mkdir, writeFile } from 'node:fs/promises';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { HealthController } from '../src/modules/health/health.controller';
import { HealthService } from '../src/modules/health/health.service';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { SessionService } from '../src/modules/auth/services/session.service';
import { UsersController } from '../src/modules/users/users.controller';
import { UsersService } from '../src/modules/users/users.service';
import { WorkspaceController } from '../src/modules/users/workspace.controller';
import { WorkspaceInvitationsService } from '../src/modules/users/workspace-invitations.service';
import { ProjectsController } from '../src/modules/projects/projects.controller';
import { ProjectsService } from '../src/modules/projects/projects.service';
import { ProjectMembersController } from '../src/modules/projects/project-members.controller';
import { ProjectMembersService } from '../src/modules/projects/project-members.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { DecisionsController } from '../src/modules/decisions/decisions.controller';
import { DecisionsService } from '../src/modules/decisions/decisions.service';
import { TasksController } from '../src/modules/tasks/tasks.controller';
import { TasksService } from '../src/modules/tasks/tasks.service';
import { DocumentsController } from '../src/modules/documents/documents.controller';
import { DocumentsService } from '../src/modules/documents/documents.service';
import { SearchController } from '../src/modules/search/search.controller';
import { SearchService } from '../src/modules/search/search.service';
import { IngestionController } from '../src/modules/ingestion/ingestion.controller';
import { IngestionService } from '../src/modules/ingestion/ingestion.service';
import { AiController } from '../src/modules/ai/ai.controller';
import { AiService } from '../src/modules/ai/ai.service';
import { CopilotMemoryController } from '../src/modules/ai/copilot-memory.controller';
import { CopilotMemoryService } from '../src/modules/ai/copilot-memory.service';
import { Document } from '../src/modules/documents/entities/document.entity';
import { DocumentRevision } from '../src/modules/documents/entities/document-revision.entity';
import { STORAGE_DRIVER } from '../src/modules/storage/storage.interface';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProjectMember } from '../src/modules/projects/entities/project-member.entity';
import { Decision } from '../src/modules/decisions/entities/decision.entity';
import { DecisionRevision } from '../src/modules/decisions/entities/decision-revision.entity';
import { Task } from '../src/modules/tasks/entities/task.entity';
import { User } from '../src/modules/users/entities/user.entity';
import { Project } from '../src/modules/projects/entities/project.entity';
import { createOpenApiDocument } from '../src/openapi';
import { AgentRunsController } from '../src/modules/ai/agent-runs.controller';
import { AgentRunsService } from '../src/modules/ai/agent-runs.service';

// Offline metadata-only app: no database connection, .env, provider call, or listening socket.
// Register new public controllers here as the API grows, and test path coverage.
@Module({
  controllers: [
    UploadedFoldersController,
    LocalFoldersController,
    HealthController,
    AuthController,
    UsersController,
    WorkspaceController,
    ProjectsController,
    ProjectMembersController,
    DecisionsController,
    TasksController,
    DocumentsController,
    SearchController,
    IngestionController,
    AiController,
    CopilotMemoryController,
    AgentRunsController,
  ],
  providers: [
    { provide: UploadedFoldersService, useValue: {} },
    { provide: LocalFoldersService, useValue: {} },
    { provide: LiveFoldersService, useValue: {} },
    { provide: NativeFolderPickerService, useValue: {} },
    { provide: HealthService, useValue: {} },
    { provide: AuthService, useValue: {} },
    {
      provide: SessionService,
      useValue: {
        getCookieName: () => 'aiws_session',
        getCookieOptions: () => ({}),
      },
    },
    { provide: UsersService, useValue: {} },
    { provide: WorkspaceInvitationsService, useValue: {} },
    { provide: ProjectsService, useValue: {} },
    { provide: ProjectMembersService, useValue: {} },
    { provide: AuditService, useValue: {} },
    { provide: DecisionsService, useValue: {} },
    { provide: TasksService, useValue: {} },
    { provide: DocumentsService, useValue: {} },
    { provide: SearchService, useValue: {} },
    { provide: IngestionService, useValue: {} },
    { provide: AiService, useValue: {} },
    { provide: CopilotMemoryService, useValue: {} },
    { provide: AgentRunsService, useValue: {} },
    { provide: STORAGE_DRIVER, useValue: {} },
    { provide: getRepositoryToken(ProjectMember), useValue: {} },
    { provide: getRepositoryToken(Decision), useValue: {} },
    { provide: getRepositoryToken(DecisionRevision), useValue: {} },
    { provide: getRepositoryToken(Task), useValue: {} },
    { provide: getRepositoryToken(Document), useValue: {} },
    { provide: getRepositoryToken(DocumentRevision), useValue: {} },
    { provide: getRepositoryToken(User), useValue: {} },
    { provide: getRepositoryToken(Project), useValue: {} },
  ],
})
class OpenApiModule {}

async function generate(): Promise<void> {
  const app = await NestFactory.create(OpenApiModule, { logger: false });
  try {
    app.setGlobalPrefix('api/v1');
    const document = createOpenApiDocument(app);
    await mkdir('docs', { recursive: true });
    await writeFile('docs/openapi.json', `${JSON.stringify(document, null, 2)}\n`);
  } finally {
    await app.close();
  }
}

void generate().catch(() => {
  process.stderr.write('OpenAPI generation failed.\n');
  process.exitCode = 1;
});
