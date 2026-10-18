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
} from 'typeorm';
import { Project } from '../../../projects/entities/project.entity';
import { GitHubIssue } from './github-issue.entity';
import { GitHubPullRequest } from './github-pull-request.entity';
import { GitHubRepoFile } from './github-repo-file.entity';

export enum GitHubConnectionStatus {
  CONNECTED = 'CONNECTED',
  SYNCING = 'SYNCING',
  DISCONNECTED = 'DISCONNECTED',
  ERROR = 'ERROR',
}

@Entity('github_connections')
@Index('idx_github_connections_project_status', ['projectId', 'status'])
@Index('idx_github_connections_project_repo', ['projectId', 'repositoryOwner', 'repositoryName'], {
  unique: true,
})
export class GitHubConnection {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project?: Project;

  @Column({ name: 'repository_owner', type: 'varchar', length: 100 })
  repositoryOwner!: string;

  @Column({ name: 'repository_name', type: 'varchar', length: 100 })
  repositoryName!: string;

  @Column({ name: 'repository_id', type: 'varchar', length: 100, nullable: true })
  repositoryId!: string | null;

  @Column({ name: 'installation_id', type: 'varchar', length: 100, nullable: true })
  installationId!: string | null;

  @Column({
    type: 'varchar',
    length: 50,
    default: GitHubConnectionStatus.CONNECTED,
  })
  status!: GitHubConnectionStatus;

  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt!: Date | null;

  @Column({ name: 'error_summary', type: 'text', nullable: true })
  errorSummary!: string | null;

  @Column({ name: 'sync_cursor', type: 'varchar', length: 100, nullable: true })
  syncCursor!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => GitHubIssue, (issue) => issue.connection)
  issues?: GitHubIssue[];

  @OneToMany(() => GitHubPullRequest, (pr) => pr.connection)
  pullRequests?: GitHubPullRequest[];

  @OneToMany(() => GitHubRepoFile, (file) => file.connection)
  files?: GitHubRepoFile[];
}
