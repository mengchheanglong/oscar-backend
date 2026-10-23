import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { OscarMcpServer } from '../../src/mcp/oscar-mcp-server';
describe('Connected workspace skill access', () => {
  it('lists summaries, then reads permissioned guidance through OSCAR without exposing the token', async () => {
    const mcp = new OscarMcpServer({
      apiUrl: 'http://localhost/api/v1',
      apiKey: 'synthetic-private-token',
    });
    const client = new Client({ name: 'skill-consumer', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.server.connect(b), client.connect(a)]);
    const id = '32ce48cc-4803-44fe-9a7d-e607dfaa252f';
    const fetch = jest.spyOn(global, 'fetch').mockImplementation(
      async (url) =>
        new Response(
          JSON.stringify({
            data: String(url).endsWith('/skills')
              ? [{ id, slug: 'qa' }]
              : { id, instructions: 'Verify outcomes.' },
          }),
        ),
    );
    try {
      const listed = await client.callTool({ name: 'list_skills', arguments: {} });
      expect(listed.isError).not.toBe(true);
      const read = await client.callTool({ name: 'get_skill', arguments: { skillId: id } });
      expect(JSON.stringify(read)).toContain('Verify outcomes.');
      expect(fetch.mock.calls.map((c) => String(c[0]))).toEqual([
        'http://localhost/api/v1/skills',
        `http://localhost/api/v1/skills/${id}`,
      ]);
      expect(JSON.stringify([listed, read])).not.toContain('synthetic-private-token');
    } finally {
      await client.close();
      await mcp.server.close();
      jest.restoreAllMocks();
    }
  });
});
