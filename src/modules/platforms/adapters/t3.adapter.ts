import { OAuthError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { t3ThreadUrl } from '../t3-thread-url';
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  auth,
  OAuthClientProvider,
  UnauthorizedError,
} from '@modelcontextprotocol/sdk/client/auth.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  PlatformAdapter,
  PlatformEntitiesResult,
  PlatformHealthCheckResult,
  SingleEntityResult,
} from './platform-adapter.interface';
import {
  PlatformConnection,
  PlatformConnectionStatus,
  PlatformType,
} from '../entities/platform-connection.entity';
import { ExternalEntityType } from '../entities/external-link.entity';
import { platformFetch, platformUrl, records } from '../platform-http';

export const T3_CAPABILITIES = ['read_workspaces', 'read_threads', 'read_runs'];
export const T3_MIN_API_VERSION = 'mcp-read-v1';
interface Credentials {
  frontendOrigin?: string;
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  verifier?: string;
  state?: string;
  expires?: number;
}

/** Read access is the default; execution requires a separate supervised OAuth grant. */
@Injectable()
export class T3Adapter implements PlatformAdapter {
  readonly platformType = PlatformType.T3;
  private readonly environments = new Map<
    string,
    { expires: number; value: Promise<string | null> }
  >();
  async threadUrl(baseUrl: string, threadId: string | null) {
    if (!threadId) return null;
    const origin = platformUrl(baseUrl).origin;
    let entry = this.environments.get(origin);
    if (!entry || entry.expires < Date.now()) {
      const value = fetch(new URL('/.well-known/t3/environment', origin), {
        signal: AbortSignal.timeout(3000),
        redirect: 'error',
      })
        .then(async (response) => {
          if (!response.ok) return null;
          const body = (await response.json()) as { environmentId?: unknown };
          return typeof body.environmentId === 'string' && /^[\w-]{1,100}$/.test(body.environmentId)
            ? body.environmentId
            : null;
        })
        .catch(() => null);
      entry = { expires: Date.now() + 60000, value };
      this.environments.set(origin, entry);
    }
    return t3ThreadUrl(origin, await entry.value, threadId);
  }
  constructor(
    @InjectRepository(PlatformConnection)
    private readonly connections: Repository<PlatformConnection>,
  ) {}
  private endpoint(connection: PlatformConnection): URL {
    return new URL('/mcp', platformUrl(connection.baseUrl));
  }
  private provider(
    connection: PlatformConnection,
    interactive = false,
    frontendOrigin?: string,
  ): {
    provider: OAuthClientProvider;
    redirect: () => string | undefined;
    credentials: Credentials;
  } {
    let credentials: Credentials;
    try {
      credentials = connection.authToken ? (JSON.parse(connection.authToken) as Credentials) : {};
    } catch {
      throw new BadRequestException('T3 requires OAuth. Reconnect this installation.');
    }
    if (interactive && frontendOrigin && credentials.frontendOrigin !== frontendOrigin) {
      delete credentials.client;
      credentials.frontendOrigin = frontendOrigin;
    }
    let redirect: string | undefined;
    const persist = async () => {
      connection.authToken = JSON.stringify(credentials);
      await this.connections.update(connection.id, { authToken: connection.authToken });
    };
    const callbackOrigin =
      credentials.frontendOrigin ??
      process.env.PLATFORM_OAUTH_CALLBACK_ORIGIN ??
      `http://localhost:${process.env.PORT || '43101'}`;
    const callback = `${callbackOrigin}/api/v1/platforms/connections/${connection.id}/oauth/callback`;
    const provider: OAuthClientProvider = {
      redirectUrl: callback,
      clientMetadata: {
        client_name: 'OSCAR platform connection',
        redirect_uris: [callback],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: this.scopes(connection),
      },
      state: () => credentials.state || '',
      clientInformation: () => credentials.client,
      saveClientInformation: async (client) => {
        credentials.client = client;
        await persist();
      },
      tokens: () => credentials.tokens,
      saveTokens: async (tokens) => {
        if (
          tokens.scope
            ?.split(' ')
            .some(
              (scope) =>
                !this.scopes(connection).split(' ').concat('offline_access').includes(scope),
            )
        )
          throw new UnauthorizedException('T3 granted unexpected permissions. Reauthorize.');
        credentials.tokens = tokens;
        await persist();
      },
      redirectToAuthorization: (url) => {
        if (!interactive) throw new UnauthorizedException('Authorize T3 in platform settings.');
        platformUrl(url.origin);
        redirect = url.toString();
      },
      saveCodeVerifier: async (verifier) => {
        credentials.verifier = verifier;
        await persist();
      },
      codeVerifier: () => {
        if (!credentials.verifier)
          throw new UnauthorizedException('Authorization expired. Reconnect.');
        return credentials.verifier;
      },
    };
    return { provider, redirect: () => redirect, credentials };
  }
  private scopes(connection: PlatformConnection): string {
    return connection.metadata?.t3Access === 'supervised'
      ? 'orchestration:read orchestration:operate'
      : 'orchestration:read';
  }
  requireExecution(connection: PlatformConnection): void {
    const credentials = this.provider(connection).credentials;
    if (
      connection.metadata?.t3Access !== 'supervised' ||
      !credentials.tokens?.scope?.split(' ').includes('orchestration:operate')
    )
      throw new UnauthorizedException('Authorize supervised T3 access in Connections first.');
  }
  async launch(
    connection: PlatformConnection,
    projectId: string,
    title: string,
    message: string,
    modelSelection: { provider: string; instanceId: string; model: string } | null = null,
  ) {
    this.requireExecution(connection);
    return this.withClient(connection, (client) =>
      this.read(client, 't3_thread_launch', {
        projectId,
        title,
        message: `You are T3, executing a task handed off by OSCAR. Any wording such as "use T3" refers to this execution, which is already running in T3. Complete the task directly in this thread. Do not invoke T3 orchestration tools, create other threads, or delegate to other agents for this handoff. Follow the user's task constraints and the supervised runtime's approval requirements.\n\nUser task:\n${message}`,
        runtimeMode: 'approval-required',
        interactionMode: 'default',
        ...(modelSelection ? { modelSelection } : {}),
      }),
    );
  }
  async readThread(connection: PlatformConnection, threadId: string, afterPosition?: number) {
    this.requireExecution(connection);
    return this.withClient(connection, (client) =>
      this.read(client, 't3_thread_read', {
        threadId,
        view: 'messages',
        limit: 100,
        runLimit: 50,
        maxCharsPerItem: 50000,
        ...(afterPosition === undefined ? {} : { afterPosition }),
      }),
    );
  }
  async interrupt(connection: PlatformConnection, threadId: string) {
    this.requireExecution(connection);
    return this.withClient(connection, (client) =>
      this.read(client, 't3_thread_interrupt', { threadId }),
    );
  }
  async findHandoffThread(connection: PlatformConnection, projectId: string, title: string) {
    return this.withClient(connection, async (client) => {
      const page = await this.read(client, 't3_thread_list', { projectId, limit: 100 });
      const matches = records(page, 'threads').filter((row) => row.title === title);
      return matches.length === 1 ? matches[0] : null;
    });
  }
  async models(connection: PlatformConnection) {
    return this.withClient(connection, async (client) => {
      const capabilities = await this.read(client, 'orchestrator_capabilities', {});
      return records(capabilities, 'providers').flatMap((provider) => {
        if (
          !Array.isArray(provider.models) ||
          (Array.isArray(provider.constraints) && provider.constraints.length)
        )
          return [];
        return (provider.models as Array<Record<string, unknown>>)
          .filter((model) => typeof model.id === 'string')
          .map((model) => ({
            provider: String(provider.driverKind),
            instanceId: String(provider.providerInstanceId),
            model: String(model.id),
            label: `${String(provider.displayName)} · ${String(model.label ?? model.id)}`,
          }));
      });
    });
  }
  async startAuthorization(
    connection: PlatformConnection,
    frontendOrigin?: string,
  ): Promise<{ authorizationUrl: string }> {
    const state = this.provider(connection, true, frontendOrigin);
    // Authorize is an explicit reconnect, including when a previous consent granted
    // only read access to a connection configured for supervised work.
    delete state.credentials.tokens;
    delete state.credentials.verifier;
    state.credentials.state = randomUUID();
    state.credentials.expires = Date.now() + 10 * 60_000;
    connection.authToken = JSON.stringify(state.credentials);
    await this.connections.update(connection.id, { authToken: connection.authToken });
    const result = await auth(state.provider, {
      serverUrl: this.endpoint(connection),
      scope: this.scopes(connection),
      fetchFn: platformFetch,
    });
    const authorizationUrl = state.redirect();
    if (result !== 'REDIRECT' || !authorizationUrl)
      throw new BadRequestException('T3 authorization could not start.');
    return { authorizationUrl };
  }
  async completeAuthorization(
    connection: PlatformConnection,
    code: string,
    expectedState: string,
  ): Promise<string | undefined> {
    const { provider, credentials } = this.provider(connection);
    if (
      !credentials.state ||
      credentials.state !== expectedState ||
      !credentials.expires ||
      credentials.expires < Date.now()
    )
      throw new UnauthorizedException('Authorization expired or invalid.');
    // Consume the callback before exchange; a failed exchange requires a new sign-in.
    delete credentials.state;
    delete credentials.expires;
    await this.connections.update(connection.id, { authToken: JSON.stringify(credentials) });
    const result = await auth(provider, {
      serverUrl: this.endpoint(connection),
      authorizationCode: code,
      scope: this.scopes(connection),
      fetchFn: platformFetch,
    });
    if (result !== 'AUTHORIZED')
      throw new UnauthorizedException('T3 authorization was not completed.');
    return credentials.frontendOrigin;
  }
  private async withClient<T>(
    connection: PlatformConnection,
    read: (client: Client) => Promise<T>,
  ): Promise<T> {
    const { provider } = this.provider(connection);
    if (!(await provider.tokens()))
      throw new UnauthorizedException('Authorize T3 in platform settings.');
    const client = new Client({ name: 'oscar-platform-reader', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(this.endpoint(connection), {
      authProvider: provider,
      fetch: platformFetch,
      reconnectionOptions: {
        maxRetries: 0,
        initialReconnectionDelay: 100,
        maxReconnectionDelay: 100,
        reconnectionDelayGrowFactor: 1,
      },
    });
    try {
      await client.connect(transport, { timeout: 8000 });
      return await read(client);
    } finally {
      await client.close();
    }
  }
  private async read(
    client: Client,
    name:
      | 't3_project_list'
      | 't3_thread_list'
      | 't3_thread_launch'
      | 't3_thread_read'
      | 't3_thread_interrupt'
      | 'orchestrator_capabilities',
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 8000 });
    if (result.isError)
      throw new BadRequestException('T3 denied the operation or returned an unsupported response.');
    if (result.structuredContent) return result.structuredContent as Record<string, unknown>;
    const blocks = result.content as Array<{ type: string; text?: string }>;
    const text = blocks.find((block) => block.type === 'text')?.text;
    if (!text) throw new BadRequestException('T3 response contract changed.');
    return JSON.parse(text) as Record<string, unknown>;
  }
  async checkHealth(connection: PlatformConnection): Promise<PlatformHealthCheckResult> {
    try {
      await this.withClient(connection, async (client) => {
        const tools = await client.listTools({}, { timeout: 8000 });
        if (
          !['t3_project_list', 't3_thread_list'].every((name) =>
            tools.tools.some((tool) => tool.name === name),
          )
        )
          throw new BadRequestException('T3 read tools changed.');
        records(await this.read(client, 't3_project_list', { limit: 1 }), 'projects');
      });
      return {
        status: PlatformConnectionStatus.HEALTHY,
        capabilities: T3_CAPABILITIES,
        versionInfo: { apiVersion: T3_MIN_API_VERSION, versionDrift: false },
      };
    } catch (error) {
      return {
        status:
          error instanceof UnauthorizedException ||
          error instanceof UnauthorizedError ||
          (error instanceof StreamableHTTPError && [401, 403].includes(error.code || 0)) ||
          (error instanceof OAuthError &&
            ['invalid_grant', 'invalid_token', 'unauthorized_client'].includes(error.errorCode))
            ? PlatformConnectionStatus.REVOKED
            : PlatformConnectionStatus.DEGRADED,
        capabilities: [],
        versionInfo: { versionDrift: error instanceof BadRequestException },
        error: 'T3 needs authorization, is unavailable, or its read contract changed.',
      };
    }
  }
  async fetchEntities(connection: PlatformConnection): Promise<PlatformEntitiesResult> {
    return this.withClient(connection, async (client) => {
      const data = {
        workspaces: [] as Array<{ id: string; name: string; path?: string }>,
        threads: [] as Array<{ id: string; title: string; status: string; url: string }>,
        runs: [] as Array<{ id: string; threadId: string; status: string; url: string }>,
      };
      const projectResult = await this.read(client, 't3_project_list', { limit: 100 });
      const projects = records(projectResult, 'projects');
      if (projects.length > 12)
        throw new BadRequestException(
          'This snapshot supports up to 12 T3 projects. Narrow access in the T3 connection.',
        );
      if (projectResult.nextCursor != null)
        throw new BadRequestException('This installation exceeds the 100-project snapshot limit.');
      await Promise.all(
        projects.map(async (project) => {
          const id = String(project.id);
          data.workspaces.push({ id, name: String(project.title ?? project.name ?? id) });
          const page = await this.read(client, 't3_thread_list', { projectId: id, limit: 100 });
          if (page.nextCursor != null)
            throw new BadRequestException('Project exceeds the 100-thread snapshot limit.');
          for (const item of records(page, 'threads')) {
            const threadId = String(item.threadId),
              url =
                (await this.threadUrl(connection.baseUrl, threadId)) ??
                platformUrl(connection.baseUrl).origin;
            data.threads.push({
              id: threadId,
              title: String(item.title),
              status: String(item.status),
              url,
            });
            if (item.latestRunId)
              data.runs.push({
                id: String(item.latestRunId),
                threadId,
                status: String(item.status),
                url,
              });
          }
        }),
      );
      return { type: PlatformType.T3, data };
    });
  }
  async fetchEntity(
    connection: PlatformConnection,
    entityType: ExternalEntityType,
    externalId: string,
  ): Promise<SingleEntityResult> {
    const result = await this.fetchEntities(connection);
    if (result.type !== PlatformType.T3) throw new BadRequestException('Wrong platform.');
    const rows =
      entityType === ExternalEntityType.THREAD
        ? result.data.threads
        : entityType === ExternalEntityType.RUN
          ? result.data.runs
          : entityType === ExternalEntityType.WORKSPACE
            ? result.data.workspaces
            : [];
    const row = rows.find((item) => item.id === externalId);
    return {
      found: !!row,
      accessible: !!row,
      entityType,
      id: externalId,
      title: row
        ? 'title' in row
          ? row.title
          : 'name' in row
            ? row.name
            : externalId
        : 'Record unavailable',
      url: row && 'url' in row ? row.url : platformUrl(connection.baseUrl).origin,
    };
  }
}
