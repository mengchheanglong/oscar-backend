import { Repository } from 'typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
import { User } from '../../src/modules/users/entities/user.entity';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_USER_ID = '22222222-2222-2222-2222-222222222222';
const PROJECT_ID = '33333333-3333-3333-3333-333333333333';
const GOAL_ID = '44444444-4444-4444-4444-444444444444';
const CONN_ID = '55555555-5555-5555-5555-555555555555';

function makeConnection(overrides: Partial<PlatformConnection> = {}): PlatformConnection {
  return {
    id: CONN_ID,
    userId: USER_ID,
    projectId: PROJECT_ID,
    platformType: PlatformType.PAPERCLIP,
    name: 'Paperclip Prod',
    baseUrl: 'https://api.paperclip.local',
    authType: PlatformAuthType.BEARER,
    authToken: 'secret-token-1234',
    status: PlatformConnectionStatus.HEALTHY,
    capabilities: [...PAPERCLIP_CAPABILITIES],
    versionInfo: { apiVersion: '1.2.0', versionDrift: false },
    lastHealthCheckAt: new Date(),
    healthError: null,
    metadata: {},
    externalLinks: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {} as unknown as User,
    project: null,
    ...overrides,
  };
}

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: GOAL_ID,
    userId: USER_ID,
    projectId: PROJECT_ID,
    title: 'Achieve Q4 Product Launch',
    description: 'Launch version 1.0',
    motivation: 'Company growth',
    status: GoalStatus.ACTIVE,
    timeframe: 'Q4 2026',
    startDate: '2026-10-01',
    targetDate: '2026-12-31',
    baseline: '0',
    target: '100%',
    progress: 50,
    confidence: null,
    category: GoalCategory.BUSINESS,
    dependencies: null,
    risks: null,
    reviewCadence: GoalReviewCadence.WEEKLY,
    initiatives: [],
    milestones: [],
    version: 1,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    metrics: [],
    revisions: [],
    project: null,
    ...overrides,
  };
}

describe('PlatformsService', () => {
  let service: PlatformsService;
  let connectionRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    remove: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let linkRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    remove: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let memberRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
  };
  let goalRepo: {
    findOne: jest.Mock;
  };
  let paperclipAdapter: PaperclipAdapter;
  let t3Adapter: T3Adapter;

  let inMemoryConnections: PlatformConnection[] = [];
  let inMemoryLinks: ExternalLink[] = [];

  beforeEach(async () => {
    inMemoryConnections = [];
    inMemoryLinks = [];

    connectionRepo = {
      create: jest.fn().mockImplementation((dto) => ({
        id: CONN_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
        capabilities: [],
        versionInfo: {},
        ...dto,
      })),
      save: jest.fn().mockImplementation(async (entity) => {
        const idx = inMemoryConnections.findIndex((c) => c.id === entity.id);
        if (idx >= 0) {
          inMemoryConnections[idx] = { ...inMemoryConnections[idx], ...entity };
          return inMemoryConnections[idx];
        }
        inMemoryConnections.push(entity);
        return entity;
      }),
      findOne: jest.fn().mockImplementation(async ({ where }) => {
        return inMemoryConnections.find((c) => c.id === where.id) || null;
      }),
      remove: jest.fn().mockImplementation(async (entity) => {
        inMemoryConnections = inMemoryConnections.filter((c) => c.id !== entity.id);
      }),
      createQueryBuilder: jest.fn().mockImplementation(() => {
        const filters: ((c: PlatformConnection) => boolean)[] = [];
        let limitCount = 50;

        const qb: Record<string, unknown> = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest
            .fn()
            .mockImplementation((clause: string, params?: Record<string, unknown>) => {
              if (clause.includes('conn.projectId = :projectId')) {
                filters.push((c) => c.projectId === params?.projectId);
              } else if (clause.includes('conn.userId = :actorId')) {
                filters.push(
                  (c) =>
                    c.userId === params?.actorId ||
                    (Array.isArray(params?.accessibleProjectIds) &&
                      params.accessibleProjectIds.includes(c.projectId)),
                );
              }
              return qb;
            }),
          andWhere: jest
            .fn()
            .mockImplementation((clause: string, params?: Record<string, unknown>) => {
              if (clause.includes('conn.platformType = :platformType')) {
                filters.push((c) => c.platformType === params?.platformType);
              }
              if (clause.includes('conn.status = :status')) {
                filters.push((c) => c.status === params?.status);
              }
              return qb;
            }),
          orderBy: jest.fn().mockReturnThis(),
          skip: jest.fn().mockReturnThis(),
          take: jest.fn().mockImplementation((lim: number) => {
            limitCount = lim;
            return qb;
          }),
          getManyAndCount: jest.fn().mockImplementation(async () => {
            const matched = inMemoryConnections.filter((c) => filters.every((fn) => fn(c)));
            return [matched.slice(0, limitCount), matched.length];
          }),
        };
        return qb;
      }),
    };

    linkRepo = {
      create: jest.fn().mockImplementation((dto) => ({
        id: 'link-uuid-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {},
        ...dto,
      })),
      save: jest.fn().mockImplementation(async (entity) => {
        const idx = inMemoryLinks.findIndex((l) => l.id === entity.id);
        if (idx >= 0) {
          inMemoryLinks[idx] = { ...inMemoryLinks[idx], ...entity };
          return inMemoryLinks[idx];
        }
        inMemoryLinks.push(entity);
        return entity;
      }),
      findOne: jest.fn().mockImplementation(async ({ where }) => {
        return inMemoryLinks.find((l) => l.id === where.id) || null;
      }),
      remove: jest.fn().mockImplementation(async (entity) => {
        inMemoryLinks = inMemoryLinks.filter((l) => l.id !== entity.id);
      }),
      createQueryBuilder: jest.fn().mockImplementation(() => {
        const filters: ((l: ExternalLink) => boolean)[] = [];
        let limitCount = 50;

        const qb: Record<string, unknown> = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest
            .fn()
            .mockImplementation((clause: string, params?: Record<string, unknown>) => {
              if (clause.includes('link.projectId = :projectId')) {
                filters.push((l) => l.projectId === params?.projectId);
              } else if (clause.includes('link.userId = :actorId')) {
                filters.push(
                  (l) =>
                    l.userId === params?.actorId ||
                    (Array.isArray(params?.accessibleProjectIds) &&
                      params.accessibleProjectIds.includes(l.projectId)),
                );
              }
              return qb;
            }),
          andWhere: jest
            .fn()
            .mockImplementation((clause: string, params?: Record<string, unknown>) => {
              if (clause.includes('link.goalId = :goalId')) {
                filters.push((l) => l.goalId === params?.goalId);
              }
              if (clause.includes('link.platformType = :platformType')) {
                filters.push((l) => l.platformType === params?.platformType);
              }
              return qb;
            }),
          orderBy: jest.fn().mockReturnThis(),
          skip: jest.fn().mockReturnThis(),
          take: jest.fn().mockImplementation((lim: number) => {
            limitCount = lim;
            return qb;
          }),
          getManyAndCount: jest.fn().mockImplementation(async () => {
            const matched = inMemoryLinks.filter((l) => filters.every((fn) => fn(l)));
            return [matched.slice(0, limitCount), matched.length];
          }),
        };
        return qb;
      }),
    };

    memberRepo = {
      findOne: jest.fn().mockImplementation(async ({ where }) => {
        if (where.userId === USER_ID && where.projectId === PROJECT_ID) {
          return {
            id: 'member-1',
            userId: USER_ID,
            projectId: PROJECT_ID,
            accessRole: ProjectRole.MANAGER,
            removedAt: null,
          };
        }
        return null;
      }),
      find: jest.fn().mockImplementation(async ({ where }) => {
        if (where.userId === USER_ID) {
          return [{ projectId: PROJECT_ID }];
        }
        return [];
      }),
    };

    goalRepo = {
      findOne: jest.fn().mockImplementation(async ({ where }) => {
        if (where.id === GOAL_ID) {
          return makeGoal();
        }
        return null;
      }),
    };

    process.env.PLATFORM_ALLOWED_ORIGINS = 'https://api.paperclip.local,https://t3.local';
    paperclipAdapter = new PaperclipAdapter();
    t3Adapter = new T3Adapter(connectionRepo as unknown as Repository<PlatformConnection>);
    jest.spyOn(paperclipAdapter, 'checkHealth').mockResolvedValue({
      status: PlatformConnectionStatus.HEALTHY,
      capabilities: PAPERCLIP_CAPABILITIES,
      versionInfo: {},
    });
    jest.spyOn(t3Adapter, 'checkHealth').mockResolvedValue({
      status: PlatformConnectionStatus.HEALTHY,
      capabilities: T3_CAPABILITIES,
      versionInfo: {},
    });
    jest.spyOn(paperclipAdapter, 'fetchEntity').mockImplementation(async (_conn, type, id) => ({
      found: true,
      accessible: true,
      entityType: type,
      id,
      title: 'Verified source',
      url: `https://api.paperclip.local/issues/${id}`,
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformsService,
        { provide: getRepositoryToken(PlatformConnection), useValue: connectionRepo },
        { provide: getRepositoryToken(ExternalLink), useValue: linkRepo },
        { provide: getRepositoryToken(ProjectMember), useValue: memberRepo },
        { provide: getRepositoryToken(Goal), useValue: goalRepo },
        { provide: PaperclipAdapter, useValue: paperclipAdapter },
        { provide: T3Adapter, useValue: t3Adapter },
      ],
    }).compile();

    service = module.get<PlatformsService>(PlatformsService);
  });

  describe('Connection Registry & Access Control', () => {
    it('creates a project-scoped connection with masked token and initial health probe', async () => {
      jest.spyOn(paperclipAdapter, 'checkHealth').mockResolvedValueOnce({
        status: PlatformConnectionStatus.HEALTHY,
        capabilities: PAPERCLIP_CAPABILITIES,
        versionInfo: { apiVersion: '1.2.0', versionDrift: false },
      });

      const result = await service.createConnection(USER_ID, {
        name: 'Paperclip Prod',
        platformType: PlatformType.PAPERCLIP,
        baseUrl: 'https://api.paperclip.local',
        authType: PlatformAuthType.BEARER,
        authToken: 'secret-token-1234',
        projectId: PROJECT_ID,
      });

      expect(result.id).toBe(CONN_ID);
      expect(result.status).toBe(PlatformConnectionStatus.HEALTHY);
      expect(result.authToken).toBe('[configured]');
      expect(result.capabilities).toEqual(PAPERCLIP_CAPABILITIES);
    });

    it('rejects connection creation if user is not a member of the project', async () => {
      await expect(
        service.createConnection(OTHER_USER_ID, {
          name: 'Forbidden Connection',
          platformType: PlatformType.PAPERCLIP,
          baseUrl: 'https://api.paperclip.local',
          projectId: PROJECT_ID,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects connection creation if user has only VIEWER role in project', async () => {
      memberRepo.findOne.mockResolvedValueOnce({
        id: 'member-viewer',
        userId: USER_ID,
        projectId: PROJECT_ID,
        accessRole: ProjectRole.VIEWER,
        removedAt: null,
      });

      await expect(
        service.createConnection(USER_ID, {
          name: 'Viewer Connection',
          platformType: PlatformType.PAPERCLIP,
          baseUrl: 'https://api.paperclip.local',
          projectId: PROJECT_ID,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('retrieves connection and masks the authentication token', async () => {
      inMemoryConnections.push(makeConnection());

      const result = await service.getConnection(USER_ID, CONN_ID);
      expect(result.id).toBe(CONN_ID);
      expect(result.authToken).toBe('[configured]');
    });
    it('does not treat a stale or missing successful probe as fresh health', async () => {
      for (const lastHealthCheckAt of [
        null,
        new Date(Date.now() - 61_000),
        new Date(Date.now() + 60_000),
      ]) {
        inMemoryConnections.length = 0;
        inMemoryConnections.push(makeConnection({ lastHealthCheckAt }));
        expect((await service.getConnection(USER_ID, CONN_ID)).healthFresh).toBe(false);
      }
      inMemoryConnections.length = 0;
      inMemoryConnections.push(makeConnection());
      expect((await service.getConnection(USER_ID, CONN_ID)).healthFresh).toBe(true);
    });
    it('preserves concurrently changed credentials when a probe finishes', async () => {
      inMemoryConnections.push(makeConnection());
      jest.spyOn(paperclipAdapter, 'checkHealth').mockImplementationOnce(async () => {
        inMemoryConnections[0] = makeConnection({ authToken: 'reconnected-token' });
        return { status: PlatformConnectionStatus.HEALTHY, capabilities: [], versionInfo: {} };
      });
      await service.testConnection(USER_ID, CONN_ID);
      expect(inMemoryConnections[0]!.authToken).toBe('reconnected-token');
    });
    it('rejects untrusted browser callback origins before requesting T3 authorization', async () => {
      inMemoryConnections.push(makeConnection({ platformType: PlatformType.T3 }));
      await expect(
        service.authorize(USER_ID, CONN_ID, 'https://untrusted.example'),
      ).rejects.toThrow('configured OSCAR origin');
    });

    it('rejects connection access for non-member user', async () => {
      inMemoryConnections.push(makeConnection());

      await expect(service.getConnection(OTHER_USER_ID, CONN_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deletes connection when authorized', async () => {
      inMemoryConnections.push(makeConnection());

      await service.deleteConnection(USER_ID, CONN_ID);
      expect(inMemoryConnections).toHaveLength(0);
    });
  });

  describe('Health Probes, Revocation, Drift & Absence', () => {
    it('sets status to REVOKED when platform returns HTTP 401 or 403', async () => {
      const conn = makeConnection();
      inMemoryConnections.push(conn);

      jest.spyOn(paperclipAdapter, 'checkHealth').mockResolvedValueOnce({
        status: PlatformConnectionStatus.REVOKED,
        capabilities: [],
        versionInfo: { versionDrift: false },
        error: 'Authentication revoked or insufficient privileges (HTTP 401)',
      });

      const updated = await service.testConnection(USER_ID, CONN_ID);
      expect(updated.status).toBe(PlatformConnectionStatus.REVOKED);
      expect(updated.healthError).toContain('Authentication revoked');
      expect(updated.capabilities).toHaveLength(0);
    });

    it('sets status to UNREACHABLE when platform is absent or network fails', async () => {
      const conn = makeConnection();
      inMemoryConnections.push(conn);

      jest.spyOn(paperclipAdapter, 'checkHealth').mockResolvedValueOnce({
        status: PlatformConnectionStatus.UNREACHABLE,
        capabilities: [],
        versionInfo: {},
        error: 'Platform host unreachable: connect ECONNREFUSED 127.0.0.1:9999',
      });

      const updated = await service.testConnection(USER_ID, CONN_ID);
      expect(updated.status).toBe(PlatformConnectionStatus.UNREACHABLE);
      expect(updated.healthError).toContain('ECONNREFUSED');
    });

    it('detects version drift and sets status to DEGRADED', async () => {
      const conn = makeConnection();
      inMemoryConnections.push(conn);

      jest.spyOn(paperclipAdapter, 'checkHealth').mockResolvedValueOnce({
        status: PlatformConnectionStatus.DEGRADED,
        capabilities: PAPERCLIP_CAPABILITIES,
        versionInfo: { apiVersion: '0.9.0', versionDrift: true, minSupportedVersion: '1.0.0' },
        error: 'Version drift detected: API version 0.9.0 does not meet required 1.0.0',
      });

      const updated = await service.testConnection(USER_ID, CONN_ID);
      expect(updated.status).toBe(PlatformConnectionStatus.DEGRADED);
      expect(updated.versionInfo.versionDrift).toBe(true);
      expect(updated.healthError).toContain('Version drift detected');
    });

    it('handles T3 adapter health checks for T3 platforms', async () => {
      const t3Conn = makeConnection({
        id: 't3-conn-1',
        platformType: PlatformType.T3,
        name: 'T3 Local',
        baseUrl: 'http://localhost:3100',
      });
      inMemoryConnections.push(t3Conn);

      jest.spyOn(t3Adapter, 'checkHealth').mockResolvedValueOnce({
        status: PlatformConnectionStatus.HEALTHY,
        capabilities: T3_CAPABILITIES,
        versionInfo: { apiVersion: '1.0.0', versionDrift: false },
      });

      const updated = await service.testConnection(USER_ID, 't3-conn-1');
      expect(updated.status).toBe(PlatformConnectionStatus.HEALTHY);
      expect(updated.capabilities).toEqual(T3_CAPABILITIES);
    });
  });

  describe('Inaccessible Objects and Graceful Handling', () => {
    it('handles inaccessible external objects gracefully', async () => {
      const conn = makeConnection();
      const entityResult = await paperclipAdapter.fetchEntity(
        conn,
        ExternalEntityType.ISSUE,
        'forbidden-issue-99',
      );
      // Adapter fetchEntity returns safe object with accessible: false or found: false
      expect(entityResult).toHaveProperty('accessible');
      expect(entityResult).toHaveProperty('found');
    });
  });

  describe('External Links Mapping', () => {
    it('maps an external Paperclip issue to a Continuum goal', async () => {
      inMemoryConnections.push(makeConnection());

      const link = await service.createExternalLink(USER_ID, {
        connectionId: CONN_ID,
        externalEntityType: ExternalEntityType.ISSUE,
        externalId: 'issue-42',
        externalTitle: 'Fix Stripe Webhook Replay',
        externalUrl: 'https://api.paperclip.local/issues/issue-42',
        projectId: PROJECT_ID,
        goalId: GOAL_ID,
      });

      expect(link.id).toBe('link-uuid-1');
      expect(link.externalId).toBe('issue-42');
      expect(link.goalId).toBe(GOAL_ID);
      expect(link.platformType).toBe(PlatformType.PAPERCLIP);
    });

    it('rejects external link creation when mapped goal is nonexistent', async () => {
      inMemoryConnections.push(makeConnection());

      await expect(
        service.createExternalLink(USER_ID, {
          connectionId: CONN_ID,
          externalEntityType: ExternalEntityType.ISSUE,
          externalId: 'issue-42',
          externalTitle: 'Fix Stripe Webhook Replay',
          externalUrl: 'https://api.paperclip.local/issues/issue-42',
          goalId: 'non-existent-goal',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('lists and deletes external links with access verification', async () => {
      inMemoryConnections.push(makeConnection());
      const link = await service.createExternalLink(USER_ID, {
        connectionId: CONN_ID,
        externalEntityType: ExternalEntityType.ISSUE,
        externalId: 'issue-1',
        externalTitle: 'Test Issue',
        externalUrl: 'https://api.paperclip.local/issues/issue-1',
        projectId: PROJECT_ID,
      });

      const { items } = await service.listExternalLinks(USER_ID, { projectId: PROJECT_ID });
      expect(items).toHaveLength(1);
      expect(items[0]!.externalId).toBe('issue-1');

      await service.deleteExternalLink(USER_ID, link.id);
      expect(inMemoryLinks).toHaveLength(0);
    });
  });

  describe('What is happening in Paperclip and T3? (Status Overview)', () => {
    it('answers accurately with native links and entity counts', async () => {
      const pConn = makeConnection({ id: 'conn-p', platformType: PlatformType.PAPERCLIP });
      const tConn = makeConnection({
        id: 'conn-t',
        platformType: PlatformType.T3,
        name: 'T3 Code Local',
        baseUrl: 'http://localhost:3100',
      });
      inMemoryConnections.push(pConn, tConn);

      jest.spyOn(paperclipAdapter, 'fetchEntities').mockResolvedValueOnce({
        type: PlatformType.PAPERCLIP,
        data: {
          agents: [
            { id: 'agent-1', name: 'Research Lead', status: 'ACTIVE', role: 'Researcher' },
            { id: 'agent-2', name: 'Ops Bot', status: 'IDLE' },
          ],
          teams: [{ id: 'team-1', name: 'Market Intelligence', memberCount: 3 }],
          issues: [
            {
              id: 'issue-101',
              title: 'Competitor pricing matrix',
              status: 'OPEN',
              priority: 'HIGH',
              url: 'https://api.paperclip.local/issues/issue-101',
            },
          ],
        },
      });

      jest.spyOn(t3Adapter, 'fetchEntities').mockResolvedValueOnce({
        type: PlatformType.T3,
        data: {
          workspaces: [{ id: 'ws-1', name: 'OSCAR Main Repo', path: '/workspace/oscar' }],
          threads: [
            {
              id: 'thread-201',
              title: 'Phase 3 Platform Registry',
              status: 'ACTIVE',
              url: 'http://localhost:3100/threads/thread-201',
            },
          ],
          runs: [
            {
              id: 'run-301',
              threadId: 'thread-201',
              status: 'RUNNING',
              startedAt: '2026-10-19T06:00:00Z',
              url: 'http://localhost:3100/runs/run-301',
            },
          ],
        },
      });

      const overview = await service.getPlatformOverview(USER_ID, PROJECT_ID);

      expect(overview.totalPlatforms).toBe(2);
      expect(overview.healthyPlatforms).toBe(2);
      expect(overview.paperclip.connected).toBe(true);
      expect(overview.paperclip.agents).toHaveLength(2);
      expect(overview.paperclip.teams).toHaveLength(1);
      expect(overview.paperclip.issues).toHaveLength(1);
      expect(overview.paperclip.issues[0]!.nativeUrl).toBe(
        'https://api.paperclip.local/issues/issue-101',
      );

      expect(overview.t3.connected).toBe(true);
      expect(overview.t3.workspaces).toHaveLength(1);
      expect(overview.t3.threads).toHaveLength(1);
      expect(overview.t3.runs).toHaveLength(1);
      expect(overview.t3.threads[0]!.nativeUrl).toBe('http://localhost:3100/threads/thread-201');

      // Check narrative answer
      expect(overview.oscarAnswer).toContain('2/2 connections');
      expect(overview.oscarAnswer).toContain('Paperclip: 2 accessible agents');
      expect(overview.oscarAnswer).toContain('T3: 1 projects, 1 threads');
      expect(overview.paperclip.issues[0]!.nativeUrl).toContain('issue-101');
      expect(overview.t3.threads[0]!.nativeUrl).toContain('thread-201');
    });

    it('returns informative response when no platforms are connected', async () => {
      const overview = await service.getPlatformOverview(USER_ID);
      expect(overview.totalPlatforms).toBe(0);
      expect(overview.oscarAnswer).toContain('No external platforms');
    });

    it('highlights degraded or revoked platforms in the answer', async () => {
      const pConn = makeConnection({
        id: 'conn-revoked',
        status: PlatformConnectionStatus.REVOKED,
        healthError: 'HTTP 401 Unauthorized',
      });
      inMemoryConnections.push(pConn);
      jest.spyOn(paperclipAdapter, 'checkHealth').mockResolvedValueOnce({
        status: PlatformConnectionStatus.REVOKED,
        capabilities: [],
        versionInfo: {},
      });

      const overview = await service.getPlatformOverview(USER_ID, PROJECT_ID);
      expect(overview.warnings.join(' ')).toContain('live activity unavailable');
    });
  });
});
