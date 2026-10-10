import 'reflect-metadata';
import { Global, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { configureApp } from '../../src/common/configure-app';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { UsersModule } from '../../src/modules/users/users.module';
import { ProjectsModule } from '../../src/modules/projects/projects.module';
import { RequirementsModule } from '../../src/modules/requirements/requirements.module';
import { DecisionsModule } from '../../src/modules/decisions/decisions.module';
import { TasksModule } from '../../src/modules/tasks/tasks.module';
import { MeetingsModule } from '../../src/modules/meetings/meetings.module';
import { AuditModule } from '../../src/modules/audit/audit.module';
import { AiModule } from '../../src/modules/ai/ai.module';
import { GitHubIntegrationModule } from '../../src/modules/integrations/github/github-integration.module';
import { User, SystemRole, ProfessionalRole } from '../../src/modules/users/entities/user.entity';
import { Session } from '../../src/modules/auth/entities/session.entity';
import { Project, ProjectStatus } from '../../src/modules/projects/entities/project.entity';
import {
  ProjectMember,
  ProjectRole,
} from '../../src/modules/projects/entities/project-member.entity';
import { AuditLog } from '../../src/modules/audit/entities/audit-log.entity';
import {
  Requirement,
  RequirementStatus,
  Priority,
} from '../../src/modules/requirements/entities/requirement.entity';
import { RequirementRevision } from '../../src/modules/requirements/entities/requirement-revision.entity';
import { Decision } from '../../src/modules/decisions/entities/decision.entity';
import { DecisionRevision } from '../../src/modules/decisions/entities/decision-revision.entity';
import { Task } from '../../src/modules/tasks/entities/task.entity';
import { Meeting } from '../../src/modules/meetings/entities/meeting.entity';
import { Conversation } from '../../src/modules/ai/entities/conversation.entity';
import { ChatMessage } from '../../src/modules/ai/entities/chat-message.entity';
import {
  AIProposal,
  ProposalStatus,
  ProposalType,
} from '../../src/modules/ai/entities/proposal.entity';
import { ProposalCommit } from '../../src/modules/ai/entities/proposal-commit.entity';
import {
  GitHubConnection,
  GitHubConnectionStatus,
} from '../../src/modules/integrations/github/entities/github-connection.entity';
import { GitHubIssue } from '../../src/modules/integrations/github/entities/github-issue.entity';
import { OutboxEvent } from '../../src/modules/ingestion/entities';
import { PasswordService } from '../../src/modules/auth/services/password.service';
import { CopilotMemory } from '../../src/modules/ai/entities/copilot-memory.entity';
import { CopilotMemoryService } from '../../src/modules/ai/copilot-memory.service';
import { AgentRun } from '../../src/modules/ai/entities/agent-run.entity';

describe('AI Security, RBAC & Cross-Project Isolation (E2E)', () => {
  jest.setTimeout(60000);

  let app: INestApplication;
  let passwordService: PasswordService;
  let userA: User;
  let userB: User;
  let userViewer: User;
  let disabledUser: User;
  let sessionA: { cookie: string; csrf: string };
  let sessionViewer: { cookie: string; csrf: string };
  let projectA: Project;
  let projectB: Project;
  let reqA: Requirement;
  let reqB: Requirement;

  const users: User[] = [];
  const sessions: Session[] = [];
  const projects: Project[] = [];
  const projectMembers: ProjectMember[] = [];
  const auditLogs: AuditLog[] = [];
  const requirements: Requirement[] = [];
  const requirementRevisions: RequirementRevision[] = [];
  const tasks: Task[] = [];
  const meetings: Meeting[] = [];
  const conversations: Conversation[] = [];
  const chatMessages: ChatMessage[] = [];
  const proposals: AIProposal[] = [];
  const proposalCommits: ProposalCommit[] = [];
  const githubConnections: GitHubConnection[] = [];
  const githubIssues: GitHubIssue[] = [];

  // ── Mock Repositories ─────────────────────────────────────────────

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
      if (idx >= 0) users[idx] = user;
      else users.push(user);
      return user;
    }),
    findOne: jest.fn(async (opts: { where: { email?: string; id?: string } }) => {
      if (opts.where.email)
        return users.find((u) => u.email.toLowerCase() === opts.where.email?.toLowerCase()) ?? null;
      if (opts.where.id) return users.find((u) => u.id === opts.where.id) ?? null;
      return null;
    }),
    find: jest.fn(async () => users),
  };

  const mockSessionRepository = {
    create: jest.fn(
      (dto: Partial<Session>) =>
        ({
          id: randomUUID(),
          createdAt: new Date(),
          ...dto,
        }) as Session,
    ),
    save: jest.fn(async (session: Session) => {
      const idx = sessions.findIndex((s) => s.id === session.id);
      if (idx >= 0) sessions[idx] = session;
      else sessions.push(session);
      return session;
    }),
    findOne: jest.fn(async (opts: { where: { tokenHash?: string } }) => {
      if (opts.where.tokenHash) {
        const found = sessions.find((s) => s.tokenHash === opts.where.tokenHash);
        if (found) {
          const user = users.find((u) => u.id === found.userId);
          return { ...found, user };
        }
      }
      return null;
    }),
    update: jest.fn(async (id: string, partial: Partial<Session>) => {
      const s = sessions.find((item) => item.id === id);
      if (s) Object.assign(s, partial);
      return { affected: 1 };
    }),
    delete: jest.fn(async (opts: { id?: string }) => {
      if (opts.id) {
        const idx = sessions.findIndex((s) => s.id === opts.id);
        if (idx >= 0) sessions.splice(idx, 1);
      }
      return { affected: 1 };
    }),
  };

  const mockProjectRepository = {
    create: jest.fn(
      (dto: Partial<Project>) =>
        ({
          id: randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
          status: ProjectStatus.ACTIVE,
          version: 1,
          ...dto,
        }) as Project,
    ),
    save: jest.fn(async (proj: Project) => {
      const idx = projects.findIndex((p) => p.id === proj.id);
      if (idx >= 0) projects[idx] = proj;
      else projects.push(proj);
      return proj;
    }),
    findOne: jest.fn(async (opts: { where: { id?: string } }) => {
      if (opts.where.id) return projects.find((p) => p.id === opts.where.id) ?? null;
      return null;
    }),
  };

  const mockProjectMemberRepository = {
    create: jest.fn(
      (dto: Partial<ProjectMember>) =>
        ({
          id: randomUUID(),
          joinedAt: new Date(),
          updatedAt: new Date(),
          ...dto,
        }) as ProjectMember,
    ),
    save: jest.fn(async (member: ProjectMember) => {
      const idx = projectMembers.findIndex((m) => m.id === member.id);
      if (idx >= 0) projectMembers[idx] = member;
      else projectMembers.push(member);
      return member;
    }),
    findOne: jest.fn(async (opts: { where: { projectId?: string; userId?: string } }) => {
      const m = projectMembers.find(
        (member) =>
          (!opts.where.projectId || member.projectId === opts.where.projectId) &&
          (!opts.where.userId || member.userId === opts.where.userId) &&
          !member.removedAt,
      );
      if (!m) return null;
      const proj = projects.find((p) => p.id === m.projectId) ?? null;
      return { ...m, project: proj };
    }),
    find: jest.fn(async (opts: { where: { projectId?: string; userId?: string } }) => {
      return projectMembers.filter(
        (m) =>
          (!opts.where.projectId || m.projectId === opts.where.projectId) &&
          (!opts.where.userId || m.userId === opts.where.userId),
      );
    }),
  };

  const mockAuditLogRepository = {
    create: jest.fn((dto: Partial<AuditLog>) => ({ id: randomUUID(), ...dto }) as AuditLog),
    save: jest.fn(async (log: AuditLog) => {
      auditLogs.push(log);
      return log;
    }),
  };

  const mockRequirementRepository = {
    create: jest.fn(
      (dto: Partial<Requirement>) =>
        ({
          id: randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
          version: 1,
          ...dto,
        }) as Requirement,
    ),
    save: jest.fn(async (req: Requirement) => {
      const idx = requirements.findIndex((r) => r.id === req.id);
      if (idx >= 0) requirements[idx] = req;
      else requirements.push(req);
      return req;
    }),
    findOne: jest.fn(async (opts: { where: { id?: string; projectId?: string } }) => {
      return (
        requirements.find(
          (r) =>
            (!opts.where.id || r.id === opts.where.id) &&
            (!opts.where.projectId || r.projectId === opts.where.projectId) &&
            !r.deletedAt,
        ) ?? null
      );
    }),
  };

  const mockRequirementRevisionRepository = {
    create: jest.fn(
      (dto: Partial<RequirementRevision>) =>
        ({
          id: randomUUID(),
          createdAt: new Date(),
          ...dto,
        }) as RequirementRevision,
    ),
    save: jest.fn(async (rev: RequirementRevision) => {
      requirementRevisions.push(rev);
      return rev;
    }),
  };

  const mockTaskRepository = {
    create: jest.fn(
      (dto: Partial<Task>) =>
        ({
          id: randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
          version: 1,
          ...dto,
        }) as Task,
    ),
    save: jest.fn(async (tsk: Task) => {
      const idx = tasks.findIndex((t) => t.id === tsk.id);
      if (idx >= 0) tasks[idx] = tsk;
      else tasks.push(tsk);
      return tsk;
    }),
    findOne: jest.fn(async (opts: { where: { id?: string; projectId?: string } }) => {
      return (
        tasks.find(
          (t) =>
            (!opts.where.id || t.id === opts.where.id) &&
            (!opts.where.projectId || t.projectId === opts.where.projectId) &&
            !t.deletedAt,
        ) ?? null
      );
    }),
    count: jest.fn(async () => tasks.length),
  };

  const mockMeetingRepository = {
    findOne: jest.fn(async (opts: { where: { id?: string; projectId?: string } }) => {
      return (
        meetings.find(
          (m) =>
            (!opts.where.id || m.id === opts.where.id) &&
            (!opts.where.projectId || m.projectId === opts.where.projectId) &&
            !m.deletedAt,
        ) ?? null
      );
    }),
  };

  const mockConversationRepository = {
    create: jest.fn(
      (dto: Partial<Conversation>) =>
        ({
          id: randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
          ...dto,
        }) as Conversation,
    ),
    save: jest.fn(async (conv: Conversation) => {
      const idx = conversations.findIndex((c) => c.id === conv.id);
      if (idx >= 0) conversations[idx] = conv;
      else conversations.push(conv);
      return conv;
    }),
    findOne: jest.fn(async (opts: { where: { id?: string; projectId?: string } }) => {
      return (
        conversations.find(
          (c) =>
            (!opts.where.id || c.id === opts.where.id) &&
            (!opts.where.projectId || c.projectId === opts.where.projectId),
        ) ?? null
      );
    }),
    find: jest.fn(async (opts: { where: { projectId?: string } }) => {
      return conversations.filter(
        (c) => !opts.where.projectId || c.projectId === opts.where.projectId,
      );
    }),
  };

  const mockChatMessageRepository = {
    create: jest.fn(
      (dto: Partial<ChatMessage>) =>
        ({
          id: randomUUID(),
          createdAt: new Date(),
          ...dto,
        }) as ChatMessage,
    ),
    save: jest.fn(async (msg: ChatMessage) => {
      chatMessages.push(msg);
      return msg;
    }),
    find: jest.fn(async (opts: { where: { conversationId?: string } }) => {
      return chatMessages.filter(
        (m) => !opts.where.conversationId || m.conversationId === opts.where.conversationId,
      );
    }),
  };

  const mockProposalRepository = {
    create: jest.fn(
      (dto: Partial<AIProposal>) =>
        ({
          id: randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
          version: 1,
          status: ProposalStatus.PENDING,
          ...dto,
        }) as AIProposal,
    ),
    save: jest.fn(async (prop: AIProposal) => {
      const idx = proposals.findIndex((p) => p.id === prop.id);
      if (idx >= 0) proposals[idx] = prop;
      else proposals.push(prop);
      return prop;
    }),
    findOne: jest.fn(async (opts: { where: { id?: string; projectId?: string } }) => {
      return (
        proposals.find(
          (p) =>
            (!opts.where.id || p.id === opts.where.id) &&
            (!opts.where.projectId || p.projectId === opts.where.projectId),
        ) ?? null
      );
    }),
    find: jest.fn(async (opts: { where: { projectId?: string } }) => {
      return proposals.filter((p) => !opts.where.projectId || p.projectId === opts.where.projectId);
    }),
  };

  const mockProposalCommitRepository = {
    create: jest.fn(
      (dto: Partial<ProposalCommit>) =>
        ({
          id: randomUUID(),
          createdAt: new Date(),
          ...dto,
        }) as ProposalCommit,
    ),
    save: jest.fn(async (commit: ProposalCommit) => {
      proposalCommits.push(commit);
      return commit;
    }),
    findOne: jest.fn(async (opts: { where: { idempotencyKey?: string } }) => {
      return (
        proposalCommits.find(
          (c) => !opts.where.idempotencyKey || c.idempotencyKey === opts.where.idempotencyKey,
        ) ?? null
      );
    }),
  };

  const mockGitHubConnectionRepository = {
    create: jest.fn(
      (dto: Partial<GitHubConnection>) =>
        ({
          id: randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
          status: GitHubConnectionStatus.CONNECTED,
          ...dto,
        }) as GitHubConnection,
    ),
    save: jest.fn(async (conn: GitHubConnection) => {
      const idx = githubConnections.findIndex((c) => c.id === conn.id);
      if (idx >= 0) githubConnections[idx] = conn;
      else githubConnections.push(conn);
      return conn;
    }),
    findOne: jest.fn(async (opts: { where: { projectId?: string } }) => {
      return (
        githubConnections.find(
          (c) => !opts.where.projectId || c.projectId === opts.where.projectId,
        ) ?? null
      );
    }),
  };

  const mockGitHubIssueRepository = {
    create: jest.fn((dto: Partial<GitHubIssue>) => ({ id: randomUUID(), ...dto }) as GitHubIssue),
    save: jest.fn(async (issue: GitHubIssue) => {
      const idx = githubIssues.findIndex((i) => i.id === issue.id);
      if (idx >= 0) githubIssues[idx] = issue;
      else githubIssues.push(issue);
      return issue;
    }),
    find: jest.fn(async () => githubIssues),
    count: jest.fn(async () => githubIssues.length),
  };

  const mockIngestionService = {
    syncGitHubIssue: jest.fn(async () => {}),
    deactivateSourcesByType: jest.fn(async () => {}),
  };

  const genericMockRepo = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    save: jest.fn((e: unknown) => Promise.resolve(e)),
    create: jest.fn((e: unknown) => e),
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
    count: jest.fn().mockResolvedValue(0),
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getOne: jest.fn().mockResolvedValue(null),
    })),
  };

  const mockDataSource = {
    entityMetadatas: [] as unknown[],
    options: { type: 'postgres' },
    getRepository: jest.fn((entity: unknown) => {
      if (entity === User) return mockUserRepository;
      if (entity === Session) return mockSessionRepository;
      if (entity === Project) return mockProjectRepository;
      if (entity === ProjectMember) return mockProjectMemberRepository;
      if (entity === AuditLog) return mockAuditLogRepository;
      if (entity === Requirement) return mockRequirementRepository;
      if (entity === RequirementRevision) return mockRequirementRevisionRepository;
      if (entity === Decision) return mockRequirementRepository;
      if (entity === DecisionRevision) return mockRequirementRevisionRepository;
      if (entity === Task) return mockTaskRepository;
      if (entity === Meeting) return mockMeetingRepository;
      if (entity === Conversation) return mockConversationRepository;
      if (entity === ChatMessage) return mockChatMessageRepository;
      if (entity === AIProposal) return mockProposalRepository;
      if (entity === ProposalCommit) return mockProposalCommitRepository;
      if (entity === GitHubConnection) return mockGitHubConnectionRepository;
      if (entity === GitHubIssue) return mockGitHubIssueRepository;
      return genericMockRepo;
    }),
    createQueryRunner: () => ({
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: mockManager,
    }),
    transaction: jest.fn(async (runInTransaction: (manager: unknown) => Promise<unknown>) => {
      return runInTransaction(mockManager);
    }),
  };

  const mockManager: Record<string, unknown> = {
    getRepository: jest.fn((entity: unknown) => mockDataSource.getRepository(entity)),
    save: jest.fn(async (entityOrClass: unknown, maybeEntity?: unknown) => {
      const entity = (maybeEntity !== undefined ? maybeEntity : entityOrClass) as Record<
        string,
        unknown
      >;
      if (entity?.idempotencyKey) {
        proposalCommits.push(entity as unknown as ProposalCommit);
      } else if (entity?.proposalType) {
        const idx = proposals.findIndex((p) => p.id === entity.id);
        if (idx >= 0) proposals[idx] = entity as unknown as AIProposal;
        else proposals.push(entity as unknown as AIProposal);
      } else if (entity?.status && entity?.priority) {
        tasks.push(entity as unknown as Task);
      }
      return entity;
    }),
    create: jest.fn((_entityClass: unknown, dto: Record<string, unknown>) => ({
      id: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...dto,
    })),
    query: jest.fn(async () => [{ max: 0 }]),
    update: jest.fn(async () => {}),
    findOne: jest.fn(
      async (
        entityClass: unknown,
        opts: { where: { id?: string; projectId?: string; userId?: string } },
      ) => {
        if (entityClass === AIProposal) {
          return proposals.find((p) => p.id === opts.where.id) ?? null;
        }
        if (entityClass === Requirement) {
          return requirements.find((r) => r.id === opts.where.id) ?? null;
        }
        if (entityClass === ProjectMember) {
          return (
            projectMembers.find(
              (m) =>
                (!opts.where.projectId || m.projectId === opts.where.projectId) &&
                (!opts.where.userId || m.userId === opts.where.userId),
            ) ?? null
          );
        }
        if (entityClass === OutboxEvent) {
          return null;
        }
        return null;
      },
    ),
  };

  @Global()
  @Module({
    providers: [
      {
        provide: ConfigService,
        useValue: new ConfigService({
          NODE_ENV: 'test',
          PORT: 3000,
          APP_ORIGIN: 'http://localhost:3000',
          SESSION_IDLE_HOURS: 8,
          SESSION_ABSOLUTE_DAYS: 7,
          LOG_LEVEL: 'silent',
          STORAGE_LOCAL_ROOT: './var/uploads-test',
          MAX_UPLOAD_BYTES: 20971520,
        }),
      },
      { provide: DataSource, useValue: mockDataSource },
      { provide: 'IngestionService', useValue: mockIngestionService },
    ],
    exports: [ConfigService, DataSource, 'IngestionService'],
  })
  class TestDatabaseModule {}

  // ── Test Module Setup ─────────────────────────────────────────────

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TestDatabaseModule,
        AuthModule,
        UsersModule,
        ProjectsModule,
        RequirementsModule,
        DecisionsModule,
        TasksModule,
        MeetingsModule,
        AuditModule,
        AiModule,
        GitHubIntegrationModule,
      ],
    })
      .overrideProvider(getRepositoryToken(User))
      .useValue(mockUserRepository)
      .overrideProvider(getRepositoryToken(Session))
      .useValue(mockSessionRepository)
      .overrideProvider(getRepositoryToken(Project))
      .useValue(mockProjectRepository)
      .overrideProvider(getRepositoryToken(ProjectMember))
      .useValue(mockProjectMemberRepository)
      .overrideProvider(getRepositoryToken(AuditLog))
      .useValue(mockAuditLogRepository)
      .overrideProvider(getRepositoryToken(Requirement))
      .useValue(mockRequirementRepository)
      .overrideProvider(getRepositoryToken(RequirementRevision))
      .useValue(mockRequirementRevisionRepository)
      .overrideProvider(getRepositoryToken(Decision))
      .useValue(mockRequirementRepository)
      .overrideProvider(getRepositoryToken(DecisionRevision))
      .useValue(mockRequirementRevisionRepository)
      .overrideProvider(getRepositoryToken(Task))
      .useValue(mockTaskRepository)
      .overrideProvider(getRepositoryToken(Meeting))
      .useValue(mockMeetingRepository)
      .overrideProvider(getRepositoryToken(Conversation))
      .useValue(mockConversationRepository)
      .overrideProvider(getRepositoryToken(ChatMessage))
      .useValue(mockChatMessageRepository)
      .overrideProvider(getRepositoryToken(CopilotMemory))
      .useValue({})
      .overrideProvider(getRepositoryToken(AgentRun))
      .useValue({})
      .overrideProvider(CopilotMemoryService)
      .useValue({ list: jest.fn().mockResolvedValue([]) })
      .overrideProvider(getRepositoryToken(AIProposal))
      .useValue(mockProposalRepository)
      .overrideProvider(getRepositoryToken(ProposalCommit))
      .useValue(mockProposalCommitRepository)
      .overrideProvider(getRepositoryToken(GitHubConnection))
      .useValue(mockGitHubConnectionRepository)
      .overrideProvider(getRepositoryToken(GitHubIssue))
      .useValue(mockGitHubIssueRepository)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    passwordService = moduleRef.get<PasswordService>(PasswordService);

    const pwHash = await passwordService.hash('Password123!');

    // Users
    userA = {
      id: randomUUID(),
      email: 'alice@example.com',
      displayName: 'Alice Manager',
      passwordHash: pwHash,
      systemRole: SystemRole.USER,
      professionalRole: ProfessionalRole.DEVELOPER,
      isActive: true,
      mustChangePassword: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as User;
    users.push(userA);

    userB = {
      id: randomUUID(),
      email: 'bob@example.com',
      displayName: 'Bob SEC',
      passwordHash: pwHash,
      systemRole: SystemRole.USER,
      professionalRole: ProfessionalRole.DEVELOPER,
      isActive: true,
      mustChangePassword: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as User;
    users.push(userB);

    userViewer = {
      id: randomUUID(),
      email: 'charlie@example.com',
      displayName: 'Charlie Viewer',
      passwordHash: pwHash,
      systemRole: SystemRole.USER,
      professionalRole: ProfessionalRole.QA,
      isActive: true,
      mustChangePassword: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as User;
    users.push(userViewer);

    disabledUser = {
      id: randomUUID(),
      email: 'disabled@example.com',
      displayName: 'Disabled Eve',
      passwordHash: pwHash,
      systemRole: SystemRole.USER,
      professionalRole: ProfessionalRole.QA,
      isActive: false,
      mustChangePassword: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as User;
    users.push(disabledUser);

    // Projects
    projectA = {
      id: randomUUID(),
      name: 'Project AIW',
      slug: 'aiw',
      key: 'AIW',
      status: ProjectStatus.ACTIVE,
      createdById: userA.id,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Project;
    projects.push(projectA);

    projectB = {
      id: randomUUID(),
      name: 'Project SEC',
      slug: 'sec',
      key: 'SEC',
      status: ProjectStatus.ACTIVE,
      createdById: userB.id,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Project;
    projects.push(projectB);

    // Memberships
    projectMembers.push({
      id: randomUUID(),
      projectId: projectA.id,
      userId: userA.id,
      accessRole: ProjectRole.MANAGER,
      joinedAt: new Date(),
      removedAt: null,
    } as unknown as ProjectMember);

    projectMembers.push({
      id: randomUUID(),
      projectId: projectA.id,
      userId: userViewer.id,
      accessRole: ProjectRole.VIEWER,
      joinedAt: new Date(),
      removedAt: null,
    } as unknown as ProjectMember);

    projectMembers.push({
      id: randomUUID(),
      projectId: projectB.id,
      userId: userB.id,
      accessRole: ProjectRole.OWNER,
      joinedAt: new Date(),
      removedAt: null,
    } as unknown as ProjectMember);

    // Requirements
    reqA = {
      id: randomUUID(),
      projectId: projectA.id,
      key: 'AIW-REQ-1',
      title: 'Auth Setup',
      status: RequirementStatus.APPROVED,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Requirement;
    requirements.push(reqA);

    reqB = {
      id: randomUUID(),
      projectId: projectB.id,
      key: 'SEC-REQ-1',
      title: 'Secret Defense Crypto',
      status: RequirementStatus.APPROVED,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Requirement;
    requirements.push(reqB);

    // Initial logins
    const loginUser = async (email: string) => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'Password123!' });
      const cookieHeader = res.headers['set-cookie'] || [];
      const sessionCookie = (Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader]).find(
        (c: string) => c.startsWith('aiws_session='),
      );
      return {
        cookie: sessionCookie ? sessionCookie.split(';')[0]! : '',
        csrf: res.body?.data?.csrfToken ?? '',
      };
    };

    sessionA = await loginUser('alice@example.com');
    sessionViewer = await loginUser('charlie@example.com');
  }, 60000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  }, 10000);

  beforeEach(() => {
    proposals.length = 0;
    proposalCommits.length = 0;
    tasks.length = 0;
    reqA.version = 1;
  });

  // ── Scenario 1: Cross-Project Isolation (404 Leak Prevention) ──
  it('protects agent-run endpoints with authentication, project scope, CSRF and validated prompts', async () => {
    const path = `/api/v1/projects/${projectA.id}/ai/runs`;
    expect((await request(app.getHttpServer()).get(`${path}/runtime`)).status).toBe(401);
    expect(
      (
        await request(app.getHttpServer())
          .get(`/api/v1/projects/${projectB.id}/ai/runs/runtime`)
          .set('Cookie', sessionA.cookie)
      ).status,
    ).toBe(404);
    const status = await request(app.getHttpServer())
      .get(`${path}/runtime`)
      .set('Cookie', sessionA.cookie);
    expect(status.status).toBe(200);
    expect(status.body.available ?? status.body.data?.available).toBe(false);
    expect(
      (
        await request(app.getHttpServer())
          .post(path)
          .set('Cookie', sessionA.cookie)
          .send({ prompt: 'Synthetic run', idempotencyKey: randomUUID() })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app.getHttpServer())
          .post(path)
          .set('Cookie', sessionA.cookie)
          .set('x-csrf-token', sessionA.csrf)
          .send({ prompt: '   ', idempotencyKey: randomUUID() })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app.getHttpServer())
          .post(path)
          .set('Cookie', sessionA.cookie)
          .set('x-csrf-token', sessionA.csrf)
          .send({ prompt: 'Synthetic run', idempotencyKey: 'invalid' })
      ).status,
    ).toBe(400);
  });

  it('protects memory endpoints with authentication, project isolation, CSRF and explicit-review validation', async () => {
    const path = `/api/v1/projects/${projectA.id}/ai/memories`;
    expect((await request(app.getHttpServer()).get(path)).status).toBe(401);
    expect(
      (
        await request(app.getHttpServer())
          .get(`/api/v1/projects/${projectB.id}/ai/memories`)
          .set('Cookie', sessionA.cookie)
      ).status,
    ).toBe(404);
    const payload = {
      kind: 'CONTEXT',
      content: 'Reviewed goal.',
      idempotencyKey: randomUUID(),
      userConfirmed: true,
    };
    expect(
      (await request(app.getHttpServer()).post(path).set('Cookie', sessionA.cookie).send(payload))
        .status,
    ).toBe(403);
    expect(
      (
        await request(app.getHttpServer())
          .post(path)
          .set('Cookie', sessionA.cookie)
          .set('x-csrf-token', sessionA.csrf)
          .send({ ...payload, userConfirmed: false })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app.getHttpServer())
          .post(path)
          .set('Cookie', sessionA.cookie)
          .set('x-csrf-token', sessionA.csrf)
          .send({ ...payload, content: '  ' })
      ).status,
    ).toBe(400);
  });

  it('[Security Gate 1] Project A user cannot view or guess Project B resources (404 Not Found)', async () => {
    // 1. Get Project B details
    const getProj = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectB.id}`)
      .set('Cookie', sessionA.cookie);
    expect(getProj.status).toBe(404);

    // 2. Get Project B AI conversations
    const getConv = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectB.id}/ai/conversations`)
      .set('Cookie', sessionA.cookie);
    expect(getConv.status).toBe(404);

    // 3. Create conversation in Project B
    const createConv = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectB.id}/ai/conversations`)
      .set('Cookie', sessionA.cookie)
      .set('x-csrf-token', sessionA.csrf)
      .send({ title: 'Hacked Conversation' });
    expect(createConv.status).toBe(404);

    // 4. Generate AI tasks from Project B requirement
    const genTasks = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectB.id}/ai/requirements/${reqB.id}/task-proposals`)
      .set('Cookie', sessionA.cookie)
      .set('x-csrf-token', sessionA.csrf)
      .send({});
    expect(genTasks.status).toBe(404);

    // 5. Query Project B GitHub integration
    const getGit = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectB.id}/integrations/github`)
      .set('Cookie', sessionA.cookie);
    expect(getGit.status).toBe(404);

    // 6. Trigger sync on Project B GitHub
    const syncGit = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectB.id}/integrations/github/sync`)
      .set('Cookie', sessionA.cookie)
      .set('x-csrf-token', sessionA.csrf)
      .send({});
    expect(syncGit.status).toBe(404);
  });

  // ── Scenario 2: RBAC Policy Boundary (Viewer cannot write or confirm) ──

  it('[Security Gate 2] VIEWER role cannot connect GitHub or confirm AI proposals (403 Forbidden)', async () => {
    // 1. Viewer attempts to connect GitHub repository (requires OWNER or MANAGER)
    const connectGit = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectA.id}/integrations/github/connect`)
      .set('Cookie', sessionViewer.cookie)
      .set('x-csrf-token', sessionViewer.csrf)
      .send({ repositoryOwner: 'octocat', repositoryName: 'Hello-World' });
    expect(connectGit.status).toBe(403);

    // 2. Viewer attempts to trigger sync (requires OWNER or MANAGER)
    const syncGit = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectA.id}/integrations/github/sync`)
      .set('Cookie', sessionViewer.cookie)
      .set('x-csrf-token', sessionViewer.csrf)
      .send({});
    expect(syncGit.status).toBe(403);

    // 3. Create a proposal in Project A
    const proposal = {
      id: randomUUID(),
      projectId: projectA.id,
      userId: userA.id,
      proposalType: ProposalType.TASK_PROPOSAL,
      sourceEntityType: 'REQUIREMENT',
      sourceEntityId: reqA.id,
      sourceRevision: 1,
      status: ProposalStatus.PENDING,
      version: 1,
      expiresAt: new Date(Date.now() + 86400000),
      draftJson: {
        type: 'CREATE_TASKS',
        items: [{ itemId: 'item-1', title: 'Task 1', priority: Priority.HIGH }],
      },
      resultRecordIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as AIProposal;
    proposals.push(proposal);

    // 4. Viewer attempts to confirm AI proposal (requires CONTRIBUTOR, MANAGER, or OWNER)
    const confirmProp = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectA.id}/ai/proposals/${proposal.id}/confirm`)
      .set('Cookie', sessionViewer.cookie)
      .set('x-csrf-token', sessionViewer.csrf)
      .set('Idempotency-Key', 'key-viewer-123')
      .send({ version: 1 });
    expect(confirmProp.status).toBe(403);
  });

  // ── Scenario 3: CSRF Double Submit Cookie Enforcement ──

  it('[Security Gate 3] Mutations without x-csrf-token header are rejected with 403 Forbidden', async () => {
    const livePath = `/api/v1/projects/${projectA.id}/local-folders/live`;
    await request(app.getHttpServer()).get(livePath).expect(401);
    await request(app.getHttpServer()).post(`${livePath}/pick`).expect(401);
    await request(app.getHttpServer())
      .post(`${livePath}/pick`)
      .set('Cookie', sessionA.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .post(livePath)
      .set('Cookie', sessionA.cookie)
      .send({ path: 'synthetic' })
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectB.id}/local-folders/live`)
      .set('Cookie', sessionA.cookie)
      .expect(404);
    await request(app.getHttpServer()).get(livePath).set('Cookie', sessionA.cookie).expect(200);
    const createConvNoCsrf = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectA.id}/ai/conversations`)
      .set('Cookie', sessionA.cookie)
      .send({ title: 'No CSRF Conversation' });

    expect(createConvNoCsrf.status).toBe(403);
    expect(createConvNoCsrf.body.error?.code).toBe('CSRF_INVALID');
  });

  // ── Scenario 4: Disabled Account & Revoked Session ──

  it('[Security Gate 4] Disabled accounts cannot perform requests', async () => {
    const disabledLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'disabled@example.com', password: 'Password123!' });

    expect(disabledLogin.status).toBe(401);
    expect(disabledLogin.body.error?.code).toBe('ACCOUNT_DISABLED');
  });

  // ── Scenario 5: Idempotency Key Replay Caching ──

  it('[Security Gate 5] Duplicate proposal confirmation with same Idempotency-Key returns cached response without duplicate records', async () => {
    const proposal = {
      id: randomUUID(),
      projectId: projectA.id,
      userId: userA.id,
      proposalType: ProposalType.TASK_PROPOSAL,
      sourceEntityType: 'REQUIREMENT',
      sourceEntityId: reqA.id,
      sourceRevision: 1,
      status: ProposalStatus.PENDING,
      version: 1,
      expiresAt: new Date(Date.now() + 86400000),
      draftJson: {
        type: 'CREATE_TASKS',
        items: [{ itemId: 'item-idem-1', title: 'Idempotent Task', priority: Priority.HIGH }],
      },
      resultRecordIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as AIProposal;
    proposals.push(proposal);

    const idempotencyKey = randomUUID();

    // First confirmation
    const firstRes = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectA.id}/ai/proposals/${proposal.id}/confirm`)
      .set('Cookie', sessionA.cookie)
      .set('x-csrf-token', sessionA.csrf)
      .set('Idempotency-Key', idempotencyKey)
      .send({ version: 1 });
    expect(firstRes.status).toBe(200);
    expect(firstRes.body.proposal.status).toBe(ProposalStatus.CONFIRMED);

    // Second confirmation (replay with same key)
    const secondRes = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectA.id}/ai/proposals/${proposal.id}/confirm`)
      .set('Cookie', sessionA.cookie)
      .set('x-csrf-token', sessionA.csrf)
      .set('Idempotency-Key', idempotencyKey)
      .send({ version: 1 });
    expect(secondRes.status).toBe(200);
    expect(secondRes.body.proposal.id).toBe(firstRes.body.proposal.id);
  });

  // ── Scenario 6: Stale Source Conflict Detection ──

  it('[Security Gate 6] Stale proposal confirmation is rejected with 409 STALE_PROPOSAL when source revision has drifted', async () => {
    const proposal = {
      id: randomUUID(),
      projectId: projectA.id,
      userId: userA.id,
      proposalType: ProposalType.TASK_PROPOSAL,
      sourceEntityType: 'REQUIREMENT',
      sourceEntityId: reqA.id,
      sourceRevision: 1, // Created against revision 1
      status: ProposalStatus.PENDING,
      version: 1,
      expiresAt: new Date(Date.now() + 86400000),
      draftJson: {
        type: 'CREATE_TASKS',
        items: [{ itemId: 'item-stale-1', title: 'Stale Task', priority: Priority.HIGH }],
      },
      resultRecordIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as AIProposal;
    proposals.push(proposal);

    // Simulate requirement revision update to revision 2
    reqA.version = 2;

    const staleRes = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectA.id}/ai/proposals/${proposal.id}/confirm`)
      .set('Cookie', sessionA.cookie)
      .set('x-csrf-token', sessionA.csrf)
      .set('Idempotency-Key', randomUUID())
      .send({ version: 1 });

    expect(staleRes.status).toBe(409);
    expect(staleRes.body.error?.code).toBe('STALE_PROPOSAL');
  });
});
