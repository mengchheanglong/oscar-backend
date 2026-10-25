import { RetrievedEvidence } from '../mavis/retrieval/retrieval.service';

export interface AssistantEvidence extends Omit<RetrievedEvidence, 'sourceType'> {
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
}
