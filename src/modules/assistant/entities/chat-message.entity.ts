import { SkillSnapshot } from '../../skills/skill-context';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Conversation } from './conversation.entity';
import type { AnswerSupportAudit } from '../context/answer-support';
import type { KnowledgeRetrievalAudit } from '../../knowledge-client/knowledge-retrieval-audit';
import { AssistantMode } from './assistant-mode.enum';

export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
}

export enum MessageStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface CitationItem {
  bookId?: string;
  author?: string;
  edition?: string;
  chapter?: string;
  extraction?: string;
  reviewRequired?: boolean;
  coverageNote?: string;
  documentId?: string;
  collectionId?: string;
  sourceUrl?: string;
  courseCode?: string;
  institution?: string;
  pageStart?: number;
  pageEnd?: number;
  startMs?: number;
  endMs?: number;
  evidenceNumber?: number;
  chunkId: string;
  sourceId: string;
  sourceType: string;
  title: string;
  revision: number;
  locator?: string | null;
  score?: number;
  snippet?: string;
  projectName?: string;
  projectKey?: string;
  fullTextLength?: number;
  isTruncated?: boolean;
  exactExcerpt?: string;
}

export interface EvidenceSnapshot {
  version: 1;
  generationAttempted: boolean;
  items: (CitationItem & { textSha256: string })[];
  answerReview?: AnswerSupportAudit;
  retrievalAudit?: KnowledgeRetrievalAudit;
}

@Entity('ai_messages')
@Index('idx_ai_messages_conv', ['conversationId', 'createdAt'])
@Index('idx_ai_messages_request_role', ['conversationId', 'clientRequestId', 'role'], {
  unique: true,
})
export class ChatMessage {
  @Column({ name: 'skill_context', type: 'jsonb', default: () => "'[]'::jsonb" })
  skillContext!: SkillSnapshot[];
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  @ManyToOne(() => Conversation, (conversation) => conversation.messages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversation_id' })
  conversation?: Conversation;

  @Column({ type: 'varchar', length: 20, default: MessageRole.USER })
  role!: MessageRole;

  @Column({ type: 'varchar', length: 50, default: AssistantMode.PM })
  mode!: AssistantMode;

  @Column({ type: 'text' })
  content!: string;

  @Column({ name: 'client_request_id', type: 'uuid', nullable: true })
  clientRequestId!: string | null;

  @Column({ name: 'request_fingerprint', type: 'varchar', length: 64, nullable: true })
  requestFingerprint!: string | null;

  // Assigned by the existing database sequence; use it for stable turn ordering.
  @Column({ name: 'context_seq', type: 'bigint', select: false, insert: false, update: false })
  contextSequence!: string;

  @Column({ type: 'varchar', length: 50, default: MessageStatus.COMPLETED })
  status!: MessageStatus;

  @Column({ name: 'context_excluded', type: 'boolean', default: false })
  contextExcluded!: boolean;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  citations!: CitationItem[];

  // Private per-turn retrieval trace, not additional claimed supporting citations.
  // Historical rows stay null: never reconstruct their model input later.
  @Column({ name: 'evidence_snapshot', type: 'jsonb', nullable: true })
  evidenceSnapshot!: EvidenceSnapshot | null;

  @Column({ name: 'model_name', type: 'varchar', length: 100, nullable: true })
  modelName!: string | null;

  @Column({ name: 'prompt_tokens', type: 'integer', nullable: true })
  promptTokens!: number | null;

  @Column({ name: 'completion_tokens', type: 'integer', nullable: true })
  completionTokens!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
