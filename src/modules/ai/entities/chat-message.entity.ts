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
import { AiMode } from './ai-mode.enum';

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
}

@Entity('ai_messages')
@Index('idx_ai_messages_conv', ['conversationId', 'createdAt'])
export class ChatMessage {
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

  @Column({ type: 'varchar', length: 50, default: AiMode.PM })
  mode!: AiMode;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'varchar', length: 50, default: MessageStatus.COMPLETED })
  status!: MessageStatus;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  citations!: CitationItem[];

  @Column({ name: 'model_name', type: 'varchar', length: 100, nullable: true })
  modelName!: string | null;

  @Column({ name: 'prompt_tokens', type: 'integer', nullable: true })
  promptTokens!: number | null;

  @Column({ name: 'completion_tokens', type: 'integer', nullable: true })
  completionTokens!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
