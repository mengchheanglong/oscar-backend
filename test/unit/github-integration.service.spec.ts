import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Project } from '../../src/modules/projects/entities/project.entity';
import { AuditService } from '../../src/modules/audit/audit.service';
import { IngestionService } from '../../src/modules/ingestion/ingestion.service';
import { KnowledgeSourceType } from '../../src/modules/ingestion/entities/knowledge-source.entity';
import { GitHubRateLimitError } from '../../src/modules/integrations/github/client/github-client.interface';
import { MockGitHubClientService } from '../../src/modules/integrations/github/client/mock-github-client.service';
import {
  GitHubConnection,
  GitHubConnectionStatus,
  GitHubIssue,
  GitHubPullRequest,
  GitHubRepoFile,
} from '../../src/modules/integrations/github/entities';
import { GitHubIntegrationService } from '../../src/modules/integrations/github/github-integration.service';

describe('GitHubIntegrationService', () => {
  let service: GitHubIntegrationService;
  let connectionRepo: jest.Mocked<Repository<GitHubConnection>>;
  let issueRepo: jest.Mocked<Repository<GitHubIssue>>;
  let prRepo: jest.Mocked<Repository<GitHubPullRequest>>;
  let fileRepo: jest.Mocked<Repository<GitHubRepoFile>>;
  let projectRepo: jest.Mocked<Repository<Project>>;
  let githubClient: MockGitHubClientService;
  let ingestionService: jest.Mocked<IngestionService>;
  let auditService: jest.Mocked<AuditService>;

  const projectId = 'proj-123';
  const actorId = 'user-456';
  const mockProject = { id: projectId, name: 'AI Workspace' } as Project;

  beforeEach(() => {
    connectionRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((dto) => ({ id: 'conn-1', ...dto })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve({ id: 'conn-1', ...entity })),
      count: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<Repository<GitHubConnection>>;

    issueRepo = {
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((dto) => ({ id: 'issue-uuid-1', ...dto })),
      save: jest
        .fn()
        .mockImplementation((entity) => Promise.resolve({ id: 'issue-uuid-1', ...entity })),
      count: jest.fn().mockResolvedValue(5),
      createQueryBuilder: jest.fn(),
    } as unknown as jest.Mocked<Repository<GitHubIssue>>;

    prRepo = {
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((dto) => ({ id: 'pr-uuid-1', ...dto })),
      save: jest
        .fn()
        .mockImplementation((entity) => Promise.resolve({ id: 'pr-uuid-1', ...entity })),
      count: jest.fn().mockResolvedValue(3),
      createQueryBuilder: jest.fn(),
    } as unknown as jest.Mocked<Repository<GitHubPullRequest>>;

    fileRepo = {
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((dto) => ({ id: 'file-uuid-1', ...dto })),
      save: jest
        .fn()
        .mockImplementation((entity) => Promise.resolve({ id: 'file-uuid-1', ...entity })),
      count: jest.fn().mockResolvedValue(10),
      createQueryBuilder: jest.fn(),
    } as unknown as jest.Mocked<Repository<GitHubRepoFile>>;

    projectRepo = {
      findOne: jest.fn().mockResolvedValue(mockProject),
    } as unknown as jest.Mocked<Repository<Project>>;

    githubClient = new MockGitHubClientService();

    ingestionService = {
      syncGitHubIssue: jest.fn().mockResolvedValue(null),
      syncGitHubPullRequest: jest.fn().mockResolvedValue(null),
      syncGitHubCodeFile: jest.fn().mockResolvedValue({ status: 'INDEXED' }),
      isSourceIndexed: jest.fn().mockResolvedValue(true),
      deactivateSourcesByType: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<IngestionService>;

    auditService = {
      record: jest.fn().mockResolvedValue({} as never),
    } as unknown as jest.Mocked<AuditService>;

    service = new GitHubIntegrationService(
      connectionRepo,
      issueRepo,
      prRepo,
      fileRepo,
      projectRepo,
      githubClient,
      ingestionService,
      auditService,
    );
  });

  describe('getConnection', () => {
    it('returns null when no connection exists', async () => {
      connectionRepo.findOne.mockResolvedValue(null);

      const result = await service.getConnection(projectId);
      expect(result).toBeNull();
      expect(projectRepo.findOne).toHaveBeenCalledWith({ where: { id: projectId } });
    });

    it('returns connection details with issue count', async () => {
      const mockConn = {
        id: 'conn-1',
        projectId,
        repositoryOwner: 'acme',
        repositoryName: 'workspace',
        repositoryId: '12345',
        status: GitHubConnectionStatus.CONNECTED,
        lastSyncedAt: new Date('2026-09-17T10:00:00Z'),
        errorSummary: null,
        createdAt: new Date('2026-09-17T09:00:00Z'),
        updatedAt: new Date('2026-09-17T10:00:00Z'),
      } as GitHubConnection;

      connectionRepo.findOne.mockResolvedValue(mockConn);
      issueRepo.count.mockResolvedValue(5);

      const result = await service.getConnection(projectId);
      expect(result).not.toBeNull();
      expect(result?.repositoryOwner).toBe('acme');
      expect(result?.repositoryName).toBe('workspace');
      expect(result?.issueCount).toBe(5);
    });

    it('throws NotFoundException if project does not exist', async () => {
      projectRepo.findOne.mockResolvedValue(null);

      await expect(service.getConnection('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('connectRepository', () => {
    it('connects repository, saves connection, audits, and triggers sync', async () => {
      const savedConn = {
        id: 'conn-1',
        projectId,
        repositoryOwner: 'org',
        repositoryName: 'repo',
        status: GitHubConnectionStatus.CONNECTED,
        lastSyncedAt: new Date(),
        errorSummary: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as GitHubConnection;

      connectionRepo.findOne.mockResolvedValueOnce(null).mockResolvedValue(savedConn);

      const result = await service.connectRepository(projectId, actorId, {
        repositoryOwner: 'org',
        repositoryName: 'repo',
      });

      expect(connectionRepo.save).toHaveBeenCalled();
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId,
          actorId,
          action: 'GITHUB_CONNECTED',
        }),
      );
      expect(ingestionService.syncGitHubIssue).toHaveBeenCalled();
      expect(result.status).toBe(GitHubConnectionStatus.CONNECTED);
    });

    it('throws BadRequestException if repository verification fails', async () => {
      await expect(
        service.connectRepository(projectId, actorId, {
          repositoryOwner: 'invalid',
          repositoryName: 'not-found',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('syncIssues', () => {
    it('fetches issues from client, upserts, and indexes into knowledge sources', async () => {
      const mockConn = {
        id: 'conn-1',
        projectId,
        repositoryOwner: 'org',
        repositoryName: 'repo',
        status: GitHubConnectionStatus.CONNECTED,
        syncCursor: null,
      } as GitHubConnection;

      connectionRepo.findOne.mockResolvedValue(mockConn);

      const result = await service.syncIssues(projectId, actorId);

      expect(result.syncedCount).toBeGreaterThan(0);
      expect(ingestionService.syncGitHubIssue).toHaveBeenCalledTimes(result.syncedCount);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId,
          actorId,
          action: 'GITHUB_SYNCED',
        }),
      );
    });

    it('throws BadRequestException if connection is disconnected', async () => {
      const mockConn = {
        id: 'conn-1',
        projectId,
        status: GitHubConnectionStatus.DISCONNECTED,
      } as GitHubConnection;

      connectionRepo.findOne.mockResolvedValue(mockConn);

      await expect(service.syncIssues(projectId, actorId)).rejects.toThrow(BadRequestException);
    });
  });

  describe('disconnect', () => {
    it('marks connection disconnected and deactivates knowledge sources', async () => {
      const mockConn = {
        id: 'conn-1',
        projectId,
        repositoryOwner: 'org',
        repositoryName: 'repo',
        status: GitHubConnectionStatus.CONNECTED,
      } as GitHubConnection;

      connectionRepo.findOne.mockResolvedValue(mockConn);

      await service.disconnect(projectId, actorId);

      expect(mockConn.status).toBe(GitHubConnectionStatus.DISCONNECTED);
      expect(connectionRepo.save).toHaveBeenCalledWith(mockConn);
      expect(ingestionService.deactivateSourcesByType).toHaveBeenCalledWith(
        projectId,
        KnowledgeSourceType.GITHUB_ISSUE,
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId,
          actorId,
          action: 'GITHUB_DISCONNECTED',
        }),
      );
    });
  });

  describe('listIssues', () => {
    it('queries issues with pagination and filters', async () => {
      const mockIssues = [
        {
          id: 'iss-1',
          projectId,
          connectionId: 'conn-1',
          issueNumber: 1,
          title: 'Issue 1',
          body: 'Body text',
          state: 'open',
          htmlUrl: 'https://github.com/org/repo/issues/1',
          authorLogin: 'alice',
          labels: ['bug'],
          githubCreatedAt: new Date(),
          githubUpdatedAt: new Date(),
          syncedAt: new Date(),
        },
      ] as GitHubIssue[];

      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([mockIssues, 1]),
      };

      issueRepo.createQueryBuilder.mockReturnValue(mockQb as never);

      const result = await service.listIssues(projectId, {
        page: 1,
        limit: 10,
        state: 'open',
        q: 'Issue',
      });

      expect(result.total).toBe(1);
      expect(result.items.length).toBe(1);
      expect(result.items[0]?.title).toBe('Issue 1');
      expect(mockQb.andWhere).toHaveBeenCalled();
    });
  });

  describe('listConnections', () => {
    it('returns all connected repositories for the project', async () => {
      const mockConns = [
        {
          id: 'conn-1',
          projectId,
          repositoryOwner: 'org',
          repositoryName: 'backend',
          status: GitHubConnectionStatus.CONNECTED,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'conn-2',
          projectId,
          repositoryOwner: 'org',
          repositoryName: 'frontend',
          status: GitHubConnectionStatus.CONNECTED,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as GitHubConnection[];

      connectionRepo.find.mockResolvedValue(mockConns);

      const result = await service.listConnections(projectId);
      expect(result.length).toBe(2);
      expect(result[0]?.repositoryName).toBe('backend');
      expect(result[1]?.repositoryName).toBe('frontend');
    });
  });

  describe('syncCodebase', () => {
    it('indexes filtered source files into KnowledgeSource GITHUB_CODE', async () => {
      const mockConn = {
        id: 'conn-1',
        projectId,
        repositoryOwner: 'org',
        repositoryName: 'repo',
        status: GitHubConnectionStatus.CONNECTED,
        updatedAt: new Date(),
      } as GitHubConnection;

      connectionRepo.findOne.mockResolvedValue(mockConn);
      fileRepo.findOne.mockResolvedValue(null);

      const result = await service.syncCodebase(projectId, actorId, 'conn-1');

      expect(result.indexedFilesCount).toBeGreaterThan(0);
      expect(ingestionService.syncGitHubCodeFile).toHaveBeenCalled();
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'GITHUB_CODE_INDEXED',
        }),
      );
    });
  });

  describe('complete codebase indexing', () => {
    beforeEach(() => {
      connectionRepo.findOne.mockResolvedValue({
        id: 'conn-1',
        projectId,
        repositoryOwner: 'org',
        repositoryName: 'repo',
        status: GitHubConnectionStatus.CONNECTED,
      } as GitHubConnection);
      fileRepo.findOne.mockResolvedValue(null);
    });
    const entries = Array.from({ length: 35 }, (_, i) => ({
      path: `src/file-${i}.ts`,
      type: 'blob' as const,
      mode: '100644',
      sha: `sha-${i}`,
      size: 20,
      url: '',
    }));
    function mockContents() {
      jest.spyOn(githubClient, 'fetchRepositoryTree').mockResolvedValue(entries);
      return jest
        .spyOn(githubClient, 'fetchFileContent')
        .mockImplementation(async (_owner, _repo, path) => ({
          path,
          sha: entries.find((e) => e.path === path)!.sha,
          size: 20,
          content: 'export const value = 1;',
          html_url: 'https://github.com/org/repo/' + path,
        }));
    }
    it('indexes all 35 eligible files rather than the first 30', async () => {
      const fetchFile = mockContents();
      const result = await service.syncCodebase(projectId, actorId, 'conn-1');
      expect(result.indexedFilesCount).toBe(35);
      expect(result.candidateFilesCount).toBe(35);
      expect(fetchFile).toHaveBeenCalledTimes(35);
    });
    it('continues short batches until every eligible file is indexed exactly once', async () => {
      const fetchFile = mockContents();
      let cursor = 0;
      let treeVersion: string | undefined;
      let indexed = 0;
      do {
        const result = await service.syncCodebase(projectId, actorId, 'conn-1', undefined, {
          cursor,
          batchSize: 5,
          treeVersion,
        });
        indexed += result.indexedFilesCount;
        treeVersion = result.treeVersion;
        expect(result.candidateFilesCount).toBe(35);
        if (result.nextCursor === null) break;
        cursor = result.nextCursor;
      } while (cursor < 35);
      expect(indexed).toBe(35);
      expect(new Set(fetchFile.mock.calls.map((call) => call[2])).size).toBe(35);
      expect(fetchFile).toHaveBeenCalledTimes(35);
    });
    it('rejects continuation when the repository manifest changes', async () => {
      const fetchFile = mockContents();
      await expect(
        service.syncCodebase(projectId, actorId, 'conn-1', undefined, {
          cursor: 2,
          batchSize: 2,
          treeVersion: '0'.repeat(64),
        }),
      ).rejects.toThrow('Repository changed during indexing');
      expect(fetchFile).not.toHaveBeenCalled();
    });
    it('skips unchanged files only when their source is indexed', async () => {
      const fetchFile = mockContents();
      fileRepo.findOne.mockResolvedValueOnce({ id: 'file-0', sha: 'sha-0' } as GitHubRepoFile);
      const result = await service.syncCodebase(projectId, actorId, 'conn-1');
      expect(result.unchangedFilesCount).toBe(1);
      expect(result.indexedFilesCount).toBe(34);
      expect(fetchFile).toHaveBeenCalledTimes(34);
      expect(ingestionService.isSourceIndexed).toHaveBeenCalledWith(
        projectId,
        KnowledgeSourceType.GITHUB_CODE,
        'file-0',
      );
    });
    it('retries matching-SHA files whose prior indexing failed', async () => {
      const fetchFile = mockContents();
      fileRepo.findOne.mockResolvedValueOnce({ id: 'file-0', sha: 'sha-0' } as GitHubRepoFile);
      ingestionService.isSourceIndexed.mockResolvedValue(false);
      const result = await service.syncCodebase(projectId, actorId, 'conn-1');
      expect(result.indexedFilesCount).toBe(35);
      expect(fetchFile).toHaveBeenCalledTimes(35);
    });
    it('reports failed ingestion and leaves its SHA unacknowledged for retry', async () => {
      mockContents();
      ingestionService.syncGitHubCodeFile.mockRejectedValueOnce(new Error('ingestion failed'));
      await expect(service.syncCodebase(projectId, actorId, 'conn-1')).rejects.toThrow(
        'Indexing incomplete',
      );
      expect(fileRepo.save.mock.calls[0]?.[0]).toMatchObject({ sha: '' });
    });
    it('stops on rate limiting and reports resumable incomplete coverage', async () => {
      const fetchFile = mockContents();
      fetchFile.mockRejectedValueOnce(new GitHubRateLimitError('rate limit'));
      await expect(service.syncCodebase(projectId, actorId, 'conn-1')).rejects.toThrow(
        'GitHub rate limit reached',
      );
      expect(fetchFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('listPullRequests', () => {
    it('queries pull requests with pagination and filters', async () => {
      const mockPrs = [
        {
          id: 'pr-1',
          projectId,
          connectionId: 'conn-1',
          prNumber: 10,
          title: 'PR 10',
          body: 'PR Body',
          state: 'open',
          htmlUrl: 'https://github.com/org/repo/pull/10',
          authorLogin: 'alice',
          baseBranch: 'main',
          headBranch: 'feat/test',
          isMerged: false,
          labels: ['backend'],
          githubCreatedAt: new Date(),
          githubUpdatedAt: new Date(),
          syncedAt: new Date(),
        },
      ] as GitHubPullRequest[];

      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([mockPrs, 1]),
      };

      prRepo.createQueryBuilder.mockReturnValue(mockQb as never);

      const result = await service.listPullRequests(projectId, {
        page: 1,
        limit: 10,
        state: 'open',
      });

      expect(result.total).toBe(1);
      expect(result.items[0]?.prNumber).toBe(10);
    });
  });

  describe('listFiles', () => {
    it('queries indexed repo files with filters', async () => {
      const mockFiles = [
        {
          id: 'file-1',
          projectId,
          connectionId: 'conn-1',
          path: 'src/main.ts',
          fileName: 'main.ts',
          extension: 'ts',
          size: 200,
          htmlUrl: 'https://github.com/org/repo/blob/main/src/main.ts',
          syncedAt: new Date(),
        },
      ] as GitHubRepoFile[];

      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([mockFiles, 1]),
      };

      fileRepo.createQueryBuilder.mockReturnValue(mockQb as never);

      const result = await service.listFiles(projectId, {
        page: 1,
        limit: 10,
        extension: 'ts',
      });

      expect(result.total).toBe(1);
      expect(result.items[0]?.path).toBe('src/main.ts');
    });
  });
});
