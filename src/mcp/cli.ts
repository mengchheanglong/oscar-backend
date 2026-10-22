import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { OscarMcpServer } from './oscar-mcp-server';

async function main() {
  const apiUrl =
    process.env.OSCAR_API_URL || process.env.AI_WORKSPACE_API_URL || 'http://localhost:3001/api/v1';
  const apiKey = process.env.OSCAR_API_KEY || process.env.AI_WORKSPACE_API_KEY;
  const defaultProjectIdOrKey = process.env.OSCAR_PROJECT_ID || process.env.AI_WORKSPACE_PROJECT_ID;

  if (!apiKey) {
    console.error(
      'Error: OSCAR_API_KEY is required.\n' +
        'Generate a Personal Access Token in your OSCAR web app (Integrations > Coding Agent & MCP),\n' +
        'then set the OSCAR_API_KEY environment variable in your Claude Code or Cursor config.',
    );
    process.exit(1);
  }

  const oscarServer = new OscarMcpServer({
    apiUrl,
    apiKey,
    defaultProjectIdOrKey,
  });

  const transport = new StdioServerTransport();

  process.stderr.write(
    `[OSCAR-MCP] Server starting via stdio transport (API: ${apiUrl}, Project: ${defaultProjectIdOrKey || 'auto-detect'})...\n`,
  );

  await oscarServer.server.connect(transport);
  process.stderr.write('[OSCAR-MCP] Connected and ready to handle agent requests.\n');
}

main().catch((err) => {
  console.error('[OSCAR-MCP] Fatal error:', err);
  process.exit(1);
});
