import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Project } from '../../projects/entities/project.entity';
import { KnowledgeChunk } from './knowledge-chunk.entity';

export enum KnowledgeSourceType {
  CHAT_ATTACHMENT = 'CHAT_ATTACHMENT',
  DOCUMENT = 'DOCUMENT',
  LOCAL_FILE = 'LOCAL_FILE',
  REQUIREMENT = 'REQUIREMENT',
  DECISION = 'DECISION',
  TASK = 'TASK',
  MEETING = 'MEETING',
  GITHUB_ISSUE = 'GITHUB_ISSUE',
  GITHUB_PR = 'GITHUB_PR',
  GITHUB_CODE = 'GITHUB_CODE',
}

// Legacy enum values above remain readable for preserved database records only.
export const ACTIVE_KNOWLEDGE_SOURCE_TYPES = Object.values(KnowledgeSourceType).filter(
  (type) =>
    type !== KnowledgeSourceType.CHAT_ATTACHMENT &&
    type !== KnowledgeSourceType.REQUIREMENT &&
    type !== KnowledgeSourceType.MEETING,
);

export enum KnowledgeSourceStatus {
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  INDEXED = 'INDEXED',
  FAILED = 'FAILED',
}

@Entity('knowledge_sources')
@Index('idx_knowledge_sources_unique_source', ['projectId', 'sourceType', 'sourceId'], {
  unique: true,
})
@Index('idx_knowledge_sources_project_status', ['projectId', 'deletedAt', 'status'])
export class KnowledgeSource {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project?: Project;

  @Column({ name: 'owner_id', type: 'uuid', nullable: true })
  ownerId!: string | null;

  @Column({ name: 'local_folder_id', type: 'uuid', nullable: true })
  localFolderId!: string | null;

  @Column({ name: 'source_type', type: 'varchar', length: 50 })
  sourceType!: KnowledgeSourceType;

  @Column({ name: 'source_id', type: 'uuid' })
  sourceId!: string;

  @Column({ name: 'source_revision', type: 'integer', default: 1 })
  sourceRevision!: number;

  @Column({ type: 'varchar', length: 500 })
  title!: string;

  @Column({ name: 'content_hash', type: 'varchar', length: 64, nullable: true })
  contentHash!: string | null;

  @Column({ name: 'active_index_version', type: 'integer', default: 0 })
  activeIndexVersion!: number;

  @Column({ type: 'varchar', length: 50, default: KnowledgeSourceStatus.QUEUED })
  status!: KnowledgeSourceStatus;

  @Column({ name: 'last_error_code', type: 'varchar', length: 100, nullable: true })
  lastErrorCode!: string | null;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => KnowledgeChunk, (chunk) => chunk.knowledgeSource)
  chunks?: KnowledgeChunk[];
}
