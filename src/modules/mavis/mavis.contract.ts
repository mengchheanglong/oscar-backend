import {
  MavisMemoryScopeType,
  MavisMemoryStatus,
  MavisMemoryType,
  MavisSourceType,
} from './entities/mavis-memory.entity';

export interface MavisProvenance {
  sourcePlatform: string;
  sourceType: MavisSourceType;
  sourceId: string | null;
  sourceMetadata: Record<string, unknown> | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  supersedesId: string | null;
  supersededById: string | null;
}

export interface MavisMemoryItem {
  id: string;
  type: MavisMemoryType;
  scopeType: MavisMemoryScopeType;
  status: MavisMemoryStatus;
  statement: string;
  rationale: string | null;
  provenance: MavisProvenance;
  version: number;
  validFrom: string | null;
  validUntil: string | null;
  createdAt: string;
}

export interface MavisHistoricalConversationItem {
  messageId: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt: string;
}

export interface MavisProjectSourceItem {
  chunkId: string;
  sourceId: string;
  sourceType: string;
  title: string;
  revision: number;
  locator: string;
  snippet: string;
}

export interface MavisExecutionResultItem {
  runId: string;
  model: string;
  status: string;
  prompt: string;
  artifactSummary: string;
  completedAt: string;
}

export interface MavisContextRequest {
  actorId: string;
  query: string;
  projectId?: string;
  /** Internal multi-project recall; every supplied project is authorized by the service. */
  projectIds?: string[];
  goalId?: string;
  includeApprovedMemories?: boolean;
  includeHistoricalConversations?: boolean;
  includeProjectSources?: boolean;
  includeExecutionResults?: boolean;
  limit?: number;
}

export interface MavisContextPack {
  // Clear architectural separation of trust levels and sources:
  approvedMemories: MavisMemoryItem[];
  historicalConversations: MavisHistoricalConversationItem[];
  projectSources: MavisProjectSourceItem[];
  rawExecutionResults: MavisExecutionResultItem[];
  formattedContext: string;
}
