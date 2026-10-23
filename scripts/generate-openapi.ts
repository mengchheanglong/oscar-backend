import {
  SkillsController,
  ConversationSkillsController,
} from '../src/modules/skills/skills.controller';
import { SkillsService } from '../src/modules/skills/skills.service';
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
import { AssistantController } from '../src/modules/assistant/assistant.controller';
import { AssistantService } from '../src/modules/assistant/assistant.service';
import { SavedMemoryController } from '../src/modules/assistant/saved-memory.controller';
import { SavedMemoryService } from '../src/modules/assistant/saved-memory.service';
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
import { AgentRunsController } from '../src/modules/assistant/agent-runs.controller';
import { AgentRunsService } from '../src/modules/assistant/agent-runs.service';
import { PlatformHandoffsController } from '../src/modules/assistant/platform-handoffs.controller';
import { PlatformHandoffsService } from '../src/modules/assistant/platform-handoffs.service';
import { ApiKeysController } from '../src/modules/auth/api-keys.controller';
import { ApiKeyService } from '../src/modules/auth/services/api-key.service';
import { UserTasksController } from '../src/modules/tasks/user-tasks.controller';
import { UserDocumentsController } from '../src/modules/documents/user-documents.controller';
import { ProposalsController } from '../src/modules/assistant/proposals.controller';
import { ProposalsService } from '../src/modules/assistant/proposals.service';
import { GitHubIntegrationController } from '../src/modules/integrations/github/github-integration.controller';
import { GitHubIntegrationService } from '../src/modules/integrations/github/github-integration.service';
import { GoalsController } from '../src/modules/goals/goals.controller';
import { UserGoalsController } from '../src/modules/goals/user-goals.controller';
import { GoalsService } from '../src/modules/goals/goals.service';
import { MavisController } from '../src/modules/mavis/mavis.controller';
import { MavisService } from '../src/modules/mavis/mavis.service';
import { PlatformsController } from '../src/modules/platforms/platforms.controller';
import { PlatformsService } from '../src/modules/platforms/platforms.service';
import { ChiefController } from '../src/modules/chief-of-staff/chief.controller';
import { ChiefService } from '../src/modules/chief-of-staff/chief.service';

export const OPENAPI_CONTROLLERS = [
  SkillsController,
  ConversationSkillsController,
  ChiefController,
  UploadedFoldersController,
  LocalFoldersController,
  HealthController,
  AuthController,
  ApiKeysController,
  UsersController,
  WorkspaceController,
  ProjectsController,
  ProjectMembersController,
  DecisionsController,
  TasksController,
  UserTasksController,
  DocumentsController,
  UserDocumentsController,
  SearchController,
  IngestionController,
  AssistantController,
  ProposalsController,
  SavedMemoryController,
  AgentRunsController,
  PlatformHandoffsController,
  GitHubIntegrationController,
  GoalsController,
  UserGoalsController,
  MavisController,
  PlatformsController,
];

// Offline metadata-only app: no database connection, .env, provider call, or listening socket.
// Register new public controllers here as the API grows, and test path coverage.
@Module({
  controllers: OPENAPI_CONTROLLERS,
  providers: [
    { provide: SkillsService, useValue: {} },
    { provide: ChiefService, useValue: {} },
    { provide: UploadedFoldersService, useValue: {} },
    { provide: LocalFoldersService, useValue: {} },
    { provide: LiveFoldersService, useValue: {} },
    { provide: NativeFolderPickerService, useValue: {} },
    { provide: HealthService, useValue: {} },
    { provide: AuthService, useValue: {} },
    { provide: ApiKeyService, useValue: {} },
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
    { provide: AssistantService, useValue: {} },
    { provide: SavedMemoryService, useValue: {} },
    { provide: AgentRunsService, useValue: {} },
    { provide: PlatformHandoffsService, useValue: {} },
    { provide: ProposalsService, useValue: {} },
    { provide: GitHubIntegrationService, useValue: {} },
    { provide: GoalsService, useValue: {} },
    { provide: MavisService, useValue: {} },
    { provide: PlatformsService, useValue: {} },
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

export async function generateOpenApiDocument() {
  const app = await NestFactory.create(OpenApiModule, { logger: false });
  try {
    app.setGlobalPrefix('api/v1');
    const document = createOpenApiDocument(app);
    return document;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void generateOpenApiDocument()
    .then(async (document) => {
      await mkdir('docs', { recursive: true });
      await writeFile('docs/api/openapi.json', `${JSON.stringify(document, null, 2)}\n`);
    })
    .catch(() => {
      process.stderr.write('OpenAPI generation failed.\n');
      process.exitCode = 1;
    });
}
