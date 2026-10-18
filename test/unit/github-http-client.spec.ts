import { HttpGitHubClientService } from '../../src/modules/integrations/github/client/http-github-client.service';
import { GitHubRateLimitError } from '../../src/modules/integrations/github/client/github-client.interface';

describe('GitHub complete source traversal', () => {
  afterEach(() => jest.restoreAllMocks());
  it('walks non-recursive subtrees when the recursive tree is truncated', async () => {
    const mock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sha: 'root', tree: [], truncated: true })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            tree: [
              { path: 'src', type: 'tree', sha: 'child' },
              { path: 'README.md', type: 'blob', sha: 'readme' },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ tree: [{ path: 'app.ts', type: 'blob', sha: 'app' }] })),
      );
    const files = await new HttpGitHubClientService().fetchRepositoryTree('owner', 'repo');
    expect(files.map((f) => f.path)).toEqual(['README.md', 'src/app.ts']);
    expect(String(mock.mock.calls[1]?.[0])).toContain('/git/trees/root');
    expect(String(mock.mock.calls[2]?.[0])).toContain('/git/trees/child');
  });
  it.each([403, 429])('reports rate limiting (%s) instead of skipping a file', async (status) => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('', { status, headers: { 'x-ratelimit-remaining': '0' } }));
    await expect(
      new HttpGitHubClientService().fetchFileContent('owner', 'repo', 'src/app.ts'),
    ).rejects.toBeInstanceOf(GitHubRateLimitError);
  });
  it('bounds every external request with a timeout signal', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    const mock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ tree: [], id: 1, name: 'repo', full_name: 'owner/repo' })),
      );
    const client = new HttpGitHubClientService();
    await client.verifyRepository('owner', 'repo');
    await client.fetchRepositoryTree('owner', 'repo');
    expect(timeout).toHaveBeenCalledWith(20_000);
    expect(mock.mock.calls.every(([, options]) => options?.signal instanceof AbortSignal)).toBe(
      true,
    );
  });
  it('reports inaccessible files rather than treating them as successful coverage', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    await expect(
      new HttpGitHubClientService().fetchFileContent('owner', 'repo', 'src/app.ts'),
    ).rejects.toThrow('HTTP 404');
  });
});
