import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  GoalCategory,
  GoalConfidence,
  GoalInitiative,
  GoalMilestone,
  GoalReviewCadence,
  GoalStatus,
} from '../entities/goal.entity';

export class GoalMetricResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  goalId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  unit!: string;

  @ApiProperty()
  baselineValue!: number;

  @ApiProperty()
  currentValue!: number;

  @ApiProperty()
  targetValue!: number;

  @ApiPropertyOptional()
  observationDate?: string | null;

  @ApiPropertyOptional()
  notes?: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class GoalRevisionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  goalId!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  progress!: number;

  @ApiPropertyOptional()
  target?: string | null;

  @ApiProperty()
  changedBy!: string;

  @ApiPropertyOptional()
  reason?: string | null;

  @ApiProperty()
  createdAt!: string;
}

export class GoalResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiPropertyOptional()
  projectId?: string | null;

  @ApiPropertyOptional()
  projectName?: string | null;

  @ApiPropertyOptional()
  projectKey?: string | null;

  @ApiProperty()
  title!: string;

  @ApiPropertyOptional()
  description?: string | null;

  @ApiPropertyOptional()
  motivation?: string | null;

  @ApiProperty({ enum: GoalStatus })
  status!: GoalStatus;

  @ApiPropertyOptional()
  timeframe?: string | null;

  @ApiPropertyOptional()
  startDate?: string | null;

  @ApiPropertyOptional()
  targetDate?: string | null;

  @ApiPropertyOptional()
  baseline?: string | null;

  @ApiPropertyOptional()
  target?: string | null;

  @ApiProperty()
  progress!: number;

  @ApiPropertyOptional({ enum: GoalConfidence })
  confidence?: GoalConfidence | null;

  @ApiProperty({ enum: GoalCategory })
  category!: GoalCategory;

  @ApiPropertyOptional()
  dependencies?: string | null;

  @ApiPropertyOptional()
  risks?: string | null;

  @ApiProperty({ enum: GoalReviewCadence })
  reviewCadence!: GoalReviewCadence;

  @ApiProperty()
  initiatives!: GoalInitiative[];

  @ApiProperty()
  milestones!: GoalMilestone[];

  @ApiProperty({ type: [GoalMetricResponseDto] })
  metrics!: GoalMetricResponseDto[];

  @ApiProperty()
  version!: number;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class GoalSummaryResponseDto extends GoalResponseDto {
  @ApiProperty({
    description: 'Calculated progress taking metrics, milestones, and tasks into account',
  })
  measuredProgress!: number;

  @ApiPropertyOptional({ description: 'Calculated metric progress percentage (0-100)' })
  metricsProgress?: number;

  @ApiPropertyOptional({ description: 'Calculated milestone progress percentage (0-100)' })
  milestonesProgress?: number;

  @ApiPropertyOptional({ description: 'Calculated linked task progress percentage (0-100)' })
  tasksProgress?: number;

  @ApiProperty({ description: 'Linked tasks for this goal' })
  linkedTasks!: Array<{
    id: string;
    number: number;
    title: string;
    status: string;
    priority: string;
    assigneeName?: string | null;
  }>;

  @ApiProperty({ description: 'Linked decisions for this goal' })
  linkedDecisions!: Array<{
    id: string;
    number: number;
    title: string;
    status: string;
    decidedAt?: string | null;
  }>;
}
