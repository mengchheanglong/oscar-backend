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
import { Goal } from './goal.entity';

@Entity('goal_metrics')
@Index('idx_goal_metrics_goal', ['goalId'])
export class GoalMetric {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'goal_id', type: 'uuid' })
  goalId!: string;

  @ManyToOne(() => Goal, (goal) => goal.metrics, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'goal_id' })
  goal?: Goal;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 50 })
  unit!: string;

  @Column({
    name: 'baseline_value',
    type: 'numeric',
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string | number) => Number(value),
    },
  })
  baselineValue!: number;

  @Column({
    name: 'current_value',
    type: 'numeric',
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string | number) => Number(value),
    },
  })
  currentValue!: number;

  @Column({
    name: 'target_value',
    type: 'numeric',
    transformer: {
      to: (value: number) => value,
      from: (value: string | number) => Number(value),
    },
  })
  targetValue!: number;

  @Column({ name: 'observation_date', type: 'date', nullable: true })
  observationDate!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
