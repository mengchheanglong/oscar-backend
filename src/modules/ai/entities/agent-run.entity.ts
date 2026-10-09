import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Project } from '../../projects/entities/project.entity';
import { User } from '../../users/entities/user.entity';
import { AIProposal } from './proposal.entity';

export enum AgentRunStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}
export interface RunEvent {
  name: string;
  at: string;
}

@Entity('agent_runs')
@Index('uq_agent_runs_retry', ['projectId', 'userId', 'idempotencyKey'], { unique: true })
@Index('idx_agent_runs_scope', ['projectId', 'userId', 'createdAt'])
@Index('uq_agent_runs_active', ['projectId', 'userId'], {
  unique: true,
  where: "status IN ('QUEUED','RUNNING')",
})
export class AgentRun {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId!: string;
  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project?: Project;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'user_id' }) user?: User;
  @Column({ type: 'text' }) prompt!: string;
  @Column({ type: 'varchar', length: 20 }) status!: AgentRunStatus;
  @Column({ type: 'varchar', length: 100 }) model!: string;
  @Column({ name: 'runtime_revision', type: 'varchar', length: 40 }) runtimeRevision!: string;
  @Column({ name: 'idempotency_key', type: 'uuid', select: false }) idempotencyKey!: string;
  @Column({ name: 'payload_hash', type: 'varchar', length: 64, select: false })
  payloadHash!: string;
  @Column({ type: 'jsonb', default: () => "'[]'" }) events!: RunEvent[];
  @Column({ type: 'jsonb', default: () => "'[]'" }) evidence!: Array<{
    chunkId: string;
    sourceId: string;
    title: string;
    revision: number;
    locator: string;
  }>;
  @Column({ type: 'text', nullable: true }) artifact!: string | null;
  @Column({ name: 'proposal_id', type: 'uuid', nullable: true }) proposalId!: string | null;
  @ManyToOne(() => AIProposal, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'proposal_id' })
  proposal?: AIProposal | null;
  @Column({ name: 'error_code', type: 'varchar', length: 50, nullable: true }) errorCode!:
    string | null;
  @Column({ name: 'deadline_at', type: 'timestamptz', nullable: true }) deadlineAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
