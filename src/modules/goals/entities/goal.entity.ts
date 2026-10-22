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
  VersionColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Project } from '../../projects/entities/project.entity';
import { GoalMetric } from './goal-metric.entity';
import { GoalRevision } from './goal-revision.entity';
import { Task } from '../../tasks/entities/task.entity';
import { Decision } from '../../decisions/entities/decision.entity';

export enum GoalStatus {
  PLANNED = 'PLANNED',
  ACTIVE = 'ACTIVE',
  ACHIEVED = 'ACHIEVED',
  PAUSED = 'PAUSED',
  ABANDONED = 'ABANDONED',
}

export enum GoalCategory {
  BUSINESS = 'BUSINESS',
  TECHNICAL = 'TECHNICAL',
  FINANCIAL = 'FINANCIAL',
  PERSONAL = 'PERSONAL',
  OPERATIONS = 'OPERATIONS',
}

export enum GoalConfidence {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

export enum GoalReviewCadence {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  BIWEEKLY = 'BIWEEKLY',
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
}

export interface GoalMilestone {
  id: string;
  title: string;
  targetDate?: string | null;
  completed: boolean;
  completedAt?: string | null;
}

export interface GoalInitiative {
  id: string;
  title: string;
  description?: string | null;
  status: 'TODO' | 'IN_PROGRESS' | 'DONE';
}

@Entity('goals')
@Index('idx_goals_user_status', ['userId', 'deletedAt', 'status'])
@Index('idx_goals_project_status', ['projectId', 'deletedAt', 'status'])
export class Goal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  owner?: User;

  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId!: string | null;

  @ManyToOne(() => Project, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project?: Project | null;

  @Column({ type: 'varchar', length: 500 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'text', nullable: true })
  motivation!: string | null;

  @Column({ type: 'varchar', length: 20, default: GoalStatus.ACTIVE })
  status!: GoalStatus;

  @Column({ type: 'varchar', length: 100, nullable: true })
  timeframe!: string | null;

  @Column({ name: 'start_date', type: 'date', nullable: true })
  startDate!: string | null;

  @Column({ name: 'target_date', type: 'date', nullable: true })
  targetDate!: string | null;

  @Column({ type: 'text', nullable: true })
  baseline!: string | null;

  @Column({ type: 'text', nullable: true })
  target!: string | null;

  @Column({ type: 'integer', default: 0 })
  progress!: number;

  @Column({ type: 'varchar', length: 20, nullable: true })
  confidence!: GoalConfidence | null;

  @Column({ type: 'varchar', length: 50, default: GoalCategory.BUSINESS })
  category!: GoalCategory;

  @Column({ type: 'text', nullable: true })
  dependencies!: string | null;

  @Column({ type: 'text', nullable: true })
  risks!: string | null;

  @Column({
    name: 'review_cadence',
    type: 'varchar',
    length: 50,
    default: GoalReviewCadence.WEEKLY,
  })
  reviewCadence!: GoalReviewCadence;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  initiatives!: GoalInitiative[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  milestones!: GoalMilestone[];

  @VersionColumn({ default: 1 })
  version!: number;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => GoalMetric, (metric) => metric.goal)
  metrics?: GoalMetric[];

  @OneToMany(() => GoalRevision, (rev) => rev.goal)
  revisions?: GoalRevision[];

  @OneToMany(() => Task, (task) => task.goal)
  tasks?: Task[];

  @OneToMany(() => Decision, (decision) => decision.goal)
  decisions?: Decision[];
}
