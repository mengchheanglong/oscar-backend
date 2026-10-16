import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AiwMcpServer } from './aiw-mcp-server';

async function main() {
  const apiUrl = process.env.AI_WORKSPACE_API_URL || 'http://localhost:3001/api/v1';
  const apiKey = process.env.AI_WORKSPACE_API_KEY;
  const defaultProjectIdOrKey = process.env.AI_WORKSPACE_PROJECT_ID;

  if (!apiKey) {
    console.error(
      'Error: AI_WORKSPACE_API_KEY is required.\n' +
        'Generate a Personal Access Token in your Continuum web app (Integrations > Coding Agent & MCP),\n' +
        'then set the AI_WORKSPACE_API_KEY environment variable in your Claude Code or Cursor config.',
    );
    process.exit(1);
  }

  const aiwServer = new AiwMcpServer({
    apiUrl,
    apiKey,
    defaultProjectIdOrKey,
  });

  const transport = new StdioServerTransport();

  process.stderr.write(
    `[Continuum-MCP] Server starting via stdio transport (API: ${apiUrl}, Project: ${defaultProjectIdOrKey || 'auto-detect'})...\n`,
  );

  await aiwServer.server.connect(transport);
  process.stderr.write('[Continuum-MCP] Connected and ready to handle agent requests.\n');
}

main().catch((err) => {
  console.error('[Continuum-MCP] Fatal error:', err);
  process.exit(1);
});
