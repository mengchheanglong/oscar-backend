import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { Project } from '../../projects/entities/project.entity';
import { User } from '../../users/entities/user.entity';
import { ChatMessage } from './chat-message.entity';

export enum SavedMemoryKind {
  CONTEXT = 'CONTEXT',
  PREFERENCE = 'PREFERENCE',
  LESSON = 'LESSON',
}

@Entity('copilot_memories')
@Index('idx_copilot_memories_scope', ['projectId', 'userId', 'deletedAt', 'updatedAt', 'id'])
@Index('uq_copilot_memories_retry', ['projectId', 'userId', 'idempotencyKey'], { unique: true })
export class SavedMemory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project?: Project;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'varchar', length: 20 })
  kind!: SavedMemoryKind;

  @Column({ type: 'text' })
  content!: string;

  @Column({ name: 'source_attachment_id', type: 'uuid', nullable: true })
  sourceAttachmentId!: string | null;

  @Column({ name: 'source_message_id', type: 'uuid', nullable: true })
  sourceMessageId!: string | null;

  @ManyToOne(() => ChatMessage, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'source_message_id' })
  sourceMessage?: ChatMessage | null;

  @Column({ name: 'idempotency_key', type: 'uuid', select: false })
  idempotencyKey!: string;

  @Column({ name: 'payload_hash', type: 'varchar', length: 64, select: false })
  payloadHash!: string;

  @VersionColumn()
  version!: number;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
