import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { OscarMcpServer } from '../../src/mcp/oscar-mcp-server';

describe('MCP GitHub integration', () => {
  let client: Client;
  let mcp: OscarMcpServer;
  const projectId = '2715f920-f86f-475e-864e-85862d8d64d7';
  beforeEach(async () => {
    mcp = new OscarMcpServer({
      apiUrl: 'http://localhost/api/v1',
      apiKey: 'test',
      defaultProjectIdOrKey: projectId,
    });
    client = new Client({ name: 'test', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.server.connect(serverTransport), client.connect(clientTransport)]);
  });
  afterEach(async () => {
    await client.close();
    await mcp.server.close();
    jest.restoreAllMocks();
  });
  it.each(['', 'null'])(
    'reports no connection for an empty or null successful API response (%s)',
    async (body) => {
      jest.spyOn(global, 'fetch').mockResolvedValue(new Response(body));
      const result = await client.callTool({ name: 'get_github_integration', arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.content).toEqual([
        { type: 'text', text: 'No GitHub repository connected for this project.' },
      ]);
    },
  );
  it('returns saved repository connection details', async () => {
    const connection = {
      repositoryOwner: 'owner',
      repositoryName: 'repo',
      status: 'CONNECTED',
      lastSyncedAt: '2026-10-03T07:00:00Z',
    };
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(connection)));
    const result = await client.callTool({ name: 'get_github_integration', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(connection, null, 2) }]);
  });
  it('passes issue filters using the API contract and renders actual issue numbers and links', async () => {
    const mock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              issueNumber: 12,
              title: 'Source indexing',
              state: 'open',
              htmlUrl: 'https://github.com/owner/repo/issues/12',
            },
          ],
          total: 1,
        }),
      ),
    );
    const result = await client.callTool({
      name: 'list_github_issues',
      arguments: { search: 'indexing', state: 'open', limit: 10 },
    });
    const url = new URL(String(mock.mock.calls[0]?.[0]));
    expect(url.searchParams.get('q')).toBe('indexing');
    expect(url.searchParams.has('search')).toBe(false);
    expect(url.searchParams.get('state')).toBe('open');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([
      {
        type: 'text',
        text: 'Found 1 synchronized GitHub issue(s):\n- [#12] (open) "Source indexing" — https://github.com/owner/repo/issues/12',
      },
    ]);
  });
  it('reports upstream failures rather than a disconnected state', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ message: 'Permission denied' }), { status: 403 }),
      );
    const result = await client.callTool({ name: 'get_github_integration', arguments: {} });
    expect(result.isError).toBe(true);
  });
});
