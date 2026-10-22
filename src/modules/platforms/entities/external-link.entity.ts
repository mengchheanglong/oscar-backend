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
import { User } from '../../users/entities/user.entity';
import { Project } from '../../projects/entities/project.entity';
import { Goal } from '../../goals/entities/goal.entity';
import { PlatformConnection, PlatformType } from './platform-connection.entity';

export enum ExternalEntityType {
  AGENT = 'agent',
  TEAM = 'team',
  ISSUE = 'issue',
  THREAD = 'thread',
  RUN = 'run',
  WORKSPACE = 'workspace',
}

@Entity('external_links')
export class ExternalLink {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId!: string;

  @ManyToOne(() => PlatformConnection, (conn) => conn.externalLinks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'connection_id' })
  connection!: PlatformConnection;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Index()
  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId!: string | null;

  @ManyToOne(() => Project, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'project_id' })
  project!: Project | null;

  @Index()
  @Column({ name: 'goal_id', type: 'uuid', nullable: true })
  goalId!: string | null;

  @ManyToOne(() => Goal, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'goal_id' })
  goal!: Goal | null;

  @Index()
  @Column({ name: 'platform_type', type: 'varchar', length: 30 })
  platformType!: PlatformType;

  @Column({ name: 'external_entity_type', type: 'varchar', length: 50 })
  externalEntityType!: ExternalEntityType;

  @Column({ name: 'external_id', type: 'varchar', length: 255 })
  externalId!: string;

  @Column({ name: 'external_title', type: 'varchar', length: 500 })
  externalTitle!: string;

  @Column({ name: 'external_url', type: 'varchar', length: 1000 })
  externalUrl!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
