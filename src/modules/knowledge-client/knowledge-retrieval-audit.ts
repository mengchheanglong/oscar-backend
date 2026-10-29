export interface KnowledgeRetrievalAudit {
  version: 1;
  strategy: 'business-aspects' | 'reference-plan';
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
