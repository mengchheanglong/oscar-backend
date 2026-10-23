import { Injectable } from '@nestjs/common';
import {
  FetchIssuesOptions,
  FetchPullRequestsOptions,
  GitHubApiComment,
  GitHubApiFileContent,
  GitHubApiIssue,
  GitHubApiPullRequest,
  GitHubApiTreeEntry,
  IGitHubClient,
} from './github-client.interface';

@Injectable()
export class MockGitHubClientService implements IGitHubClient {
  private readonly defaultMockIssues: GitHubApiIssue[] = [
    {
      id: 1001,
      number: 1,
      title: 'Fix cookie session expiration on Safari mobile',
      body: 'Users report being logged out on iOS Safari after 15 minutes due to ITP cookie partitioning policies. Need to ensure SameSite and Secure attributes are compliant.',
      state: 'open',
      html_url: 'https://github.com/example/repo/issues/1',
      user: { login: 'alice-dev' },
      labels: [{ name: 'bug' }, { name: 'auth' }, { name: 'high-priority' }],
      created_at: '2026-09-10T08:00:00Z',
      updated_at: '2026-09-12T14:30:00Z',
    },
    {
      id: 1002,
      number: 2,
      title: 'Support pgvector cosine distance operator in hybrid retrieval',
      body: 'Evaluate <=> cosine distance index performance compared to inner product for 1536-dimensional OpenAI embeddings.',
      state: 'closed',
      html_url: 'https://github.com/example/repo/issues/2',
      user: { login: 'bob-engineer' },
      labels: [{ name: 'feature' }, { name: 'database' }, { name: 'pgvector' }],
      created_at: '2026-09-11T10:15:00Z',
      updated_at: '2026-09-14T09:00:00Z',
    },
    {
      id: 1003,
      number: 3,
      title: 'Add rate limiting for AI conversation endpoints',
      body: 'Protect DeepSeek API budget by enforcing 10 requests per minute per user on /projects/:id/ai/conversations.',
      state: 'open',
      html_url: 'https://github.com/example/repo/issues/3',
      user: { login: 'charlie-sec' },
      labels: [{ name: 'security' }, { name: 'api' }],
      created_at: '2026-09-13T12:00:00Z',
      updated_at: '2026-09-15T16:45:00Z',
    },
    {
      id: 1004,
      number: 4,
      title: 'Improve Docker Compose test database startup and cleanup speed',
      body: 'Running integration tests against postgres-test port 43105 should spin up and tear down cleanly without zombie containers.',
      state: 'closed',
      html_url: 'https://github.com/example/repo/issues/4',
      user: { login: 'alice-dev' },
      labels: [{ name: 'dx' }, { name: 'devops' }],
      created_at: '2026-09-14T07:30:00Z',
      updated_at: '2026-09-16T11:20:00Z',
    },
    {
      id: 1005,
      number: 5,
      title: 'Implement optimistic concurrency control on Task updates',
      body: 'Tasks should reject concurrent modifications with 409 Conflict when version numbers collide.',
      state: 'closed',
      html_url: 'https://github.com/example/repo/issues/5',
      user: { login: 'bob-engineer' },
      labels: [{ name: 'bug' }, { name: 'tasks' }],
      created_at: '2026-09-15T09:00:00Z',
      updated_at: '2026-09-16T15:00:00Z',
    },
  ];

  private readonly defaultMockPullRequests: GitHubApiPullRequest[] = [
    {
      id: 2001,
      number: 10,
      title: 'feat: add multi-repo workspace synchronization and tree indexing',
      body: 'Resolves issue with single-repo restriction. Implements composite unique key on github_connections and adds Git Trees ingestion.',
      state: 'open',
      html_url: 'https://github.com/example/repo/pull/10',
      user: { login: 'alice-dev' },
      base: { ref: 'main' },
      head: { ref: 'feat/multi-repo-sync' },
      merged_at: null,
      labels: [{ name: 'enhancement' }, { name: 'backend' }],
      created_at: '2026-09-18T10:00:00Z',
      updated_at: '2026-09-19T14:00:00Z',
    },
    {
      id: 2002,
      number: 11,
      title: 'fix: handle token revocation in GitHub webhook adapter',
      body: 'Gracefully transition connection to ERROR state and notify project owners when personal access token is invalidated.',
      state: 'closed',
      html_url: 'https://github.com/example/repo/pull/11',
      user: { login: 'bob-engineer' },
      base: { ref: 'main' },
      head: { ref: 'fix/token-revocation' },
      merged_at: '2026-09-20T11:30:00Z',
      labels: [{ name: 'bug' }, { name: 'security' }],
      created_at: '2026-09-19T08:00:00Z',
      updated_at: '2026-09-20T11:30:00Z',
    },
    {
      id: 2003,
      number: 12,
      title: 'perf: optimize pgvector HNSW index build parameters',
      body: 'Tunes m=16, ef_construction=64 for cosine distance index over 1536-dimensional embedding vectors.',
      state: 'open',
      html_url: 'https://github.com/example/repo/pull/12',
      user: { login: 'charlie-sec' },
      base: { ref: 'main' },
      head: { ref: 'perf/hnsw-tuning' },
      merged_at: null,
      labels: [{ name: 'performance' }, { name: 'database' }],
      created_at: '2026-09-21T09:00:00Z',
      updated_at: '2026-09-21T15:00:00Z',
    },
  ];

  private readonly defaultMockComments: Record<number, GitHubApiComment[]> = {
    1: [
      {
        id: 3001,
        body: 'Reproduced on Safari 17.4 iOS. Setting SameSite=Lax and Secure fixed the cookie drops.',
        user: { login: 'bob-engineer' },
        created_at: '2026-09-11T12:00:00Z',
        updated_at: '2026-09-11T12:00:00Z',
      },
      {
        id: 3002,
        body: 'Confirmed working in staging testing. Opening a PR shortly.',
        user: { login: 'alice-dev' },
        created_at: '2026-09-12T14:20:00Z',
        updated_at: '2026-09-12T14:20:00Z',
      },
    ],
    3: [
      {
        id: 3003,
        body: 'Consider implementing a sliding window in Redis instead of fixed minute windows to avoid burst exploitation.',
        user: { login: 'alice-dev' },
        created_at: '2026-09-14T09:30:00Z',
        updated_at: '2026-09-14T09:30:00Z',
      },
    ],
  };

  private readonly defaultMockFiles: Array<{
    path: string;
    content: string;
    size: number;
    sha: string;
  }> = [
    {
      path: 'README.md',
      content: '# Project Workspace\n\nAI-powered project workspace with hybrid RAG and pgvector.',
      size: 78,
      sha: 'a1b2c3d4e5',
    },
    {
      path: 'src/main.ts',
      content: `import { NestFactory } from '@nestjs/core';\nimport { AppModule } from './app.module';\n\nasync function bootstrap() {\n  const app = await NestFactory.create(AppModule);\n  await app.listen(3000);\n}\nbootstrap();\n`,
      size: 198,
      sha: 'f1e2d3c4b5',
    },
    {
      path: 'src/app.module.ts',
      content: `import { Module } from '@nestjs/common';\nimport { ProjectsModule } from './modules/projects/projects.module';\n\n@Module({\n  imports: [ProjectsModule],\n})\nexport class AppModule {}\n`,
      size: 165,
      sha: '1a2b3c4d5e',
    },
    {
      path: 'docs/architecture.md',
      content: `# Architecture\n\nModular monolith using NestJS, TypeORM, PostgreSQL/pgvector, and DeepSeek AI Copilot.\n`,
      size: 110,
      sha: '6f7e8d9c0b',
    },
  ];

  async verifyRepository(
    owner: string,
    repo: string,
  ): Promise<{ id: number; name: string; full_name: string; owner: string }> {
    if (owner.toLowerCase() === 'invalid' || repo.toLowerCase() === 'not-found') {
      throw new Error(`GitHub repository ${owner}/${repo} not found`);
    }

    return {
      id: 88889999,
      name: repo,
      full_name: `${owner}/${repo}`,
      owner,
    };
  }

  async fetchIssues(
    owner: string,
    repo: string,
    options?: FetchIssuesOptions,
  ): Promise<{ issues: GitHubApiIssue[]; hasMore: boolean }> {
    let filtered = [...this.defaultMockIssues];

    if (options?.state && options.state !== 'all') {
      filtered = filtered.filter((i) => i.state === options.state);
    }

    if (options?.since) {
      const sinceDate = new Date(options.since);
      filtered = filtered.filter((i) => new Date(i.updated_at) >= sinceDate);
    }

    const page = options?.page ?? 1;
    const perPage = options?.perPage ?? 30;
    const start = (page - 1) * perPage;
    const end = start + perPage;

    const pageIssues = filtered.slice(start, end).map((issue) => ({
      ...issue,
      html_url: `https://github.com/${owner}/${repo}/issues/${issue.number}`,
    }));

    return {
      issues: pageIssues,
      hasMore: end < filtered.length,
    };
  }

  async fetchIssueComments(
    _owner: string,
    _repo: string,
    issueNumber: number,
  ): Promise<GitHubApiComment[]> {
    return this.defaultMockComments[issueNumber] ?? [];
  }

  async fetchPullRequests(
    owner: string,
    repo: string,
    options?: FetchPullRequestsOptions,
  ): Promise<{ pullRequests: GitHubApiPullRequest[]; hasMore: boolean }> {
    let filtered = [...this.defaultMockPullRequests];

    if (options?.state && options.state !== 'all') {
      filtered = filtered.filter((p) => p.state === options.state);
    }

    const page = options?.page ?? 1;
    const perPage = options?.perPage ?? 30;
    const start = (page - 1) * perPage;
    const end = start + perPage;

    const pagePrs = filtered.slice(start, end).map((pr) => ({
      ...pr,
      html_url: `https://github.com/${owner}/${repo}/pull/${pr.number}`,
    }));

    return {
      pullRequests: pagePrs,
      hasMore: end < filtered.length,
    };
  }

  async fetchRepositoryTree(
    _owner: string,
    _repo: string,
    _branch?: string,
  ): Promise<GitHubApiTreeEntry[]> {
    return this.defaultMockFiles.map((f) => ({
      path: f.path,
      mode: '100644',
      type: 'blob',
      sha: f.sha,
      size: f.size,
      url: `https://api.github.com/repos/mock/mock/git/blobs/${f.sha}`,
    }));
  }

  async fetchFileContent(
    owner: string,
    repo: string,
    path: string,
  ): Promise<GitHubApiFileContent | null> {
    const file = this.defaultMockFiles.find((f) => f.path === path);
    if (!file) return null;

    return {
      path: file.path,
      sha: file.sha,
      size: file.size,
      content: file.content,
      html_url: `https://github.com/${owner}/${repo}/blob/main/${file.path}`,
    };
  }
}
