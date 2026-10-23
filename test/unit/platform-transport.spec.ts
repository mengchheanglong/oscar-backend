import { Repository } from 'typeorm';
import { createHash } from 'node:crypto';
import { PaperclipAdapter } from '../../src/modules/platforms/adapters/paperclip.adapter';
import { T3Adapter } from '../../src/modules/platforms/adapters/t3.adapter';
import {
  PlatformConnection,
  PlatformConnectionStatus,
  PlatformType,
} from '../../src/modules/platforms/entities/platform-connection.entity';
import { credentialTransformer } from '../../src/modules/platforms/credential-vault';
import { platformUrl, platformFetch } from '../../src/modules/platforms/platform-http';

const origin = 'https://platform-fixture.example';
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
describe('read-only platform transports', () => {
  let connection: PlatformConnection;
  let adapter: T3Adapter;
  let calls: Array<{
    url: string;
    method: string;
    body: Record<string, unknown>;
    authorization?: string;
  }>;
  beforeEach(() => {
    process.env.PLATFORM_ALLOWED_ORIGINS = origin;
    process.env.PLATFORM_OAUTH_CALLBACK_ORIGIN = 'http://localhost:3001';
    calls = [];
    connection = {
      id: '11111111-1111-4111-8111-111111111111',
      baseUrl: origin,
      platformType: PlatformType.T3,
      metadata: { companyId: 'company-1' },
      authToken: null,
    } as unknown as PlatformConnection;
    adapter = new T3Adapter({
      update: jest.fn(async (_id, patch) => {
        Object.assign(connection, patch);
        return { affected: 1 };
      }),
    } as unknown as Repository<PlatformConnection>);
    jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input),
        method = init?.method || 'GET';
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(String(init?.body));
      } catch {
        body = Object.fromEntries(new URLSearchParams(String(init?.body || '')));
      }
      calls.push({
        url,
        method,
        body,
        authorization: new Headers(init?.headers).get('Authorization') || undefined,
      });
      if (url.endsWith('/.well-known/t3/environment'))
        return response({ environmentId: 'environment-1' });
      if (url.includes('/.well-known/oauth-protected-resource'))
        return response({
          resource: `${origin}/mcp`,
          authorization_servers: [origin],
          scopes_supported: ['orchestration:read'],
        });
      if (url.includes('/.well-known/oauth-authorization-server'))
        return response({
          issuer: origin,
          authorization_endpoint: `${origin}/oauth/authorize`,
          token_endpoint: `${origin}/oauth/token`,
          registration_endpoint: `${origin}/oauth/register`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
          scopes_supported: ['orchestration:read'],
        });
      if (url.endsWith('/oauth/register'))
        return response({ ...body, client_id: 'oscar-test-client' }, 201);
      if (url.endsWith('/oauth/token'))
        return response({
          access_token: 'synthetic-read-token',
          token_type: 'Bearer',
          scope: 'orchestration:read',
          refresh_token: 'synthetic-refresh-token',
        });
      if (url.endsWith('/api/companies/company-1/agents'))
        return response([{ id: 'agent-1', name: 'Research', status: 'running' }]);
      if (url.endsWith('/api/companies/company-1/issues'))
        return response([
          { id: 'issue-1', identifier: 'OSCAR-1', title: 'Verify scope', status: 'in_progress' },
        ]);
      if (url.endsWith('/mcp')) {
        if (method === 'GET') return new Response(null, { status: 405 });
        if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
        let result: unknown;
        if (body.method === 'initialize')
          result = {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'T3 fixture', version: '1' },
          };
        if (body.method === 'tools/list')
          result = {
            tools: ['t3_project_list', 't3_thread_list'].map((name) => ({
              name,
              inputSchema: { type: 'object' },
              annotations: { readOnlyHint: true },
            })),
          };
        if (body.method === 'tools/call') {
          const content =
            (body.params as { name: string }).name === 't3_project_list'
              ? { projects: [{ id: 'project-1', title: 'OSCAR' }], nextCursor: null }
              : {
                  threads: [
                    {
                      threadId: 'thread-1',
                      title: 'Review work',
                      status: 'running',
                      latestRunId: 'run-1',
                    },
                  ],
                  nextCursor: null,
                };
          result = {
            content: [{ type: 'text', text: JSON.stringify(content) }],
            structuredContent: content,
          };
        }
        return response({ jsonrpc: '2.0', id: body.id, result });
      }
      return response({ error: 'unexpected fixture request' }, 404);
    });
  });
  afterEach(() => jest.restoreAllMocks());
  it('uses Paperclip company-scoped REST with bearer authorization and native identifiers', async () => {
    connection.authToken = 'synthetic-paperclip-token';
    const paperclip = new PaperclipAdapter();
    expect((await paperclip.checkHealth(connection)).status).toBe(PlatformConnectionStatus.HEALTHY);
    const entities = await paperclip.fetchEntities(connection);
    expect(entities.type).toBe(PlatformType.PAPERCLIP);
    if (entities.type !== PlatformType.PAPERCLIP) throw Error('Wrong adapter');
    expect(entities.data.issues[0]!.url).toBe(`${origin}/issues/OSCAR-1`);
    expect(
      calls.every(
        (call) =>
          call.method === 'GET' && call.authorization === 'Bearer synthetic-paperclip-token',
      ),
    ).toBe(true);
    expect(calls.some((call) => call.url.includes('/api/v1/'))).toBe(false);
  });
  it('finishes PKCE OAuth, rejects replay, and calls only supported read tools', async () => {
    const { authorizationUrl } = await adapter.startAuthorization(connection);
    const authorize = new URL(authorizationUrl),
      state = authorize.searchParams.get('state')!;
    const stored = JSON.parse(connection.authToken!);
    expect(authorize.searchParams.get('scope')).toBe('orchestration:read');
    expect(authorize.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(stored.verifier).digest('base64url'),
    );
    await expect(
      adapter.completeAuthorization(connection, 'synthetic-code', 'wrong-state'),
    ).rejects.toThrow();
    await adapter.completeAuthorization(connection, 'synthetic-code', state);
    await expect(
      adapter.completeAuthorization(connection, 'synthetic-code', state),
    ).rejects.toThrow();
    expect((await adapter.checkHealth(connection)).status).toBe(PlatformConnectionStatus.HEALTHY);
    const snapshot = await adapter.fetchEntities(connection);
    if (snapshot.type !== PlatformType.T3) throw Error('Wrong adapter');
    expect(snapshot.data.threads[0]).toMatchObject({
      id: 'thread-1',
      status: 'running',
      url: 'https://platform-fixture.example/environment-1/thread-1',
    });
    expect(snapshot.data.runs[0]).toMatchObject({ id: 'run-1', threadId: 'thread-1' });
    const tools = calls
      .filter((call) => call.body?.method === 'tools/call')
      .map((call) => (call.body.params as { name: string }).name);
    expect(tools.every((name) => ['t3_project_list', 't3_thread_list'].includes(name))).toBe(true);
    expect(
      calls.some((call) => call.url.includes('/api/threads') || call.url.includes('/api/runs')),
    ).toBe(false);
  });
  it('does not call T3 without authorization', async () => {
    expect((await adapter.checkHealth(connection)).status).toBe(PlatformConnectionStatus.REVOKED);
    await expect(adapter.fetchEntities(connection)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it('keeps a browser-initiated OAuth callback on the saved OSCAR frontend origin', async () => {
    const { authorizationUrl } = await adapter.startAuthorization(
      connection,
      'http://127.0.0.1:3002',
    );
    const url = new URL(authorizationUrl);
    expect(url.searchParams.get('redirect_uri')).toBe(
      `http://127.0.0.1:3002/api/v1/platforms/connections/${connection.id}/oauth/callback`,
    );
    expect(
      await adapter.completeAuthorization(
        connection,
        'synthetic-code',
        url.searchParams.get('state')!,
      ),
    ).toBe('http://127.0.0.1:3002');
  });
  it('rejects unapproved origins before sending credentials and disables redirects', async () => {
    expect(() => platformUrl('https://unapproved.example')).toThrow();
    expect(() => platformUrl(`${origin}/?token=secret`)).toThrow();
    await expect(platformFetch('https://unapproved.example')).rejects.toThrow();
    expect(calls).toHaveLength(0);
    await platformFetch(`${origin}/api/companies/company-1/agents`);
    expect(fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ redirect: 'error' }),
    );
  });
  it('encrypts credentials at rest and detects tampering', () => {
    const sealed = credentialTransformer.to('synthetic-secret')!;
    expect(sealed).not.toContain('synthetic-secret');
    expect(credentialTransformer.from(sealed)).toBe('synthetic-secret');
    const parts = sealed.split(':');
    parts[2] = Buffer.alloc(16, 3).toString('base64');
    expect(() => credentialTransformer.from(parts.join(':'))).toThrow();
  });
  it('preserves request filters while still enforcing the origin allowlist', async () => {
    const url = `${origin}/api/issues?assigneeAgentId=agent&limit=100`;
    await platformFetch(url);
    expect(calls[0]?.url).toBe(url);
    await expect(
      platformFetch('https://unapproved.example/api/issues?limit=100'),
    ).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
});
