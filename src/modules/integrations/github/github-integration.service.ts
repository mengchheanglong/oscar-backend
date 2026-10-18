import { createHash } from 'node:crypto';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../../projects/entities/project.entity';
import { AuditService } from '../../audit/audit.service';
import { IngestionService } from '../../ingestion/ingestion.service';
import { KnowledgeSourceType } from '../../ingestion/entities/knowledge-source.entity';
import {
  GITHUB_CLIENT,
  IGitHubClient,
  GitHubRateLimitError,
} from './client/github-client.interface';
import { ConnectGitHubDto } from './dto/connect-github.dto';
import {
  GitHubConnectionResponseDto,
  GitHubIssueResponseDto,
  GitHubPullRequestResponseDto,
  GitHubRepoFileResponseDto,
  SyncCodebaseResponseDto,
  SyncGitHubResponseDto,
} from './dto/github-responses.dto';
import { ListGitHubIssuesQueryDto } from './dto/list-github-issues-query.dto';
import { ListGitHubPullRequestsQueryDto } from './dto/list-github-prs-query.dto';
import { ListGitHubFilesQueryDto } from './dto/list-github-files-query.dto';
import {
  GitHubConnection,
  GitHubConnectionStatus,
  GitHubIssue,
  GitHubPullRequest,
  GitHubRepoFile,
} from './entities';

@Injectable()
export class GitHubIntegrationService {
  private readonly logger = new Logger(GitHubIntegrationService.name);

  // Supported extensions for repository codebase indexing
  private readonly supportedCodeExtensions = new Set([
    'ts',
    'tsx',
    'js',
    'jsx',
    'py',
    'go',
    'rs',
    'java',
    'cpp',
    'c',
    'h',
    'cs',
    'php',
    'rb',
    'swift',
    'kt',
    'sql',
    'md',
    'json',
    'yaml',
    'yml',
    'html',
    'css',
    'prisma',
    'graphql',
  ]);

  constructor(
    @InjectRepository(GitHubConnection)
    private readonly connectionRepo: Repository<GitHubConnection>,
    @InjectRepository(GitHubIssue)
    private readonly issueRepo: Repository<GitHubIssue>,
    @InjectRepository(GitHubPullRequest)
    private readonly prRepo: Repository<GitHubPullRequest>,
    @InjectRepository(GitHubRepoFile)
    private readonly fileRepo: Repository<GitHubRepoFile>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @Inject(GITHUB_CLIENT)
    private readonly githubClient: IGitHubClient,
    private readonly ingestionService: IngestionService,
    private readonly auditService: AuditService,
  ) {}

  async listConnections(projectId: string): Promise<GitHubConnectionResponseDto[]> {
    await this.ensureProjectExists(projectId);

    const connections = await this.connectionRepo.find({
      where: { projectId },
      order: { createdAt: 'ASC' },
    });

    return Promise.all(connections.map((c) => this.mapConnectionDtoWithCounts(c)));
  }

  async getConnection(
    projectId: string,
    connectionId?: string,
  ): Promise<GitHubConnectionResponseDto | null> {
    await this.ensureProjectExists(projectId);

    const where: { projectId: string; id?: string } = { projectId };
    if (connectionId) {
      where.id = connectionId;
    }

    const connection = await this.connectionRepo.findOne({
      where,
      order: { updatedAt: 'DESC' },
    });

    if (!connection) {
      return null;
    }

    return this.mapConnectionDtoWithCounts(connection);
  }

  async connectRepository(
    projectId: string,
    actorId: string,
    dto: ConnectGitHubDto,
  ): Promise<GitHubConnectionResponseDto> {
    await this.ensureProjectExists(projectId);

    // Verify repository with GitHub API (or mock)
    let repoInfo: { id: number; name: string; full_name: string; owner: string };
    try {
      repoInfo = await this.githubClient.verifyRepository(
        dto.repositoryOwner,
        dto.repositoryName,
        dto.accessToken,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException({
        code: 'GITHUB_REPOSITORY_INVALID',
        message: `Failed to verify repository ${dto.repositoryOwner}/${dto.repositoryName}: ${msg}`,
      });
    }

    let connection = await this.connectionRepo.findOne({
      where: {
        projectId,
        repositoryOwner: dto.repositoryOwner,
        repositoryName: dto.repositoryName,
      },
    });

    if (connection) {
      connection.repositoryId = String(repoInfo.id);
      connection.status = GitHubConnectionStatus.CONNECTED;
      connection.errorSummary = null;
      connection.updatedAt = new Date();
      connection = await this.connectionRepo.save(connection);
    } else {
      connection = this.connectionRepo.create({
        projectId,
        repositoryOwner: dto.repositoryOwner,
        repositoryName: dto.repositoryName,
        repositoryId: String(repoInfo.id),
        status: GitHubConnectionStatus.CONNECTED,
        lastSyncedAt: null,
        errorSummary: null,
        syncCursor: null,
      });
      connection = await this.connectionRepo.save(connection);
    }

    await this.auditService.record({
      projectId,
      actorId,
      action: 'GITHUB_CONNECTED',
      entityType: 'GITHUB_CONNECTION',
      entityId: connection.id,
      metadata: {
        repository: `${dto.repositoryOwner}/${dto.repositoryName}`,
      },
    });

    // Trigger initial sync of issues & PRs
    await this.syncRepository(projectId, actorId, connection.id, dto.accessToken);

    return (await this.getConnection(projectId, connection.id))!;
  }

  async syncIssues(
    projectId: string,
    actorId: string,
    accessToken?: string,
    connectionId?: string,
  ): Promise<SyncGitHubResponseDto> {
    return this.syncRepository(projectId, actorId, connectionId, accessToken);
  }

  async syncRepository(
    projectId: string,
    actorId: string,
    connectionId?: string,
    accessToken?: string,
  ): Promise<SyncGitHubResponseDto> {
    await this.ensureProjectExists(projectId);

    const where: { projectId: string; id?: string } = { projectId };
    if (connectionId) {
      where.id = connectionId;
    }

    const connection = await this.connectionRepo.findOne({
      where,
      order: { updatedAt: 'DESC' },
    });

    if (!connection) {
      throw new NotFoundException({
        code: 'GITHUB_CONNECTION_NOT_FOUND',
        message: 'No GitHub connection found for this project',
      });
    }

    if (connection.status === GitHubConnectionStatus.DISCONNECTED) {
      throw new BadRequestException({
        code: 'GITHUB_CONNECTION_DISCONNECTED',
        message: 'Cannot sync a disconnected GitHub repository. Reconnect first.',
      });
    }

    // 1. Fetch Issues
    let fetchResult;
    try {
      fetchResult = await this.githubClient.fetchIssues(
        connection.repositoryOwner,
        connection.repositoryName,
        {
          since: connection.syncCursor ?? undefined,
          state: 'all',
          perPage: 100,
        },
        accessToken,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      connection.status = GitHubConnectionStatus.ERROR;
      connection.errorSummary = msg;
      await this.connectionRepo.save(connection);
      throw new BadRequestException({
        code: 'GITHUB_SYNC_FAILED',
        message: `Failed to fetch issues from GitHub: ${msg}`,
      });
    }

    const { issues } = fetchResult;

    for (const apiIssue of issues) {
      let issue = await this.issueRepo.findOne({
        where: { connectionId: connection.id, issueNumber: apiIssue.number },
      });

      const labelNames = (apiIssue.labels || []).map((l) => (typeof l === 'string' ? l : l.name));

      if (issue) {
        issue.title = apiIssue.title;
        issue.body = apiIssue.body;
        issue.state = apiIssue.state;
        issue.htmlUrl = apiIssue.html_url;
        issue.authorLogin = apiIssue.user?.login ?? null;
        issue.labels = labelNames;
        issue.githubUpdatedAt = new Date(apiIssue.updated_at);
        issue.syncedAt = new Date();
      } else {
        issue = this.issueRepo.create({
          projectId,
          connectionId: connection.id,
          githubIssueId: String(apiIssue.id),
          issueNumber: apiIssue.number,
          title: apiIssue.title,
          body: apiIssue.body,
          state: apiIssue.state,
          htmlUrl: apiIssue.html_url,
          authorLogin: apiIssue.user?.login ?? null,
          labels: labelNames,
          githubCreatedAt: new Date(apiIssue.created_at),
          githubUpdatedAt: new Date(apiIssue.updated_at),
          syncedAt: new Date(),
        });
      }

      issue = await this.issueRepo.save(issue);

      // Fetch issue comments to index discussion thread into vector memory
      let comments: Array<{ authorLogin: string | null; body: string }> = [];
      try {
        const apiComments = await this.githubClient.fetchIssueComments(
          connection.repositoryOwner,
          connection.repositoryName,
          issue.issueNumber,
          accessToken,
        );
        comments = apiComments.map((c) => ({
          authorLogin: c.user?.login ?? null,
          body: c.body,
        }));
      } catch (e) {
        this.logger.debug(`Could not fetch comments for issue #${issue.issueNumber}: ${e}`);
      }

      // Ingest and vectorize into KnowledgeSource for RAG and search
      await this.ingestionService.syncGitHubIssue(projectId, {
        issueId: issue.id,
        issueNumber: issue.issueNumber,
        title: issue.title,
        body: issue.body,
        state: issue.state,
        htmlUrl: issue.htmlUrl,
        authorLogin: issue.authorLogin,
        labels: issue.labels,
        repositoryOwner: connection.repositoryOwner,
        repositoryName: connection.repositoryName,
        comments,
        revision: Math.floor(issue.githubUpdatedAt.getTime() / 1000),
      });
    }

    // 2. Fetch Pull Requests
    let prsCount = 0;
    try {
      const prResult = await this.githubClient.fetchPullRequests(
        connection.repositoryOwner,
        connection.repositoryName,
        { state: 'all' },
        accessToken,
      );

      for (const apiPr of prResult.pullRequests) {
        let pr = await this.prRepo.findOne({
          where: { connectionId: connection.id, prNumber: apiPr.number },
        });

        const labelNames = (apiPr.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
        const isMerged = !!apiPr.merged_at;

        if (pr) {
          pr.title = apiPr.title;
          pr.body = apiPr.body;
          pr.state = apiPr.state;
          pr.htmlUrl = apiPr.html_url;
          pr.authorLogin = apiPr.user?.login ?? null;
          pr.baseBranch = apiPr.base?.ref ?? null;
          pr.headBranch = apiPr.head?.ref ?? null;
          pr.isMerged = isMerged;
          pr.mergedAt = apiPr.merged_at ? new Date(apiPr.merged_at) : null;
          pr.labels = labelNames;
          pr.githubUpdatedAt = new Date(apiPr.updated_at);
          pr.syncedAt = new Date();
        } else {
          pr = this.prRepo.create({
            projectId,
            connectionId: connection.id,
            githubPrId: String(apiPr.id),
            prNumber: apiPr.number,
            title: apiPr.title,
            body: apiPr.body,
            state: apiPr.state,
            htmlUrl: apiPr.html_url,
            authorLogin: apiPr.user?.login ?? null,
            baseBranch: apiPr.base?.ref ?? null,
            headBranch: apiPr.head?.ref ?? null,
            isMerged,
            mergedAt: apiPr.merged_at ? new Date(apiPr.merged_at) : null,
            labels: labelNames,
            githubCreatedAt: new Date(apiPr.created_at),
            githubUpdatedAt: new Date(apiPr.updated_at),
            syncedAt: new Date(),
          });
        }

        pr = await this.prRepo.save(pr);

        // Ingest into KnowledgeSource
        await this.ingestionService.syncGitHubPullRequest(projectId, {
          prId: pr.id,
          prNumber: pr.prNumber,
          title: pr.title,
          body: pr.body,
          state: pr.state,
          htmlUrl: pr.htmlUrl,
          authorLogin: pr.authorLogin,
          baseBranch: pr.baseBranch,
          headBranch: pr.headBranch,
          isMerged: pr.isMerged,
          labels: pr.labels,
          repositoryOwner: connection.repositoryOwner,
          repositoryName: connection.repositoryName,
          revision: Math.floor(pr.githubUpdatedAt.getTime() / 1000),
        });
      }
      prsCount = prResult.pullRequests.length;
    } catch (e) {
      this.logger.warn(
        `Could not sync PRs for ${connection.repositoryOwner}/${connection.repositoryName}: ${e}`,
      );
    }

    const now = new Date();
    connection.status = GitHubConnectionStatus.CONNECTED;
    connection.errorSummary = null;
    connection.lastSyncedAt = now;
    connection.syncCursor = now.toISOString();
    await this.connectionRepo.save(connection);

    const totalIssues = await this.issueRepo.count({
      where: { connectionId: connection.id },
    });
    const totalPrs = await this.prRepo.count({
      where: { connectionId: connection.id },
    });

    await this.auditService.record({
      projectId,
      actorId,
      action: 'GITHUB_SYNCED',
      entityType: 'GITHUB_CONNECTION',
      entityId: connection.id,
      metadata: {
        syncedIssuesCount: issues.length,
        totalIssues,
        syncedPrsCount: prsCount,
        totalPrs,
      },
    });

    return {
      syncedCount: issues.length,
      totalCount: totalIssues,
      syncedPrCount: prsCount,
      totalPrCount: totalPrs,
      lastSyncedAt: now.toISOString(),
    };
  }

  async syncCodebase(
    projectId: string,
    actorId: string,
    connectionId?: string,
    accessToken?: string,
    options: { cursor?: number; batchSize?: number; treeVersion?: string } = {},
  ): Promise<SyncCodebaseResponseDto> {
    await this.ensureProjectExists(projectId);

    const where: { projectId: string; id?: string } = { projectId };
    if (connectionId) {
      where.id = connectionId;
    }

    const connection = await this.connectionRepo.findOne({
      where,
      order: { updatedAt: 'DESC' },
    });

    if (!connection) {
      throw new NotFoundException({
        code: 'GITHUB_CONNECTION_NOT_FOUND',
        message: 'No GitHub connection found for this project',
      });
    }

    if (connection.status === GitHubConnectionStatus.DISCONNECTED) {
      throw new BadRequestException({
        code: 'GITHUB_CONNECTION_DISCONNECTED',
        message: 'Cannot sync a disconnected repository',
      });
    }

    // 1. Fetch Repository Tree
    let treeEntries;
    try {
      treeEntries = await this.githubClient.fetchRepositoryTree(
        connection.repositoryOwner,
        connection.repositoryName,
        undefined,
        accessToken,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException({
        code: 'GITHUB_TREE_FETCH_FAILED',
        message: `Failed to fetch repo tree: ${msg}`,
      });
    }

    // 2. Filter candidate code/docs files
    const candidateFiles = treeEntries.filter((entry) => {
      if (entry.type !== 'blob') return false;
      const lower = entry.path.toLowerCase();

      // Exclude build artifacts, node_modules, lockfiles, hidden dirs
      if (
        lower.startsWith('node_modules/') ||
        lower.includes('/node_modules/') ||
        lower.startsWith('.git/') ||
        lower.startsWith('dist/') ||
        lower.startsWith('build/') ||
        lower.startsWith('.next/') ||
        lower.startsWith('coverage/') ||
        lower.endsWith('pnpm-lock.yaml') ||
        lower.endsWith('package-lock.json') ||
        lower.endsWith('yarn.lock')
      ) {
        return false;
      }

      // Check extension
      const parts = entry.path.split('.');
      const lastPart = parts[parts.length - 1];
      const ext = parts.length > 1 && lastPart ? lastPart.toLowerCase() : '';
      if (!this.supportedCodeExtensions.has(ext)) {
        return false;
      }

      // Check file size (<= 100 KB)
      if (entry.size && entry.size > 100 * 1024) {
        return false;
      }

      return true;
    });

    const treeVersion = createHash('sha256')
      .update(JSON.stringify(candidateFiles.map((e) => [e.path, e.sha])))
      .digest('hex');
    if (options.treeVersion && options.treeVersion !== treeVersion)
      throw new BadRequestException({
        code: 'GITHUB_TREE_CHANGED',
        message:
          'Repository changed during indexing. Restart indexing; completed unchanged files will be skipped.',
      });
    const cursor = options.cursor ?? 0;
    const batch = candidateFiles.slice(
      cursor,
      cursor + (options.batchSize ?? candidateFiles.length),
    );
    const nextCursor = cursor + batch.length < candidateFiles.length ? cursor + batch.length : null;
    // Visit every eligible file; successful SHA checkpoints make subsequent runs resumable.
    let indexedFilesCount = 0;
    let unchangedFilesCount = 0;
    let failedFilesCount = 0;
    let rateLimited = false;

    for (const treeEntry of batch) {
      try {
        let fileEntity = await this.fileRepo.findOne({
          where: { connectionId: connection.id, path: treeEntry.path },
        });
        if (
          fileEntity?.sha === treeEntry.sha &&
          (await this.ingestionService.isSourceIndexed(
            projectId,
            KnowledgeSourceType.GITHUB_CODE,
            fileEntity.id,
          ))
        ) {
          unchangedFilesCount++;
          continue;
        }
        const fileContent = await this.githubClient.fetchFileContent(
          connection.repositoryOwner,
          connection.repositoryName,
          treeEntry.path,
          accessToken,
        );

        if (!fileContent) throw new Error('GitHub file content unavailable');
        if (fileContent.sha !== treeEntry.sha)
          throw new Error('Repository changed during indexing; retry with the current tree');

        const pathParts = treeEntry.path.split('/');
        const fileName = pathParts[pathParts.length - 1] ?? treeEntry.path;
        const extParts = fileName.split('.');
        const lastExtPart = extParts[extParts.length - 1];
        const extension = extParts.length > 1 && lastExtPart ? lastExtPart.toLowerCase() : 'txt';

        if (fileEntity) {
          fileEntity.fileName = fileName;
          fileEntity.extension = extension;
          fileEntity.size = fileContent.size;
          fileEntity.sha = ''; // Acknowledge this SHA only after ingestion succeeds.
          fileEntity.htmlUrl = fileContent.html_url;
          fileEntity.syncedAt = new Date();
        } else {
          fileEntity = this.fileRepo.create({
            projectId,
            connectionId: connection.id,
            path: treeEntry.path,
            fileName,
            extension,
            size: fileContent.size,
            sha: '',
            htmlUrl: fileContent.html_url,
            syncedAt: new Date(),
          });
        }

        fileEntity = await this.fileRepo.save(fileEntity);

        // Ingest into KnowledgeSource
        const indexedSource = await this.ingestionService.syncGitHubCodeFile(projectId, {
          fileId: fileEntity.id,
          path: fileEntity.path,
          fileName: fileEntity.fileName,
          extension: fileEntity.extension,
          content: fileContent.content,
          size: fileEntity.size,
          htmlUrl: fileEntity.htmlUrl,
          repositoryOwner: connection.repositoryOwner,
          repositoryName: connection.repositoryName,
          revision: Math.floor(fileEntity.syncedAt.getTime() / 1000),
        });

        if (!indexedSource || indexedSource.status !== 'INDEXED')
          throw new Error('File indexing did not complete');
        fileEntity.sha = treeEntry.sha;
        await this.fileRepo.save(fileEntity);
        indexedFilesCount++;
      } catch (err) {
        failedFilesCount++;
        this.logger.warn(`Could not index file ${treeEntry.path}`);
        if (err instanceof GitHubRateLimitError) {
          rateLimited = true;
          break;
        }
      }
    }

    const totalFiles = await this.fileRepo.count({
      where: { connectionId: connection.id },
    });

    await this.auditService.record({
      projectId,
      actorId,
      action: 'GITHUB_CODE_INDEXED',
      entityType: 'GITHUB_CONNECTION',
      entityId: connection.id,
      metadata: {
        indexedFilesCount,
        unchangedFilesCount,
        failedFilesCount,
        candidateFilesCount: candidateFiles.length,
        totalFiles,
      },
    });

    if (failedFilesCount)
      throw new BadRequestException({
        code: 'GITHUB_CODE_SYNC_INCOMPLETE',
        message: `Indexing incomplete: ${indexedFilesCount} indexed, ${unchangedFilesCount} unchanged out of ${candidateFiles.length} eligible files. ${rateLimited ? 'GitHub rate limit reached; retry after the limit resets or supply a GitHub token.' : `${failedFilesCount} files failed; retry indexing.`} Completed files are preserved and skipped on retry.`,
      });
    return {
      nextCursor,
      treeVersion,
      candidateFilesCount: candidateFiles.length,
      unchangedFilesCount,
      indexedFilesCount,
      totalFiles,
      lastSyncedAt: new Date().toISOString(),
    };
  }

  async disconnect(projectId: string, actorId: string, connectionId?: string): Promise<void> {
    await this.ensureProjectExists(projectId);

    const where: { projectId: string; id?: string } = { projectId };
    if (connectionId) {
      where.id = connectionId;
    }

    const connection = await this.connectionRepo.findOne({
      where,
      order: { updatedAt: 'DESC' },
    });

    if (!connection) {
      throw new NotFoundException({
        code: 'GITHUB_CONNECTION_NOT_FOUND',
        message: 'No GitHub connection found for this project',
      });
    }

    connection.status = GitHubConnectionStatus.DISCONNECTED;
    await this.connectionRepo.save(connection);

    // Deactivate knowledge sources so they disappear from search & AI
    await this.ingestionService.deactivateSourcesByType(
      projectId,
      KnowledgeSourceType.GITHUB_ISSUE,
    );
    await this.ingestionService.deactivateSourcesByType(projectId, KnowledgeSourceType.GITHUB_PR);
    await this.ingestionService.deactivateSourcesByType(projectId, KnowledgeSourceType.GITHUB_CODE);

    await this.auditService.record({
      projectId,
      actorId,
      action: 'GITHUB_DISCONNECTED',
      entityType: 'GITHUB_CONNECTION',
      entityId: connection.id,
      metadata: {
        repository: `${connection.repositoryOwner}/${connection.repositoryName}`,
      },
    });
  }

  async listIssues(
    projectId: string,
    query: ListGitHubIssuesQueryDto,
  ): Promise<{ items: GitHubIssueResponseDto[]; total: number; page: number; limit: number }> {
    await this.ensureProjectExists(projectId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.issueRepo
      .createQueryBuilder('issue')
      .where('issue.project_id = :projectId', { projectId });

    if (query.connectionId) {
      qb.andWhere('issue.connection_id = :connectionId', { connectionId: query.connectionId });
    }

    if (query.state && query.state !== 'all') {
      qb.andWhere('issue.state = :state', { state: query.state });
    }

    if (query.q) {
      const search = `%${query.q.toLowerCase()}%`;
      const num = parseInt(query.q, 10);
      if (!isNaN(num)) {
        qb.andWhere(
          '(LOWER(issue.title) LIKE :search OR LOWER(issue.body) LIKE :search OR issue.issue_number = :num)',
          { search, num },
        );
      } else {
        qb.andWhere('(LOWER(issue.title) LIKE :search OR LOWER(issue.body) LIKE :search)', {
          search,
        });
      }
    }

    qb.orderBy('issue.issue_number', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [issues, total] = await qb.getManyAndCount();

    return {
      items: issues.map(this.mapIssueDto),
      total,
      page,
      limit,
    };
  }

  async listPullRequests(
    projectId: string,
    query: ListGitHubPullRequestsQueryDto,
  ): Promise<{
    items: GitHubPullRequestResponseDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    await this.ensureProjectExists(projectId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.prRepo
      .createQueryBuilder('pr')
      .where('pr.project_id = :projectId', { projectId });

    if (query.connectionId) {
      qb.andWhere('pr.connection_id = :connectionId', { connectionId: query.connectionId });
    }

    if (query.state && query.state !== 'all') {
      qb.andWhere('pr.state = :state', { state: query.state });
    }

    if (query.q) {
      const search = `%${query.q.toLowerCase()}%`;
      const num = parseInt(query.q, 10);
      if (!isNaN(num)) {
        qb.andWhere(
          '(LOWER(pr.title) LIKE :search OR LOWER(pr.body) LIKE :search OR pr.pr_number = :num)',
          { search, num },
        );
      } else {
        qb.andWhere('(LOWER(pr.title) LIKE :search OR LOWER(pr.body) LIKE :search)', {
          search,
        });
      }
    }

    qb.orderBy('pr.pr_number', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [prs, total] = await qb.getManyAndCount();

    return {
      items: prs.map(this.mapPullRequestDto),
      total,
      page,
      limit,
    };
  }

  async listFiles(
    projectId: string,
    query: ListGitHubFilesQueryDto,
  ): Promise<{ items: GitHubRepoFileResponseDto[]; total: number; page: number; limit: number }> {
    await this.ensureProjectExists(projectId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const qb = this.fileRepo
      .createQueryBuilder('file')
      .where('file.project_id = :projectId', { projectId });

    if (query.connectionId) {
      qb.andWhere('file.connection_id = :connectionId', { connectionId: query.connectionId });
    }

    if (query.extension) {
      qb.andWhere('file.extension = :extension', { extension: query.extension.toLowerCase() });
    }

    if (query.q) {
      const search = `%${query.q.toLowerCase()}%`;
      qb.andWhere('(LOWER(file.path) LIKE :search OR LOWER(file.file_name) LIKE :search)', {
        search,
      });
    }

    qb.orderBy('file.path', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    const [files, total] = await qb.getManyAndCount();

    return {
      items: files.map(this.mapRepoFileDto),
      total,
      page,
      limit,
    };
  }

  private async ensureProjectExists(projectId: string): Promise<Project> {
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
    });
    if (!project) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found',
      });
    }
    return project;
  }

  private async mapConnectionDtoWithCounts(
    conn: GitHubConnection,
  ): Promise<GitHubConnectionResponseDto> {
    const issueCount = await this.issueRepo.count({
      where: { connectionId: conn.id },
    });
    const pullRequestCount = await this.prRepo.count({
      where: { connectionId: conn.id },
    });
    const fileCount = await this.fileRepo.count({
      where: { connectionId: conn.id },
    });

    return {
      id: conn.id,
      projectId: conn.projectId,
      repositoryOwner: conn.repositoryOwner,
      repositoryName: conn.repositoryName,
      repositoryId: conn.repositoryId,
      status: conn.status,
      lastSyncedAt: conn.lastSyncedAt ? conn.lastSyncedAt.toISOString() : null,
      errorSummary: conn.errorSummary,
      issueCount,
      pullRequestCount,
      fileCount,
      createdAt: conn.createdAt.toISOString(),
      updatedAt: conn.updatedAt.toISOString(),
    };
  }

  private mapIssueDto(issue: GitHubIssue): GitHubIssueResponseDto {
    return {
      id: issue.id,
      projectId: issue.projectId,
      connectionId: issue.connectionId,
      issueNumber: issue.issueNumber,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      htmlUrl: issue.htmlUrl,
      authorLogin: issue.authorLogin,
      labels: issue.labels || [],
      githubCreatedAt: issue.githubCreatedAt.toISOString(),
      githubUpdatedAt: issue.githubUpdatedAt.toISOString(),
      syncedAt: issue.syncedAt.toISOString(),
    };
  }

  private mapPullRequestDto(pr: GitHubPullRequest): GitHubPullRequestResponseDto {
    return {
      id: pr.id,
      projectId: pr.projectId,
      connectionId: pr.connectionId,
      prNumber: pr.prNumber,
      title: pr.title,
      body: pr.body,
      state: pr.state,
      htmlUrl: pr.htmlUrl,
      authorLogin: pr.authorLogin,
      baseBranch: pr.baseBranch,
      headBranch: pr.headBranch,
      isMerged: pr.isMerged,
      mergedAt: pr.mergedAt ? pr.mergedAt.toISOString() : null,
      labels: pr.labels || [],
      githubCreatedAt: pr.githubCreatedAt.toISOString(),
      githubUpdatedAt: pr.githubUpdatedAt.toISOString(),
      syncedAt: pr.syncedAt.toISOString(),
    };
  }

  private mapRepoFileDto(file: GitHubRepoFile): GitHubRepoFileResponseDto {
    return {
      id: file.id,
      projectId: file.projectId,
      connectionId: file.connectionId,
      path: file.path,
      fileName: file.fileName,
      extension: file.extension,
      size: file.size,
      htmlUrl: file.htmlUrl,
      syncedAt: file.syncedAt.toISOString(),
    };
  }
}
