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
import { Priority } from '../../../common/enums/priority.enum';

export enum TaskStatus {
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  IN_REVIEW = 'IN_REVIEW',
  DONE = 'DONE',
  CANCELLED = 'CANCELLED',
  BLOCKED = 'BLOCKED',
}

export { Priority };

@Entity('tasks')
@Index('idx_tasks_project_status', ['projectId', 'deletedAt', 'status'])
@Index('idx_tasks_project_assignee', ['projectId', 'deletedAt', 'assigneeId'])
@Index('idx_tasks_project_due_date', ['projectId', 'deletedAt', 'dueDate'])
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project?: Project;

  @Column({ type: 'integer' })
  number!: number;

  @Column({ type: 'varchar', length: 500 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 20, default: TaskStatus.TODO })
  status!: TaskStatus;

  @Column({ type: 'varchar', length: 20, default: Priority.MEDIUM })
  priority!: Priority;

  @Column({ name: 'blocked_reason', type: 'varchar', length: 500, nullable: true })
  blockedReason?: string | null;

  @Column({ name: 'assignee_id', type: 'uuid', nullable: true })
  assigneeId!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assignee_id' })
  assignee?: User | null;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate!: string | null;

  @Column({ name: 'requirement_id', type: 'uuid', nullable: true })
  requirementId!: string | null;

  @Column({ name: 'source_meeting_id', type: 'uuid', nullable: true })
  sourceMeetingId!: string | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator?: User;

  @Column({ name: 'updated_by', type: 'uuid' })
  updatedBy!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'updated_by' })
  updater?: User;

  @VersionColumn({ default: 1 })
  version!: number;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
