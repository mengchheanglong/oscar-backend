import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  PlatformAdapter,
  PlatformHealthCheckResult,
  PlatformEntitiesResult,
  SingleEntityResult,
} from './platform-adapter.interface';
import {
  PlatformConnection,
  PlatformConnectionStatus,
  PlatformType,
} from '../entities/platform-connection.entity';
import { ExternalEntityType } from '../entities/external-link.entity';
import {
  platformFetch,
  platformJson,
  platformUrl,
  PlatformReadError,
  records,
} from '../platform-http';

export const PAPERCLIP_CAPABILITIES = ['read_agents', 'read_issues'];
export const PAPERCLIP_MIN_API_VERSION = 'company-rest';

/** Company-scoped activity reads; assigned issue execution is explicitly opt-in. */
@Injectable()
export class PaperclipAdapter implements PlatformAdapter {
  readonly platformType = PlatformType.PAPERCLIP;
  private origin(connection: PlatformConnection): string {
    return platformUrl(connection.baseUrl).origin;
  }
  private company(connection: PlatformConnection): string {
    const company = connection.metadata?.companyId;
    if (typeof company !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(company))
      throw new BadRequestException('Set the Paperclip company ID before connecting.');
    return encodeURIComponent(company);
  }
  private async request(
    connection: PlatformConnection,
    path: string,
    method = 'GET',
    body?: unknown,
  ): Promise<unknown> {
    const response = await platformFetch(`${this.origin(connection)}/api/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${connection.authToken}`,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok)
      throw new PlatformReadError(
        response.status,
        `Paperclip operation failed (${response.status}).`,
      );
    const reader = response.body?.getReader();
    if (!reader) throw new BadRequestException('Paperclip returned no response.');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.length;
        if (bytes > 1048576)
          throw new BadRequestException('Paperclip response exceeds the supported size.');
        chunks.push(next.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }
  requireExecution(connection: PlatformConnection) {
    if (connection.metadata?.paperclipAccess !== 'supervised' || !connection.authToken)
      throw new BadRequestException(
        'Enable Paperclip execution and configure an authorized token in Connections.',
      );
    this.company(connection);
  }
  async executionTargets(connection: PlatformConnection) {
    this.requireExecution(connection);
    const company = this.company(connection);
    const [agents, projects] = await Promise.all([
      this.request(connection, `companies/${company}/agents`),
      this.request(connection, `companies/${company}/projects`),
    ]);
    return {
      agents: records(agents, 'agents')
        .filter(
          (a) => !['paused', 'terminated', 'error', 'pending_approval'].includes(String(a.status)),
        )
        .map((a) => ({ id: String(a.id), name: String(a.name ?? a.id), status: String(a.status) })),
      projects: records(projects, 'projects').map((p) => ({
        id: String(p.id),
        name: String(p.name ?? p.id),
      })),
    };
  }
  async launch(
    connection: PlatformConnection,
    id: string,
    title: string,
    prompt: string,
    agentId: string,
    projectId?: string | null,
  ) {
    this.requireExecution(connection);
    return this.request(connection, `companies/${this.company(connection)}/issues`, 'POST', {
      title,
      description: `Task handed off by OSCAR. Complete this assigned issue using Paperclip's normal workflow, then post a final result comment and mark it done. User task:\n\n${prompt}`,
      status: 'todo',
      assigneeAgentId: agentId,
      ...(projectId ? { projectId } : {}),
      idempotencyKey: `oscar:${id}`,
    }) as Promise<Record<string, unknown>>;
  }
  async findHandoffIssue(connection: PlatformConnection, agentId: string, title: string) {
    const page = await this.request(
      connection,
      `companies/${this.company(connection)}/issues?assigneeAgentId=${encodeURIComponent(agentId)}`,
    );
    const matches = records(page, 'issues').filter((i) => i.title === title);
    return matches.length === 1 ? matches[0] : null;
  }
  async readIssue(connection: PlatformConnection, issueId: string, companyId: string) {
    this.requireExecution(connection);
    const issue = (await this.request(
      connection,
      `issues/${encodeURIComponent(issueId)}`,
    )) as Record<string, unknown>;
    if (issue.id !== issueId || issue.companyId !== companyId)
      throw new BadRequestException('Paperclip issue scope changed.');
    return issue;
  }
  async resultComments(
    connection: PlatformConnection,
    issueId: string,
    companyId: string,
    agentId: string,
  ) {
    await this.readIssue(connection, issueId, companyId);
    const page = await this.request(
      connection,
      `issues/${encodeURIComponent(issueId)}/comments?order=desc&limit=100`,
    );
    const comments = records(page, 'comments').filter(
      (c) =>
        c.issueId === issueId &&
        c.companyId === companyId &&
        c.authorAgentId === agentId &&
        typeof c.body === 'string' &&
        c.body.trim(),
    );
    comments.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return comments[0] ? String(comments[0].body) : null;
  }
  async cancelIssue(
    connection: PlatformConnection,
    issueId: string,
    companyId: string,
    agentId: string,
    requestId: string,
  ) {
    const issue = await this.readIssue(connection, issueId, companyId);
    if (['done', 'cancelled'].includes(String(issue.status))) return;
    if (issue.assigneeAgentId !== agentId)
      throw new BadRequestException('The assignee changed. Manage this task in Paperclip.');
    const runId = issue.executionRunId ?? issue.checkoutRunId;
    if (typeof runId === 'string') {
      const run = (await this.request(
        connection,
        `heartbeat-runs/${encodeURIComponent(runId)}`,
      )) as Record<string, unknown>;
      const context = run.contextSnapshot as Record<string, unknown> | undefined;
      if (
        run.companyId !== companyId ||
        run.agentId !== agentId ||
        (context?.issueId ?? context?.taskId) !== issueId
      )
        throw new BadRequestException(
          'Cannot verify the active Paperclip run. Stop it in Paperclip.',
        );
      if (['queued', 'running'].includes(String(run.status))) {
        try {
          await this.request(
            connection,
            `heartbeat-runs/${encodeURIComponent(runId)}/cancel`,
            'POST',
            { cancellationRequestId: requestId },
          );
        } catch (error) {
          if (error instanceof PlatformReadError && error.remoteStatus === 403)
            throw new ForbiddenException(
              'Paperclip board authorization is required to stop active runs. Open the issue in Paperclip.',
            );
          throw error;
        }
      }
    }
    await this.request(connection, `issues/${encodeURIComponent(issueId)}`, 'PATCH', {
      status: 'cancelled',
    });
  }
  async checkHealth(connection: PlatformConnection): Promise<PlatformHealthCheckResult> {
    try {
      records(
        await platformJson(
          `${this.origin(connection)}/api/companies/${this.company(connection)}/agents`,
          connection.authToken,
        ),
        'agents',
      );
      return {
        status: PlatformConnectionStatus.HEALTHY,
        capabilities: PAPERCLIP_CAPABILITIES,
        versionInfo: {
          apiVersion: 'company-rest',
          platformVersion: 'paperclip',
          versionDrift: false,
          detectedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      return {
        status:
          error instanceof PlatformReadError && [401, 403].includes(error.remoteStatus)
            ? PlatformConnectionStatus.REVOKED
            : PlatformConnectionStatus.DEGRADED,
        capabilities: [],
        versionInfo: {
          versionDrift:
            error instanceof PlatformReadError && [404, 502].includes(error.remoteStatus),
        },
        error:
          error instanceof BadRequestException
            ? error.message
            : 'Paperclip is unavailable or the connection no longer has read access.',
      };
    }
  }
  async fetchEntities(connection: PlatformConnection): Promise<PlatformEntitiesResult> {
    const origin = this.origin(connection),
      company = this.company(connection);
    const [agents, issues] = await Promise.all([
      platformJson(`${origin}/api/companies/${company}/agents`, connection.authToken),
      platformJson(`${origin}/api/companies/${company}/issues`, connection.authToken),
    ]);
    return {
      type: PlatformType.PAPERCLIP,
      data: {
        agents: records(agents, 'agents').map((a) => ({
          id: String(a.id),
          name: String(a.name ?? a.id),
          status: String(a.status ?? 'unknown'),
          role: typeof a.role === 'string' ? a.role : undefined,
        })),
        teams: [],
        issues: records(issues, 'issues').map((i) => ({
          id: String(i.id),
          title: String(i.title ?? i.id),
          status: String(i.status ?? 'unknown'),
          priority: typeof i.priority === 'string' ? i.priority : undefined,
          assignee: typeof i.assigneeAgentId === 'string' ? i.assigneeAgentId : undefined,
          url: `${origin}/issues/${encodeURIComponent(String(i.identifier ?? i.id))}`,
        })),
      },
    };
  }
  async fetchEntity(
    connection: PlatformConnection,
    entityType: ExternalEntityType,
    externalId: string,
  ): Promise<SingleEntityResult> {
    const snapshot = await this.fetchEntities(connection);
    if (snapshot.type !== PlatformType.PAPERCLIP) throw new BadRequestException('Wrong platform.');
    const rows =
      entityType === ExternalEntityType.AGENT
        ? snapshot.data.agents
        : entityType === ExternalEntityType.ISSUE
          ? snapshot.data.issues
          : [];
    const row = rows.find((r) => r.id === externalId);
    const origin = this.origin(connection);
    return {
      found: !!row,
      accessible: !!row,
      entityType,
      id: externalId,
      title: row ? ('title' in row ? row.title : row.name) : 'Record unavailable',
      url: row && 'url' in row ? row.url : `${origin}/agents/${encodeURIComponent(externalId)}`,
    };
  }
}
