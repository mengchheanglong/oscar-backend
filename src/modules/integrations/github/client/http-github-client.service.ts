import { Injectable, Logger } from '@nestjs/common';
import {
  GitHubRateLimitError,
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
export class HttpGitHubClientService implements IGitHubClient {
  private readonly logger = new Logger(HttpGitHubClientService.name);
  private readonly baseUrl = 'https://api.github.com';

  private buildHeaders(accessToken?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Continuum-Backend',
    };
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    return headers;
  }

  async verifyRepository(
    owner: string,
    repo: string,
    accessToken?: string,
  ): Promise<{ id: number; name: string; full_name: string; owner: string }> {
    const headers = this.buildHeaders(accessToken);

    const res = await fetch(`${this.baseUrl}/repos/${owner}/${repo}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      this.logger.warn(`GitHub repository verification failed: ${res.status}`);
      throw new Error(`GitHub repository ${owner}/${repo} returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as { id: number; name: string; full_name: string };
    return {
      id: data.id,
      name: data.name,
      full_name: data.full_name,
      owner,
    };
  }

  async fetchIssues(
    owner: string,
    repo: string,
    options?: FetchIssuesOptions,
    accessToken?: string,
  ): Promise<{ issues: GitHubApiIssue[]; hasMore: boolean }> {
    const query = new URLSearchParams();
    query.set('state', options?.state ?? 'all');
    query.set('per_page', String(options?.perPage ?? 100));
    query.set('page', String(options?.page ?? 1));
    if (options?.since) {
      query.set('since', options.since);
    }

    const headers = this.buildHeaders(accessToken);
    const url = `${this.baseUrl}/repos/${owner}/${repo}/issues?${query.toString()}`;
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      this.logger.error(`Failed to fetch issues from ${owner}/${repo}: ${res.status}`);
      throw new Error(`GitHub issues API returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as GitHubApiIssue[];

    // Exclude pull requests (GitHub issues API includes PRs unless filtered)
    const issuesOnly = data.filter((item) => !item.pull_request);

    const linkHeader = res.headers.get('link') || '';
    const hasMore = linkHeader.includes('rel="next"');

    return {
      issues: issuesOnly,
      hasMore,
    };
  }

  async fetchIssueComments(
    owner: string,
    repo: string,
    issueNumber: number,
    accessToken?: string,
  ): Promise<GitHubApiComment[]> {
    const headers = this.buildHeaders(accessToken);
    const url = `${this.baseUrl}/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=30`;
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      this.logger.warn(`Failed to fetch comments for issue #${issueNumber}: ${res.status}`);
      return [];
    }

    const data = (await res.json()) as Array<{
      id: number;
      body: string;
      user: { login: string } | null;
      created_at: string;
      updated_at: string;
    }>;

    return data.map((c) => ({
      id: c.id,
      body: c.body,
      user: c.user ? { login: c.user.login } : null,
      created_at: c.created_at,
      updated_at: c.updated_at,
    }));
  }

  async fetchPullRequests(
    owner: string,
    repo: string,
    options?: FetchPullRequestsOptions,
    accessToken?: string,
  ): Promise<{ pullRequests: GitHubApiPullRequest[]; hasMore: boolean }> {
    const query = new URLSearchParams();
    query.set('state', options?.state ?? 'all');
    query.set('per_page', String(options?.perPage ?? 50));
    query.set('page', String(options?.page ?? 1));

    const headers = this.buildHeaders(accessToken);
    const url = `${this.baseUrl}/repos/${owner}/${repo}/pulls?${query.toString()}`;
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      this.logger.error(`Failed to fetch PRs from ${owner}/${repo}: ${res.status}`);
      throw new Error(`GitHub pulls API returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as GitHubApiPullRequest[];
    const linkHeader = res.headers.get('link') || '';
    const hasMore = linkHeader.includes('rel="next"');

    return {
      pullRequests: data,
      hasMore,
    };
  }

  async fetchRepositoryTree(
    owner: string,
    repo: string,
    branch?: string,
    accessToken?: string,
  ): Promise<GitHubApiTreeEntry[]> {
    const headers = this.buildHeaders(accessToken);
    const ref = branch ?? 'HEAD';
    const url = `${this.baseUrl}/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`;
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      this.logger.error(`Failed to fetch repo tree from ${owner}/${repo}: ${res.status}`);
      throw new Error(`GitHub Git Trees API returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      sha: string;
      tree: GitHubApiTreeEntry[];
      truncated?: boolean;
    };
    if (!data.truncated) return data.tree || [];
    // Recursive trees can be truncated. Walk complete subtrees instead of accepting partial coverage.
    const files: GitHubApiTreeEntry[] = [];
    const pending = [{ sha: data.sha, prefix: '' }];
    while (pending.length) {
      const next = pending.pop()!;
      const treeResponse = await fetch(
        `${this.baseUrl}/repos/${owner}/${repo}/git/trees/${next.sha}`,
        { headers, signal: AbortSignal.timeout(20_000) },
      );
      if (!treeResponse.ok) throw new Error(`GitHub tree API returned HTTP ${treeResponse.status}`);
      const tree = (await treeResponse.json()) as {
        tree: GitHubApiTreeEntry[];
        truncated?: boolean;
      };
      if (tree.truncated)
        throw new Error(
          'GitHub returned a truncated non-recursive tree; complete indexing is unavailable',
        );
      for (const entry of tree.tree) {
        const path = next.prefix + entry.path;
        if (entry.type === 'tree') pending.push({ sha: entry.sha, prefix: path + '/' });
        else files.push({ ...entry, path });
      }
    }
    return files;
  }

  async fetchFileContent(
    owner: string,
    repo: string,
    path: string,
    accessToken?: string,
  ): Promise<GitHubApiFileContent | null> {
    const headers = this.buildHeaders(accessToken);
    const url = `${this.baseUrl}/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`;
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      this.logger.warn(`Failed to fetch file ${path} from ${owner}/${repo}: ${res.status}`);
      if (
        res.status === 429 ||
        (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')
      )
        throw new GitHubRateLimitError('GitHub rate limit reached');
      throw new Error(`GitHub file API returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      type: string;
      size: number;
      sha: string;
      content?: string;
      encoding?: string;
      html_url: string;
    };

    if (data.type !== 'file' || !data.content) {
      return null;
    }

    const decodedContent =
      data.encoding === 'base64'
        ? Buffer.from(data.content, 'base64').toString('utf8')
        : data.content;

    return {
      path,
      sha: data.sha,
      size: data.size,
      content: decodedContent,
      html_url: data.html_url,
    };
  }
}
