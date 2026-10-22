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
import { User } from '../../users/entities/user.entity';
import { Project } from '../../projects/entities/project.entity';
import { Goal } from '../../goals/entities/goal.entity';

export enum MavisMemoryType {
  DECISION = 'DECISION',
  PREFERENCE = 'PREFERENCE',
  FACT = 'FACT',
  LESSON = 'LESSON',
  HYPOTHESIS = 'HYPOTHESIS',
  GOAL_STRATEGY = 'GOAL_STRATEGY',
  OBSERVATION = 'OBSERVATION',
  PROCEDURAL = 'PROCEDURAL',
}

export enum MavisMemoryScopeType {
  PERSONAL = 'PERSONAL',
  PROJECT = 'PROJECT',
  GOAL = 'GOAL',
}

export enum MavisMemoryStatus {
  PROPOSED = 'PROPOSED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  SUPERSEDED = 'SUPERSEDED',
}

export enum MavisSourceType {
  AGENT_RUN = 'AGENT_RUN',
  CHAT_MESSAGE = 'CHAT_MESSAGE',
  DECISION = 'DECISION',
  DOCUMENT = 'DOCUMENT',
  MANUAL = 'MANUAL',
}

@Entity('mavis_memories')
@Index('idx_mavis_memories_scope_personal', ['userId', 'deletedAt', 'status'])
@Index('idx_mavis_memories_scope_project', ['projectId', 'deletedAt', 'status'])
@Index('idx_mavis_memories_scope_goal', ['goalId', 'deletedAt', 'status'])
@Index('idx_mavis_memories_status', ['status', 'deletedAt'])
export class MavisMemory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'scope_type', type: 'varchar', length: 20 })
  scopeType!: MavisMemoryScopeType;

  @Column({ type: 'varchar', length: 30 })
  type!: MavisMemoryType;

  @Column({ type: 'varchar', length: 20, default: MavisMemoryStatus.PROPOSED })
  status!: MavisMemoryStatus;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId!: string | null;

  @ManyToOne(() => Project, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'project_id' })
  project?: Project | null;

  @Column({ name: 'goal_id', type: 'uuid', nullable: true })
  goalId!: string | null;

  @ManyToOne(() => Goal, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'goal_id' })
  goal?: Goal | null;

  @Column({ type: 'text' })
  statement!: string;

  @Column({ type: 'text', nullable: true })
  rationale!: string | null;

  @Column({ name: 'source_platform', type: 'varchar', length: 50, default: 'continuum' })
  sourcePlatform!: string;

  @Column({ name: 'source_type', type: 'varchar', length: 50, default: MavisSourceType.MANUAL })
  sourceType!: MavisSourceType;

  @Column({ name: 'source_id', type: 'varchar', length: 255, nullable: true })
  sourceId!: string | null;

  @Column({ name: 'source_metadata', type: 'jsonb', nullable: true })
  sourceMetadata!: Record<string, unknown> | null;

  @Column({ name: 'valid_from', type: 'timestamptz', nullable: true })
  validFrom!: Date | null;

  @Column({ name: 'valid_until', type: 'timestamptz', nullable: true })
  validUntil!: Date | null;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reviewed_by' })
  reviewer?: User | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @Column({ name: 'supersedes_id', type: 'uuid', nullable: true })
  supersedesId!: string | null;

  @ManyToOne(() => MavisMemory, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'supersedes_id' })
  supersedes?: MavisMemory | null;

  @Column({ name: 'superseded_by_id', type: 'uuid', nullable: true })
  supersededById!: string | null;

  @ManyToOne(() => MavisMemory, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'superseded_by_id' })
  supersededBy?: MavisMemory | null;

  @Column({ name: 'idempotency_key', type: 'uuid', nullable: true })
  idempotencyKey!: string | null;

  @VersionColumn({ default: 1 })
  version!: number;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
