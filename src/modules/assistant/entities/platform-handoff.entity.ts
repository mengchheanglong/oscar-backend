import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type HandoffStatus =
  | 'QUEUED'
  | 'DISPATCHING'
  | 'UNCERTAIN'
  | 'RUNNING'
  | 'WAITING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED';

@Entity('platform_handoffs')
@Index(['userId', 'idempotencyKey'], { unique: true })
export class PlatformHandoff {
  @Column({ name: 'goal_id', type: 'uuid', nullable: true }) goalId!: string | null;
  @Column({ name: 'platform_type', type: 'varchar', length: 30, default: 't3' }) platformType!:
    't3' | 'paperclip';
  @Column({ name: 'remote_agent_id', type: 'varchar', length: 255, nullable: true })
  remoteAgentId!: string | null;
  @Column({ name: 'remote_company_id', type: 'varchar', length: 255, nullable: true })
  remoteCompanyId!: string | null;
  @Column({ name: 'external_url', type: 'varchar', length: 1000, nullable: true }) externalUrl!:
    string | null;
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId!: string;
  @Column({ name: 'conversation_id', type: 'uuid' }) conversationId!: string;
  @Column({ name: 'connection_id', type: 'uuid', nullable: true }) connectionId!: string | null;
  @Column({ name: 'connection_origin', type: 'varchar', length: 500 }) connectionOrigin!: string;
  @Column({ name: 'idempotency_key', type: 'uuid' }) idempotencyKey!: string;
  @Column({ name: 'remote_project_id', type: 'varchar', length: 255, nullable: true })
  remoteProjectId!: string | null;
  @Column({ type: 'text' }) prompt!: string;
  @Column({ name: 'model_selection', type: 'jsonb', nullable: true }) modelSelection!: {
    provider: string;
    instanceId: string;
    model: string;
  } | null;
  @Column({ type: 'varchar', length: 20 }) status!: HandoffStatus;
  @Column({ name: 'thread_id', type: 'varchar', length: 255, nullable: true }) threadId!:
    string | null;
  @Column({ name: 'run_id', type: 'varchar', length: 255, nullable: true }) runId!: string | null;
  @Column({ name: 'remote_status', type: 'varchar', length: 100, nullable: true }) remoteStatus!:
    string | null;
  @Column({ name: 'result', type: 'text', nullable: true }) result!: string | null;
  @Column({ type: 'text', nullable: true }) notice!: string | null;
  @Column({ name: 'assistant_message_id', type: 'uuid', nullable: true }) assistantMessageId!:
    string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
