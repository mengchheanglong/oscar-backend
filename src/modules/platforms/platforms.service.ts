import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  PlatformConnection,
  PlatformConnectionStatus,
  PlatformType,
  PlatformAuthType,
} from './entities/platform-connection.entity';
import { ExternalLink } from './entities/external-link.entity';
import { ProjectMember, ProjectRole } from '../projects/entities/project-member.entity';
import { ProjectStatus } from '../projects/entities/project.entity';
import { Goal } from '../goals/entities/goal.entity';
import { PaperclipAdapter } from './adapters/paperclip.adapter';
import { T3Adapter } from './adapters/t3.adapter';
import {
  CreateConnectionDto,
  CreateExternalLinkDto,
  PlatformActivityOverviewDto,
  QueryConnectionsDto,
  QueryExternalLinksDto,
  UpdateConnectionDto,
} from './dto';
import { platformUrl } from './platform-http';

@Injectable()
export class PlatformsService {
  constructor(
    @InjectRepository(PlatformConnection)
    private readonly connectionRepo: Repository<PlatformConnection>,
    @InjectRepository(ExternalLink) private readonly linkRepo: Repository<ExternalLink>,
    @InjectRepository(ProjectMember) private readonly memberRepo: Repository<ProjectMember>,
    @InjectRepository(Goal) private readonly goalRepo: Repository<Goal>,
    private readonly paperclipAdapter: PaperclipAdapter,
    private readonly t3Adapter: T3Adapter,
  ) {}
  private adapter(type: PlatformType) {
    return type === PlatformType.PAPERCLIP ? this.paperclipAdapter : this.t3Adapter;
  }
  private publicConnection(conn: PlatformConnection): PlatformConnection {
    return {
      ...conn,
      healthFresh:
        !!conn.lastHealthCheckAt &&
        Date.now() - new Date(conn.lastHealthCheckAt).getTime() >= 0 &&
        Date.now() - new Date(conn.lastHealthCheckAt).getTime() < 60_000,
      authToken: conn.authToken ? '[configured]' : null,
      user: undefined,
      externalLinks: undefined,
    } as unknown as PlatformConnection;
  }
  private async projectAccess(actorId: string, projectId: string, write = false): Promise<void> {
    const member = await this.memberRepo.findOne({
      where: { projectId, userId: actorId, removedAt: IsNull() },
      relations: ['project'],
    });
    if (!member) throw new ForbiddenException('You are not an active member of this project.');
    if (
      write &&
      (![ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.CONTRIBUTOR].includes(
        member.accessRole,
      ) ||
        member.project?.status === ProjectStatus.ARCHIVED)
    )
      throw new ForbiddenException('This project is read-only for your account.');
  }
  private async owned(actorId: string, id: string, write = false): Promise<PlatformConnection> {
    const connection = await this.connectionRepo.findOne({ where: { id } });
    if (!connection || connection.userId !== actorId)
      throw new NotFoundException('Platform connection not found.');
    if (connection.projectId) await this.projectAccess(actorId, connection.projectId, write);
    return connection;
  }
  async createConnection(actorId: string, dto: CreateConnectionDto): Promise<PlatformConnection> {
    const url = platformUrl(dto.baseUrl);
    if (!['/', '/mcp', '/api'].includes(url.pathname))
      throw new BadRequestException('Use the platform origin or its /mcp endpoint.');
    if (dto.projectId) await this.projectAccess(actorId, dto.projectId, true);
    if (!dto.name.trim()) throw new BadRequestException('Enter a connection name.');
    if (dto.platformType === PlatformType.T3 && dto.authToken)
      throw new BadRequestException('T3 uses OAuth. Save the connection and choose Authorize.');
    const connection = await this.connectionRepo.save(
      this.connectionRepo.create({
        userId: actorId,
        projectId: dto.projectId ?? null,
        platformType: dto.platformType,
        name: dto.name.trim(),
        baseUrl: url.origin,
        authType:
          dto.platformType === PlatformType.T3
            ? PlatformAuthType.OAUTH
            : (dto.authType ?? PlatformAuthType.BEARER),
        authToken: dto.authToken?.trim() || null,
        status: PlatformConnectionStatus.DISCONNECTED,
        capabilities: [],
        versionInfo: {},
        metadata: dto.metadata ?? {},
      }),
    );
    return dto.platformType === PlatformType.T3
      ? this.publicConnection(connection)
      : this.testConnection(actorId, connection.id);
  }
  async listConnections(
    actorId: string,
    query: QueryConnectionsDto,
  ): Promise<{ items: PlatformConnection[]; total: number }> {
    if (query.projectId) await this.projectAccess(actorId, query.projectId);
    const qb = this.connectionRepo
      .createQueryBuilder('conn')
      .leftJoinAndSelect('conn.project', 'project')
      .where('conn.userId = :actorId', { actorId })
      .andWhere(
        '(conn.projectId IS NULL OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = conn.project_id AND pm.user_id = :actorId AND pm.removed_at IS NULL))',
        { actorId },
      );
    if (query.projectId) qb.andWhere('conn.projectId = :projectId', { projectId: query.projectId });
    if (query.platformType)
      qb.andWhere('conn.platformType = :platformType', { platformType: query.platformType });
    if (query.status) qb.andWhere('conn.status = :status', { status: query.status });
    const limit = Math.min(query.limit ?? 50, 100),
      page = query.page ?? 1;
    const [items, total] = await qb
      .orderBy('conn.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return { items: items.map((c) => this.publicConnection(c)), total };
  }
  async getConnection(actorId: string, id: string): Promise<PlatformConnection> {
    return this.publicConnection(await this.owned(actorId, id));
  }
  async updateConnection(
    actorId: string,
    id: string,
    dto: UpdateConnectionDto,
  ): Promise<PlatformConnection> {
    const connection = await this.owned(actorId, id, true);
    if (dto.name !== undefined) {
      if (!dto.name.trim()) throw new BadRequestException('Enter a name.');
      connection.name = dto.name.trim();
    }
    if (dto.baseUrl !== undefined) {
      const origin = platformUrl(dto.baseUrl).origin;
      if (origin !== connection.baseUrl) {
        connection.authToken = null;
        connection.status = PlatformConnectionStatus.DISCONNECTED;
        connection.capabilities = [];
        connection.lastHealthCheckAt = null;
        connection.healthError = null;
      }
      connection.baseUrl = origin;
    }
    if (dto.authToken !== undefined) {
      if (connection.platformType === PlatformType.T3)
        throw new BadRequestException('Use T3 OAuth authorization.');
      connection.authToken = dto.authToken.trim() || null;
      connection.status = PlatformConnectionStatus.DISCONNECTED;
      connection.lastHealthCheckAt = null;
      connection.healthError = null;
      connection.capabilities = [];
    }
    if (dto.metadata !== undefined) {
      if (
        connection.platformType === PlatformType.T3 &&
        dto.metadata.t3Access !== connection.metadata?.t3Access
      ) {
        connection.authToken = null;
        connection.status = PlatformConnectionStatus.DISCONNECTED;
        connection.capabilities = [];
        connection.lastHealthCheckAt = null;
      }
      connection.metadata = dto.metadata;
    }
    await this.connectionRepo.save(connection);
    return this.publicConnection(connection);
  }
  async deleteConnection(actorId: string, id: string): Promise<void> {
    await this.connectionRepo.remove(await this.owned(actorId, id, true));
  }
  async testConnection(actorId: string, id: string): Promise<PlatformConnection> {
    const connection = await this.owned(actorId, id);
    const health = await this.adapter(connection.platformType).checkHealth(connection);
    Object.assign(connection, {
      status: health.status,
      capabilities: health.capabilities,
      versionInfo: health.versionInfo,
      lastHealthCheckAt: new Date(),
      healthError: health.error ?? null,
    });
    // Probe results must not overwrite credentials changed by a concurrent OAuth reconnect.
    await this.connectionRepo.save({
      id: connection.id,
      status: connection.status,
      capabilities: connection.capabilities,
      versionInfo: connection.versionInfo,
      lastHealthCheckAt: connection.lastHealthCheckAt,
      healthError: connection.healthError,
    });
    return this.publicConnection(connection);
  }
  async authorize(
    actorId: string,
    id: string,
    frontendOrigin?: string,
  ): Promise<{ authorizationUrl: string }> {
    const connection = await this.owned(actorId, id, true);
    if (connection.platformType !== PlatformType.T3)
      throw new BadRequestException('This connection uses a Paperclip bearer token.');
    if (frontendOrigin) {
      const configured = process.env.APP_ORIGIN || 'http://localhost:43100';
      const local = ['http://localhost:43100', 'http://127.0.0.1:43100'];
      if (
        frontendOrigin !== configured &&
        !(
          process.env.NODE_ENV !== 'production' &&
          local.includes(configured) &&
          local.includes(frontendOrigin)
        )
      )
        throw new BadRequestException('Use the configured OSCAR origin to authorize T3.');
    }
    return this.t3Adapter.startAuthorization(connection, frontendOrigin);
  }
  async completeAuthorization(
    actorId: string,
    id: string,
    code: string,
    state: string,
  ): Promise<string | undefined> {
    const connection = await this.owned(actorId, id, true);
    if (connection.platformType !== PlatformType.T3)
      throw new BadRequestException('Wrong connection type.');
    const frontendOrigin = await this.t3Adapter.completeAuthorization(connection, code, state);
    await this.testConnection(actorId, id);
    return frontendOrigin;
  }
  async getEntities(actorId: string, id: string) {
    const connection = await this.owned(actorId, id);
    return this.adapter(connection.platformType).fetchEntities(connection);
  }
  async executionConnection(
    actorId: string,
    id: string,
    projectId: string,
    type: PlatformType = PlatformType.T3,
  ) {
    await this.projectAccess(actorId, projectId, true);
    const connection = await this.owned(actorId, id, true);
    if (
      connection.platformType !== type ||
      (connection.projectId && connection.projectId !== projectId)
    )
      throw new BadRequestException('Choose a matching connection available to this project.');
    if (
      connection.metadata?.[type === PlatformType.T3 ? 't3Access' : 'paperclipAccess'] !==
      'supervised'
    )
      throw new ForbiddenException('Enable supervised execution access in Connections.');
    return connection;
  }
  async createExternalLink(actorId: string, dto: CreateExternalLinkDto): Promise<ExternalLink> {
    const connection = await this.owned(actorId, dto.connectionId, true);
    const projectId = dto.projectId ?? connection.projectId ?? null;
    if (projectId) await this.projectAccess(actorId, projectId, true);
    if (dto.goalId) {
      const goal = await this.goalRepo.findOne({ where: { id: dto.goalId, deletedAt: IsNull() } });
      if (!goal || goal.projectId !== projectId || (!goal.projectId && goal.userId !== actorId))
        throw new BadRequestException(
          'Choose a goal in the linked project or an owned personal goal.',
        );
      if (goal.projectId) await this.projectAccess(actorId, goal.projectId, true);
    }
    const source = await this.adapter(connection.platformType).fetchEntity(
      connection,
      dto.externalEntityType,
      dto.externalId,
    );
    if (!source.accessible || !source.found || source.entityType !== dto.externalEntityType)
      throw new NotFoundException('External record unavailable with this connection.');
    return this.linkRepo.save(
      this.linkRepo.create({
        connectionId: connection.id,
        userId: actorId,
        projectId,
        goalId: dto.goalId ?? null,
        platformType: connection.platformType,
        externalEntityType: dto.externalEntityType,
        externalId: source.id,
        externalTitle: source.title,
        externalUrl: source.url,
        metadata: {},
      }),
    );
  }
  async listExternalLinks(
    actorId: string,
    query: QueryExternalLinksDto,
  ): Promise<{ items: ExternalLink[]; total: number }> {
    if (query.projectId) await this.projectAccess(actorId, query.projectId);
    const qb = this.linkRepo
      .createQueryBuilder('link')
      .leftJoinAndSelect('link.project', 'project')
      .leftJoinAndSelect('link.goal', 'goal')
      .where('link.userId = :actorId', { actorId })
      .andWhere(
        '(link.projectId IS NULL OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = link.project_id AND pm.user_id = :actorId AND pm.removed_at IS NULL))',
        { actorId },
      );
    if (query.projectId) qb.andWhere('link.projectId = :projectId', { projectId: query.projectId });
    if (query.connectionId)
      qb.andWhere('link.connectionId = :connectionId', { connectionId: query.connectionId });
    if (query.goalId) qb.andWhere('link.goalId = :goalId', { goalId: query.goalId });
    if (query.platformType)
      qb.andWhere('link.platformType = :platformType', { platformType: query.platformType });
    const limit = Math.min(query.limit ?? 50, 100),
      page = query.page ?? 1;
    const [items, total] = await qb
      .orderBy('link.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return { items, total };
  }
  async deleteExternalLink(actorId: string, id: string): Promise<void> {
    const link = await this.linkRepo.findOne({ where: { id } });
    if (!link || link.userId !== actorId) throw new NotFoundException('External link not found.');
    if (link.projectId) await this.projectAccess(actorId, link.projectId, true);
    await this.linkRepo.remove(link);
  }
  async getPlatformOverview(
    actorId: string,
    projectId?: string,
  ): Promise<PlatformActivityOverviewDto> {
    const { items: connections } = await this.listConnections(actorId, { projectId, limit: 100 });
    const { items: links } = await this.listExternalLinks(actorId, { projectId, limit: 100 });
    const overview: PlatformActivityOverviewDto = {
      oscarAnswer: '',
      totalPlatforms: connections.length,
      healthyPlatforms: 0,
      paperclip: { connected: false, agents: [], teams: [], issues: [] },
      t3: { connected: false, workspaces: [], threads: [], runs: [] },
      linkedRecordsCount: links.length,
      generatedAt: new Date().toISOString(),
      warnings: [],
    };
    if (connections.length > 8)
      overview.warnings.push('Only the first 8 connections were checked in this snapshot.');
    await Promise.all(
      connections.slice(0, 8).map(async (publicConnection) => {
        const connection = await this.owned(actorId, publicConnection.id);
        try {
          const health = await this.adapter(connection.platformType).checkHealth(connection);
          Object.assign(connection, {
            status: health.status,
            capabilities: health.capabilities,
            versionInfo: health.versionInfo,
            healthError: health.error ?? null,
            lastHealthCheckAt: new Date(),
          });
          await this.connectionRepo.save({
            id: connection.id,
            status: connection.status,
            capabilities: connection.capabilities,
            versionInfo: connection.versionInfo,
            lastHealthCheckAt: connection.lastHealthCheckAt,
            healthError: connection.healthError,
          });
          if (health.status !== PlatformConnectionStatus.HEALTHY)
            throw new Error('Read access unavailable.');
          const result = await this.adapter(connection.platformType).fetchEntities(connection);
          const mapped = (id: string, type: string) =>
            links.find(
              (l) =>
                l.connectionId === connection.id &&
                l.externalId === id &&
                l.externalEntityType === type,
            );
          if (result.type === PlatformType.PAPERCLIP) {
            overview.paperclip.connected = true;
            overview.paperclip.agents.push(...result.data.agents);
            overview.paperclip.teams.push(...result.data.teams);
            overview.paperclip.issues.push(
              ...result.data.issues.map((issue) => ({
                ...issue,
                nativeUrl: issue.url,
                projectId: mapped(issue.id, 'issue')?.projectId,
                goalId: mapped(issue.id, 'issue')?.goalId,
              })),
            );
          } else {
            overview.t3.connected = true;
            overview.t3.workspaces.push(...result.data.workspaces);
            overview.t3.threads.push(
              ...result.data.threads.map((thread) => ({
                ...thread,
                nativeUrl: thread.url,
                projectId: mapped(thread.id, 'thread')?.projectId,
                goalId: mapped(thread.id, 'thread')?.goalId,
              })),
            );
            overview.t3.runs.push(
              ...result.data.runs.map((run) => ({ ...run, nativeUrl: run.url })),
            );
          }
          overview.healthyPlatforms++;
        } catch {
          overview.warnings.push(
            `${connection.name}: live activity unavailable; reconnect or check permissions. No activity count is available for this connection.`,
          );
        }
      }),
    );
    overview.oscarAnswer =
      connections.length === 0
        ? 'No external platforms are connected. Add a connection in Platforms.'
        : [
            `${overview.healthyPlatforms}/${connections.length} connections provided a verified read-only snapshot.`,
            overview.paperclip.connected
              ? `Paperclip: ${overview.paperclip.agents.length} accessible agents and ${overview.paperclip.issues.length} issues.`
              : 'Paperclip: no verified snapshot available.',
            overview.t3.connected
              ? `T3: ${overview.t3.workspaces.length} projects, ${overview.t3.threads.length} threads, and ${overview.t3.runs.length} latest runs.`
              : 'T3: no verified snapshot available.',
            ...overview.warnings,
          ].join('\n\n');
    return overview;
  }
}
