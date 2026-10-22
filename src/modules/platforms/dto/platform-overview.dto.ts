import { ApiProperty } from '@nestjs/swagger';

export class PaperclipAgentSummary {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ required: false })
  role?: string;
}

export class PaperclipTeamSummary {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ required: false })
  memberCount?: number;
}

export class PaperclipIssueSummary {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ required: false })
  priority?: string;

  @ApiProperty({ required: false })
  assignee?: string;

  @ApiProperty()
  nativeUrl!: string;

  @ApiProperty({ required: false, nullable: true })
  goalId?: string | null;

  @ApiProperty({ required: false, nullable: true })
  projectId?: string | null;
}

export class T3ThreadSummary {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  nativeUrl!: string;

  @ApiProperty({ required: false, nullable: true })
  goalId?: string | null;

  @ApiProperty({ required: false, nullable: true })
  projectId?: string | null;
}

export class T3RunSummary {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  threadId!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ required: false })
  startedAt?: string;

  @ApiProperty({ required: false })
  completedAt?: string;

  @ApiProperty()
  nativeUrl!: string;
}

export class T3WorkspaceSummary {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ required: false })
  path?: string;
}

export class PlatformActivityOverviewDto {
  @ApiProperty({ type: [String] })
  warnings!: string[];
  @ApiProperty({ description: 'OSCAR answer describing current Paperclip and T3 activity' })
  oscarAnswer!: string;

  @ApiProperty({ description: 'Total connected platforms' })
  totalPlatforms!: number;

  @ApiProperty({ description: 'Healthy platforms count' })
  healthyPlatforms!: number;

  @ApiProperty({ description: 'Paperclip activity and entities' })
  paperclip!: {
    connected: boolean;
    agents: PaperclipAgentSummary[];
    teams: PaperclipTeamSummary[];
    issues: PaperclipIssueSummary[];
  };

  @ApiProperty({ description: 'T3 activity and entities' })
  t3!: {
    connected: boolean;
    workspaces: T3WorkspaceSummary[];
    threads: T3ThreadSummary[];
    runs: T3RunSummary[];
  };

  @ApiProperty({ description: 'Count of external items linked to Continuum goals/projects' })
  linkedRecordsCount!: number;

  @ApiProperty({ description: 'Timestamp of snapshot' })
  generatedAt!: string;
}
