import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GitHubConnectionStatus } from '../entities/github-connection.entity';

export class GitHubConnectionResponseDto {
  @ApiProperty()
  id!: string;
  @ApiProperty()
  projectId!: string;
  @ApiProperty()
  repositoryOwner!: string;
  @ApiProperty()
  repositoryName!: string;
  @ApiProperty({ type: String, nullable: true })
  repositoryId!: string | null;
  @ApiProperty({ enum: GitHubConnectionStatus })
  status!: GitHubConnectionStatus;
  @ApiProperty({ type: String, nullable: true })
  lastSyncedAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  errorSummary!: string | null;
  @ApiPropertyOptional()
  issueCount?: number;
  @ApiPropertyOptional()
  pullRequestCount?: number;
  @ApiPropertyOptional()
  fileCount?: number;
  @ApiProperty()
  createdAt!: string;
  @ApiProperty()
  updatedAt!: string;
}

export class SyncGitHubResponseDto {
  @ApiProperty()
  syncedCount!: number;
  @ApiProperty()
  totalCount!: number;
  @ApiPropertyOptional()
  syncedPrCount?: number;
  @ApiPropertyOptional()
  totalPrCount?: number;
  @ApiProperty()
  hasMore!: boolean;
  @ApiProperty({ type: String, nullable: true })
  lastSyncedAt!: string | null;
}

export class GitHubIssueResponseDto {
  id!: string;
  projectId!: string;
  connectionId!: string;
  issueNumber!: number;
  title!: string;
  body!: string | null;
  state!: string;
  htmlUrl!: string;
  authorLogin!: string | null;
  labels!: string[];
  githubCreatedAt!: string;
  githubUpdatedAt!: string;
  syncedAt!: string;
}

export class GitHubPullRequestResponseDto {
  id!: string;
  projectId!: string;
  connectionId!: string;
  prNumber!: number;
  title!: string;
  body!: string | null;
  state!: string;
  htmlUrl!: string;
  authorLogin!: string | null;
  baseBranch!: string | null;
  headBranch!: string | null;
  isMerged!: boolean;
  mergedAt!: string | null;
  labels!: string[];
  githubCreatedAt!: string;
  githubUpdatedAt!: string;
  syncedAt!: string;
}

export class GitHubRepoFileResponseDto {
  id!: string;
  projectId!: string;
  connectionId!: string;
  path!: string;
  fileName!: string;
  extension!: string;
  size!: number;
  htmlUrl!: string;
  syncedAt!: string;
}

export class SyncCodebaseResponseDto {
  nextCursor!: number | null;
  treeVersion!: string;
  candidateFilesCount!: number;
  unchangedFilesCount!: number;
  indexedFilesCount!: number;
  totalFiles!: number;
  lastSyncedAt!: string;
}
