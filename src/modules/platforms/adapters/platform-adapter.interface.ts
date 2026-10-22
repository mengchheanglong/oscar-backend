import {
  PlatformConnection,
  PlatformConnectionStatus,
  PlatformType,
  PlatformVersionInfo,
} from '../entities/platform-connection.entity';
import { ExternalEntityType } from '../entities/external-link.entity';

export interface PlatformHealthCheckResult {
  status: PlatformConnectionStatus;
  capabilities: string[];
  versionInfo: PlatformVersionInfo;
  error?: string;
}

export interface PaperclipEntitiesResult {
  agents: Array<{ id: string; name: string; status: string; role?: string }>;
  teams: Array<{ id: string; name: string; memberCount?: number }>;
  issues: Array<{
    id: string;
    title: string;
    status: string;
    priority?: string;
    assignee?: string;
    url: string;
  }>;
}

export interface T3EntitiesResult {
  workspaces: Array<{ id: string; name: string; path?: string }>;
  threads: Array<{ id: string; title: string; status: string; url: string }>;
  runs: Array<{
    id: string;
    threadId: string;
    status: string;
    startedAt?: string;
    completedAt?: string;
    url: string;
  }>;
}

export type PlatformEntitiesResult =
  | { type: PlatformType.PAPERCLIP; data: PaperclipEntitiesResult }
  | { type: PlatformType.T3; data: T3EntitiesResult };

export interface SingleEntityResult {
  found: boolean;
  accessible: boolean;
  entityType: ExternalEntityType;
  id: string;
  title: string;
  url: string;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface PlatformAdapter {
  readonly platformType: PlatformType;
  checkHealth(connection: PlatformConnection): Promise<PlatformHealthCheckResult>;
  fetchEntities(connection: PlatformConnection): Promise<PlatformEntitiesResult>;
  fetchEntity(
    connection: PlatformConnection,
    entityType: ExternalEntityType,
    externalId: string,
  ): Promise<SingleEntityResult>;
}
