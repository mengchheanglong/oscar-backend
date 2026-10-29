export interface KnowledgeRetrievalAudit {
  version: 1;
  strategy: 'business-aspects';
  searches: {
    aspect: string;
    followUp: boolean;
    elapsedMs: number;
    unavailable: boolean;
    candidateChunkIds: string[];
    usableCount: number;
  }[];
  selectedChunkIds: string[];
  deadlineReached: boolean;
  followUpUsed: boolean;
}
