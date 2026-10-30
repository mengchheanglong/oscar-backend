import { RetrievedEvidence } from '../mavis/retrieval/retrieval.service';

export interface AssistantEvidence extends Omit<RetrievedEvidence, 'sourceType'> {
  contextWindow?: {
    anchorChunkId: string;
    relativeOffset: number;
    sourceTextSha256: string;
    sourceCharCount: number;
    contextLimited?: boolean;
  };
  sourceSpan?: { startChar: number; endChar: number };
  discoveryPath?: string[];
  bookId?: string;
  author?: string;
  edition?: string;
  chapter?: string;
  extraction?: string;
  reviewRequired?: boolean;
  coverageNote?: string;
  sourceType: RetrievedEvidence['sourceType'] | 'EXTERNAL_KNOWLEDGE';
  documentId?: string;
  collectionId?: string;
  sourceUrl?: string;
  courseCode?: string;
  institution?: string;
  pageStart?: number;
  pageEnd?: number;
  startMs?: number;
  endMs?: number;
  fullTextLength?: number;
  isTruncated?: boolean;
  exactExcerpt?: string;
}
