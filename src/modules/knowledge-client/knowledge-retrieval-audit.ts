export interface KnowledgeRetrievalAudit {
  version: 1;
  strategy: 'business-aspects' | 'reference-plan' | 'explanatory-plan';
  rankingMethod?: 'QUESTION_DEPTH_COVERAGE_HEURISTIC';
  candidateLimit?: number;
  candidateCount?: number;
  assembledChunkIds?: string[];
  expansions?: {
    anchorChunkId: string;
    chunkIds: string[];
    status: 'EXPANDED' | 'UNAVAILABLE';
    elapsedMs: number;
    contextLimited?: boolean;
    failureCode?:
      | 'ACCESS_DENIED'
      | 'STALE_SOURCE'
      | 'SOURCE_UNAVAILABLE'
      | 'WINDOW_LIMIT'
      | 'UPSTREAM_UNAVAILABLE';
  }[];
  searches: {
    aspect: string;
    followUp: boolean;
    elapsedMs: number;
    unavailable: boolean;
    candidateChunkIds: string[];
    usableCount: number;
    queryChars?: number;
  }[];
  selectedChunkIds: string[];
  deadlineReached: boolean;
  followUpUsed: boolean;
}
