import { T3Adapter } from '../../src/modules/platforms/adapters/t3.adapter';
import { PlatformConnection } from '../../src/modules/platforms/entities/platform-connection.entity';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

describe('T3 execution consent', () => {
  const adapter = new T3Adapter(null!);
  function connection(mode: string, scope: string) {
    return {
      id: 'fixture',
      metadata: { t3Access: mode },
      authToken: JSON.stringify({
        tokens: { access_token: 'synthetic', token_type: 'Bearer', scope },
      }),
    } as unknown as PlatformConnection;
  }
  it('requires both supervised configuration and an actual operate grant', () => {
    expect(() =>
      adapter.requireExecution(connection('read', 'orchestration:read orchestration:operate')),
    ).toThrow('supervised');
    expect(() => adapter.requireExecution(connection('supervised', 'orchestration:read'))).toThrow(
      'supervised',
    );
    expect(() =>
      adapter.requireExecution(
        connection('supervised', 'orchestration:read orchestration:operate'),
      ),
    ).not.toThrow();
  });
  it('launches supervised work with an explicit model and prevents recursive routing', async () => {
    const callTool = jest
      .fn()
      .mockResolvedValue({ structuredContent: { threadId: 'mcp:fixture' } });
    const internals = adapter as unknown as {
      withClient: (
        connection: PlatformConnection,
        action: (client: Client) => Promise<unknown>,
      ) => Promise<unknown>;
    };
    jest
      .spyOn(internals, 'withClient')
      .mockImplementation(async (_connection, action) => action({ callTool } as unknown as Client));
    await adapter.launch(
      connection('supervised', 'orchestration:read orchestration:operate'),
      'project',
      'Review',
      'Use T3 to review this function.',
      { provider: 'codex', instanceId: 'codex', model: 'fixture-model' },
    );
    const request = callTool.mock.calls[0][0];
    expect(request.name).toBe('t3_thread_launch');
    expect(request.arguments.runtimeMode).toBe('approval-required');
    expect(request.arguments.modelSelection.model).toBe('fixture-model');
    expect(request.arguments.message).toContain('already running in T3');
    expect(request.arguments.message).toContain('User task:\nUse T3 to review this function.');
  });
});
