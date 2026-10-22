import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Project } from '../../projects/entities/project.entity';
import { User } from '../../users/entities/user.entity';
import { ProposalCommit } from './proposal-commit.entity';

export enum ProposalType {
  TASK_PROPOSAL = 'TASK_PROPOSAL',
}

export enum ProposalStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

@Entity('ai_proposals')
@Index('idx_ai_proposals_project_user_status', ['projectId', 'userId', 'status'])
@Index('idx_ai_proposals_source', ['projectId', 'sourceEntityType', 'sourceEntityId'])
export class AssistantProposal {
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

  @Column({ name: 'proposal_type', type: 'varchar', length: 50 })
  proposalType!: ProposalType;

  @Column({ name: 'source_entity_type', type: 'varchar', length: 50 })
  sourceEntityType!: string;

  @Column({ name: 'source_entity_id', type: 'uuid' })
  sourceEntityId!: string;

  @Column({ name: 'source_revision', type: 'integer' })
  sourceRevision!: number;

  @Column({ name: 'draft_json', type: 'jsonb' })
  draftJson!: Record<string, unknown>;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ type: 'varchar', length: 20, default: ProposalStatus.PENDING })
  status!: ProposalStatus;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'confirmed_by', type: 'uuid', nullable: true })
  confirmedBy!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'confirmed_by' })
  confirmedByUser?: User | null;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt!: Date | null;

  @Column({ name: 'result_record_ids', type: 'jsonb', default: () => "'[]'" })
  resultRecordIds!: Array<{ entityType: string; id: string; key?: string }>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToOne(() => ProposalCommit, (commit) => commit.proposal)
  commit?: ProposalCommit;
}
