import { OscarMcpServer } from '../../src/mcp/oscar-mcp-server';

describe('OscarMcpServer', () => {
  let mcp: OscarMcpServer;

  beforeEach(() => {
    mcp = new OscarMcpServer({
      apiUrl: 'http://localhost:43101/api/v1',
      apiKey: 'aiw_pat_mocktesttoken123456789',
      defaultProjectIdOrKey: 'AIW',
    });
  });

  it('instantiates McpServer with server name and tools registered', () => {
    expect(mcp).toBeDefined();
    expect(mcp.server).toBeDefined();
  });

  it('correctly parses task key numbers for resolving tasks', () => {
    const extractFn = (
      mcp as unknown as { extractNumberFromKey: (key: string, prefix: string) => number | null }
    ).extractNumberFromKey.bind(mcp);
    expect(extractFn('AIW-TSK-38', 'TSK')).toBe(38);
    expect(extractFn('TSK-105', 'TSK')).toBe(105);
    expect(extractFn('42', 'TSK')).toBe(42);
    expect(extractFn('invalid', 'TSK')).toBeNull();
    expect(extractFn('junk-42-tail', 'TSK')).toBeNull();
    expect(extractFn('AIW-TASK-38', '(?:TSK|TASK)')).toBe(38);
  });

  it('correctly parses decision key numbers for resolving ADRs', () => {
    const extractFn = (
      mcp as unknown as { extractNumberFromKey: (key: string, prefix: string) => number | null }
    ).extractNumberFromKey.bind(mcp);
    expect(extractFn('AIW-DEC-1', 'DEC')).toBe(1);
    expect(extractFn('DEC-12', 'DEC')).toBe(12);
    expect(extractFn('3', 'DEC')).toBe(3);
    expect(extractFn('something-else', 'DEC')).toBeNull();
  });
});
