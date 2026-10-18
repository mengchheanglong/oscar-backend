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
import { DecisionRevision } from './decision-revision.entity';

export enum DecisionStatus {
  PROPOSED = 'PROPOSED',
  ACCEPTED = 'ACCEPTED',
  SUPERSEDED = 'SUPERSEDED',
}

@Entity('decisions')
@Index('idx_decisions_project_status', ['projectId', 'deletedAt', 'status'])
export class Decision {
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

  @Column({ name: 'decision_text', type: 'text' })
  decisionText!: string;

  @Column({ type: 'text', nullable: true })
  rationale!: string | null;

  @Column({ type: 'varchar', length: 20, default: DecisionStatus.PROPOSED })
  status!: DecisionStatus;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

  @Column({ name: 'decided_by', type: 'uuid', nullable: true })
  decidedBy!: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'decided_by' })
  decider?: User | null;

  @Column({ name: 'requirement_id', type: 'uuid', nullable: true })
  requirementId!: string | null;

  @Column({ name: 'source_meeting_id', type: 'uuid', nullable: true })
  sourceMeetingId!: string | null;

  @Column({ name: 'supersedes_decision_id', type: 'uuid', nullable: true })
  supersedesDecisionId!: string | null;

  @ManyToOne(() => Decision, { nullable: true })
  @JoinColumn({ name: 'supersedes_decision_id' })
  supersedesDecision?: Decision | null;

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

  @OneToMany(() => DecisionRevision, (rev) => rev.decision)
  revisions?: DecisionRevision[];
}
