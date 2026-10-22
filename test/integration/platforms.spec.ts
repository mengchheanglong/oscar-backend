import 'reflect-metadata';
import { DataSource, In } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { databaseOptions } from '../../src/database/database-options';
import { PlatformsService } from '../../src/modules/platforms/platforms.service';
import {
  PlatformAuthType,
  PlatformConnection,
  PlatformConnectionStatus,
  PlatformType,
} from '../../src/modules/platforms/entities/platform-connection.entity';
import {
  ExternalEntityType,
  ExternalLink,
} from '../../src/modules/platforms/entities/external-link.entity';
import { User, SystemRole, ProfessionalRole } from '../../src/modules/users/entities/user.entity';
import { Project, ProjectStatus } from '../../src/modules/projects/entities/project.entity';
import {
  ProjectMember,
  ProjectRole,
} from '../../src/modules/projects/entities/project-member.entity';
import {
  Goal,
  GoalStatus,
  GoalCategory,
  GoalReviewCadence,
} from '../../src/modules/goals/entities';
import {
  PaperclipAdapter,
  PAPERCLIP_CAPABILITIES,
} from '../../src/modules/platforms/adapters/paperclip.adapter';
import { T3Adapter, T3_CAPABILITIES } from '../../src/modules/platforms/adapters/t3.adapter';

describe('Platforms layer (PostgreSQL integration)', () => {
  let database: DataSource;
  let service: PlatformsService;
  let userA: User;
  let userB: User;
  let projectA: Project;
  let projectB: Project;
  let goalA: Goal;
  const projectIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    process.env.PLATFORM_ALLOWED_ORIGINS = 'https://paperclip.internal,http://localhost:3100';
    const url = process.env.DATABASE_URL;
    if (process.env.NODE_ENV !== 'test' || !url || !new URL(url).pathname.endsWith('_test')) {
      throw new Error(
        'Integration tests require a dedicated _test database. Use pnpm test:integration.',
      );
    }

    database = await new DataSource(databaseOptions(url)).initialize();
    await database.runMigrations({ transaction: 'all' });

    const userRepo = database.getRepository(User);
    userA = await userRepo.save(
      userRepo.create({
        email: `${randomUUID()}@platforms.test`,
        displayName: 'Platform Founder A',
        passwordHash: 'synthetic-hash-test',
        systemRole: SystemRole.USER,
        professionalRole: ProfessionalRole.DEVELOPER,
        isActive: true,
      }),
    );
    userIds.push(userA.id);

    userB = await userRepo.save(
      userRepo.create({
        email: `${randomUUID()}@platforms.test`,
        displayName: 'Platform Founder B',
        passwordHash: 'synthetic-hash-test',
        systemRole: SystemRole.USER,
        professionalRole: ProfessionalRole.DEVELOPER,
        isActive: true,
      }),
    );
    userIds.push(userB.id);

    const projectRepo = database.getRepository(Project);
    projectA = await projectRepo.save(
      projectRepo.create({
        key: `PLT${randomUUID().slice(0, 5).toUpperCase()}`,
        name: 'Platform Project Alpha',
        createdBy: userA.id,
        status: ProjectStatus.ACTIVE,
      }),
    );
    projectIds.push(projectA.id);

    projectB = await projectRepo.save(
      projectRepo.create({
        key: `PLT${randomUUID().slice(0, 5).toUpperCase()}`,
        name: 'Platform Project Beta',
        createdBy: userB.id,
        status: ProjectStatus.ACTIVE,
      }),
    );
    projectIds.push(projectB.id);

    const memberRepo = database.getRepository(ProjectMember);
    await memberRepo.save([
      memberRepo.create({
        projectId: projectA.id,
        userId: userA.id,
        accessRole: ProjectRole.OWNER,
      }),
      memberRepo.create({
        projectId: projectB.id,
        userId: userB.id,
        accessRole: ProjectRole.OWNER,
      }),
    ]);

    const goalRepo = database.getRepository(Goal);
    goalA = await goalRepo.save(
      goalRepo.create({
        userId: userA.id,
        projectId: projectA.id,
        title: 'Platform Interoperability Goal',
        description: 'Demonstrate read-only connections',
        motivation: 'Proof of interoperability',
        status: GoalStatus.ACTIVE,
        timeframe: 'Q4 2026',
        category: GoalCategory.BUSINESS,
        reviewCadence: GoalReviewCadence.WEEKLY,
      }),
    );

    const paperclipAdapter = {
      platformType: PlatformType.PAPERCLIP,
      checkHealth: jest.fn().mockResolvedValue({
        status: PlatformConnectionStatus.HEALTHY,
        capabilities: PAPERCLIP_CAPABILITIES,
        versionInfo: { apiVersion: '1.2.0', versionDrift: false },
      }),
      fetchEntities: jest.fn().mockResolvedValue({
        type: PlatformType.PAPERCLIP,
        data: {
          agents: [{ id: 'ag-1', name: 'Agent 1', status: 'ACTIVE' }],
          teams: [{ id: 'tm-1', name: 'Team 1' }],
          issues: [
            {
              id: 'iss-1',
              title: 'Verify PostgreSQL schema',
              status: 'OPEN',
              url: 'https://paperclip.test/issues/iss-1',
            },
          ],
        },
      }),
      fetchEntity: jest.fn().mockResolvedValue({
        found: true,
        accessible: true,
        entityType: ExternalEntityType.ISSUE,
        id: 'iss-1',
        title: 'Verify PostgreSQL schema',
        url: 'https://paperclip.test/issues/iss-1',
      }),
    } as unknown as PaperclipAdapter;

    const t3Adapter = {
      platformType: PlatformType.T3,
      checkHealth: jest.fn().mockResolvedValue({
        status: PlatformConnectionStatus.HEALTHY,
        capabilities: T3_CAPABILITIES,
        versionInfo: { apiVersion: '1.0.0', versionDrift: false },
      }),
      fetchEntities: jest.fn().mockResolvedValue({
        type: PlatformType.T3,
        data: {
          workspaces: [{ id: 'ws-1', name: 'Continuum Backend' }],
          threads: [
            {
              id: 'th-1',
              title: 'PostgreSQL Migration Verification',
              status: 'ACTIVE',
              url: 'https://t3.test/threads/th-1',
            },
          ],
          runs: [
            {
              id: 'run-1',
              threadId: 'th-1',
              status: 'RUNNING',
              url: 'https://t3.test/runs/run-1',
            },
          ],
        },
      }),
      fetchEntity: jest.fn().mockResolvedValue({
        found: true,
        accessible: true,
        entityType: ExternalEntityType.THREAD,
        id: 'th-1',
        title: 'PostgreSQL Migration Verification',
        url: 'https://t3.test/threads/th-1',
      }),
    } as unknown as T3Adapter;

    service = new PlatformsService(
      database.getRepository(PlatformConnection),
      database.getRepository(ExternalLink),
      memberRepo,
      goalRepo,
      paperclipAdapter,
      t3Adapter,
    );
  });

  afterAll(async () => {
    if (!database?.isInitialized) return;
    try {
      if (projectIds.length) {
        await database.getRepository(ExternalLink).delete({ projectId: In(projectIds) });
        await database.getRepository(PlatformConnection).delete({ projectId: In(projectIds) });
        await database.getRepository(Goal).delete({ projectId: In(projectIds) });
        await database.getRepository(ProjectMember).delete({ projectId: In(projectIds) });
        await database.getRepository(Project).delete({ id: In(projectIds) });
      }
      if (userIds.length) {
        await database.getRepository(ExternalLink).delete({ userId: In(userIds) });
        await database.getRepository(PlatformConnection).delete({ userId: In(userIds) });
        await database.getRepository(User).delete({ id: In(userIds) });
      }
    } finally {
      await database.destroy();
    }
  });

  it('persists a project-scoped platform connection in PostgreSQL', async () => {
    const conn = await service.createConnection(userA.id, {
      name: 'Alpha Paperclip Prod',
      platformType: PlatformType.PAPERCLIP,
      baseUrl: 'https://paperclip.internal',
      authType: PlatformAuthType.BEARER,
      authToken: 'secret-token-postgres-1234',
      projectId: projectA.id,
    });

    expect(conn.id).toBeDefined();
    expect(conn.status).toBe(PlatformConnectionStatus.HEALTHY);
    expect(conn.authToken).toBe('[configured]');

    // Verify row in database
    const row = await database
      .getRepository(PlatformConnection)
      .findOne({ where: { id: conn.id } });
    expect(row).toBeDefined();
    expect(row!.name).toBe('Alpha Paperclip Prod');
    expect(row!.authToken).toBe('secret-token-postgres-1234');
    expect(row!.projectId).toBe(projectA.id);
  });

  it('persists and retrieves external links mapped to Continuum goals', async () => {
    const conn = await service.createConnection(userA.id, {
      name: 'Alpha T3 Dev',
      platformType: PlatformType.T3,
      baseUrl: 'http://localhost:3100',
      authType: PlatformAuthType.BEARER,
      projectId: projectA.id,
    });

    const link = await service.createExternalLink(userA.id, {
      connectionId: conn.id,
      externalEntityType: ExternalEntityType.THREAD,
      externalId: 'th-1',
      externalTitle: 'Verify PostgreSQL schema',
      externalUrl: 'https://paperclip.test/issues/iss-1',
      projectId: projectA.id,
      goalId: goalA.id,
    });

    expect(link.id).toBeDefined();

    const { items } = await service.listExternalLinks(userA.id, {
      projectId: projectA.id,
      goalId: goalA.id,
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.externalId).toBe('th-1');
    expect(items[0]!.goalId).toBe(goalA.id);
  });

  it('enforces access isolation between projects in PostgreSQL', async () => {
    // User B should not see Project A's connections
    const { items } = await service.listConnections(userB.id, { projectId: projectB.id });
    const hasAlphaConn = items.some((c) => c.projectId === projectA.id);
    expect(hasAlphaConn).toBe(false);
  });

  it('answers "what is happening in Paperclip and T3" with persisted data and links', async () => {
    const overview = await service.getPlatformOverview(userA.id, projectA.id);

    expect(overview.totalPlatforms).toBeGreaterThanOrEqual(2);
    expect(overview.paperclip.connected).toBe(true);
    expect(overview.t3.connected).toBe(true);
    expect(overview.oscarAnswer).toContain('connections provided a verified read-only snapshot');
    expect(overview.paperclip.issues[0]!.nativeUrl).toContain('issues');
  });
});
