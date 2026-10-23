const { OscarMcpServer } = require('../dist/mcp/oscar-mcp-server.js');

async function test() {
  const mcp = new OscarMcpServer({
    apiUrl: 'http://localhost:43101/api/v1',
    apiKey: 'test-key',
    defaultProjectIdOrKey: 'AIW',
  });

  console.log('MCP Server created successfully.');
  const tools = mcp.server._registeredTools || {};
  console.log('Tools count:', Object.keys(tools).length);
  console.log('Tools list:');
  Object.keys(tools).forEach((t, i) => console.log(`  ${i + 1}. ${t}`));

  const resources = mcp.server._registeredResources || {};
  console.log('Resources count:', Object.keys(resources).length);
  console.log('Resources list:');
  Object.keys(resources).forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
}

test().catch(console.error);
