import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { OscarMcpServer } from '../../src/mcp/oscar-mcp-server';

describe('MCP document and source-backed assistant workflow', () => {
  const project = 'b1d36bef-525b-4a07-a6b5-cedd806969fc';
  const conversation = '32ce48cc-4803-44fe-9a7d-e607dfaa252f';
  async function connected() {
    const server = new OscarMcpServer({
      apiUrl: 'http://localhost/api/v1',
      apiKey: 'synthetic-secret',
      defaultProjectIdOrKey: project,
    });
    const client = new Client({ name: 'workflow-test', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.server.connect(b), client.connect(a)]);
    return { server, client };
  }
  afterEach(() => jest.restoreAllMocks());
  it('uploads text without reading arbitrary files and preserves multipart authentication', async () => {
    const { server, client } = await connected();
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { id: conversation, processingStatus: 'PENDING' } })),
      );
    try {
      const result = await client.callTool({
        name: 'upload_document_text',
        arguments: { title: 'Business plan', filename: 'plan.md', content: '# Original brief' },
      });
      expect(result.isError).not.toBe(true);
      const [url, request] = fetch.mock.calls[0]!;
      expect(String(url)).toBe(`http://localhost/api/v1/projects/${project}/documents`);
      expect((request!.headers as Record<string, string>).Authorization).toBe(
        'Bearer synthetic-secret',
      );
      expect((request!.headers as Record<string, string>)['Content-Type']).toBeUndefined();
      const form = request!.body as FormData;
      expect(await (form.get('file') as Blob).text()).toBe('# Original brief');
      const rejected = await client.callTool({
        name: 'upload_document_text',
        arguments: { title: 'Invalid', filename: '../../secret.md', content: 'data' },
      });
      expect(rejected.isError).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toContain('synthetic-secret');
    } finally {
      await client.close();
      await server.server.close();
    }
  });
  it('scopes chat routes, enables all permitted references and forwards stable retry identities', async () => {
    const { server, client } = await connected();
    const fetch = jest.spyOn(global, 'fetch').mockImplementation(
      async (url) =>
        new Response(
          JSON.stringify(
            String(url).endsWith('/messages')
              ? {
                  userMessage: { id: 'u' },
                  assistantMessage: { id: 'a', citations: [], evidenceSnapshot: { items: [] } },
                }
              : { id: conversation },
          ),
        ),
    );
    try {
      await client.callTool({
        name: 'create_assistant_conversation',
        arguments: { title: 'Review' },
      });
      const args = {
        conversationId: conversation,
        clientRequestId: conversation,
        content: 'Refine this plan.',
      };
      await client.callTool({ name: 'ask_assistant', arguments: args });
      await client.callTool({ name: 'ask_assistant', arguments: args });
      const body = JSON.parse(fetch.mock.calls[1]![1]!.body as string);
      expect(body).toEqual({
        content: args.content,
        clientRequestId: conversation,
        includeKnowledge: true,
        knowledgeScope: 'all',
      });
      expect(fetch.mock.calls[1]![1]!.body).toBe(fetch.mock.calls[2]![1]!.body);
      expect(String(fetch.mock.calls[1]![0])).toBe(
        `http://localhost/api/v1/projects/${project}/ai/conversations/${conversation}/messages`,
      );
      expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).includeAllWorkspaces).toBe(false);
    } finally {
      await client.close();
      await server.server.close();
    }
  });
  it('propagates API permission denial without impersonating another user', async () => {
    const { server, client } = await connected();
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ message: 'Conversation not found' }), { status: 404 }),
      );
    try {
      const result = await client.callTool({
        name: 'get_assistant_messages',
        arguments: { conversationId: conversation },
      });
      expect(result.isError).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toContain('synthetic-secret');
    } finally {
      await client.close();
      await server.server.close();
    }
  });
});
