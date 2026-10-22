import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('execution_reviews')
@Index(['userId', 'platform', 'runId'], { unique: true })
@Index(['userId', 'idempotencyKey'], { unique: true })
export class ExecutionReview {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId!: string;
  @Column({ type: 'varchar', length: 15 }) platform!: 'hermes' | 't3' | 'paperclip';
  @Column({ name: 'run_id', type: 'uuid' }) runId!: string;
  @Column({ name: 'goal_id', type: 'uuid', nullable: true }) goalId!: string | null;
  @Column({ type: 'varchar', length: 20 }) verdict!: 'ACCEPTED' | 'NEEDS_WORK' | 'REJECTED';
  @Column({ type: 'text' }) observation!: string;
  @Column({ name: 'reported_cost_usd', type: 'numeric', precision: 12, scale: 4, nullable: true })
  reportedCostUsd!: string | null;
  @Column({ name: 'memory_id', type: 'uuid', nullable: true }) memoryId!: string | null;
  @Column({ name: 'idempotency_key', type: 'uuid' }) idempotencyKey!: string;
  @Column({ name: 'payload_hash', type: 'varchar', length: 64, select: false })
  payloadHash!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
