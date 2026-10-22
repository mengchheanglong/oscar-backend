import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Goal } from './goal.entity';
import { User } from '../../users/entities/user.entity';

@Entity('goal_revisions')
@Index('idx_goal_revisions_goal', ['goalId', 'version'])
export class GoalRevision {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'goal_id', type: 'uuid' })
  goalId!: string;

  @ManyToOne(() => Goal, (goal) => goal.revisions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'goal_id' })
  goal?: Goal;

  @Column({ type: 'integer' })
  version!: number;

  @Column({ type: 'varchar', length: 500 })
  title!: string;

  @Column({ type: 'varchar', length: 20 })
  status!: string;

  @Column({ type: 'integer' })
  progress!: number;

  @Column({ type: 'text', nullable: true })
  target!: string | null;

  @Column({ name: 'changed_by', type: 'uuid' })
  changedBy!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'changed_by' })
  changer?: User;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  snapshot!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
