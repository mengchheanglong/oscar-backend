import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AiwMcpServer } from '../../src/mcp/aiw-mcp-server';

describe('MCP private copilot memory', () => {
  let client: Client;
  let mcp: AiwMcpServer;
  const projectId = '2715f920-f86f-475e-864e-85862d8d64d7';
  const memoryId = '1942f626-7033-4d3b-b400-a571620738e5';
  const key = '827585ab-aa80-4b18-aa25-df620ecbb0ef';
  beforeEach(async () => {
    mcp = new AiwMcpServer({
      apiUrl: 'http://localhost/api/v1',
      apiKey: 'test',
      defaultProjectIdOrKey: projectId,
    });
    client = new Client({ name: 'memory-test', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.server.connect(b), client.connect(a)]);
  });
  afterEach(async () => {
    await client.close();
    await mcp.server.close();
    jest.restoreAllMocks();
  });

  it('rejects an unconfirmed save before contacting the application', async () => {
    const fetch = jest.spyOn(global, 'fetch');
    const result = await client.callTool({
      name: 'save_copilot_memory',
      arguments: { kind: 'CONTEXT', content: 'A goal', idempotencyKey: key, userConfirmed: false },
    });
    expect(result.isError).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('passes the authenticated project scope and unchanged retry identity to the normal API', async () => {
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockImplementation(
        async () => new Response(JSON.stringify({ data: { id: memoryId, version: 1 } })),
      );
    const args = {
      kind: 'LESSON',
      content: 'Verify assumptions.',
      idempotencyKey: key,
      userConfirmed: true,
    };
    for (let i = 0; i < 2; i++) {
      const result = await client.callTool({ name: 'save_copilot_memory', arguments: args });
      expect(result.isError).not.toBe(true);
    }
    for (const [url, options] of fetch.mock.calls) {
      expect(String(url)).toBe(`http://localhost/api/v1/projects/${projectId}/ai/memories`);
      expect(JSON.parse(options!.body as string)).toEqual(args);
    }
  });

  it('carries the expected version on removal and propagates permission failures', async () => {
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Project not found.' } }), { status: 404 }),
      );
    const result = await client.callTool({
      name: 'remove_copilot_memory',
      arguments: { memoryId, version: 2, userConfirmed: true },
    });
    expect(result.isError).toBe(true);
    expect(String(fetch.mock.calls[0]![0])).toContain(`/${memoryId}?version=2`);
    expect(fetch.mock.calls[0]![1]?.method).toBe('DELETE');
  });
});
