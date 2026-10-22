import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  GoalCategory,
  GoalConfidence,
  GoalReviewCadence,
  GoalStatus,
} from '../entities/goal.entity';

export class CreateGoalMilestoneDto {
  @ApiProperty({ example: 'm-1' })
  @IsString()
  id!: string;

  @ApiProperty({ example: 'Complete prototype and deploy to staging' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  @ApiPropertyOptional({ example: '2026-11-15' })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'targetDate must be in YYYY-MM-DD format' })
  targetDate?: string | null;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  completed?: boolean;

  @ApiPropertyOptional({ example: null })
  @IsOptional()
  @IsString()
  completedAt?: string | null;
}

export class CreateGoalInitiativeDto {
  @ApiProperty({ example: 'init-1' })
  @IsString()
  id!: string;

  @ApiProperty({ example: 'Establish payment processor integration' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  @ApiPropertyOptional({ example: 'Integrate Stripe customer portal' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ enum: ['TODO', 'IN_PROGRESS', 'DONE'], default: 'TODO' })
  @IsOptional()
  @IsEnum(['TODO', 'IN_PROGRESS', 'DONE'])
  status?: 'TODO' | 'IN_PROGRESS' | 'DONE';
}

export class CreateGoalDto {
  @ApiProperty({
    example: 'Validate product with 10 paying customers',
    minLength: 1,
    maxLength: 500,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title!: string;

  @ApiPropertyOptional({ example: 'Detailed description of the strategic validation goal' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({ example: 'Why this goal is essential for sustainable business traction' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  motivation?: string;

  @ApiPropertyOptional({ enum: GoalStatus, default: GoalStatus.ACTIVE })
  @IsOptional()
  @IsEnum(GoalStatus)
  status?: GoalStatus;

  @ApiPropertyOptional({ example: 'Q4 2026' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  timeframe?: string;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate must be in YYYY-MM-DD format' })
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'targetDate must be in YYYY-MM-DD format' })
  targetDate?: string;

  @ApiPropertyOptional({ example: '0 paying customers, 2 beta testers' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  baseline?: string;

  @ApiPropertyOptional({ example: '10 paying customers with >$50/mo ARR' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  target?: string;

  @ApiPropertyOptional({ example: 0, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;

  @ApiPropertyOptional({ enum: GoalConfidence })
  @IsOptional()
  @IsEnum(GoalConfidence)
  confidence?: GoalConfidence;

  @ApiPropertyOptional({ enum: GoalCategory, default: GoalCategory.BUSINESS })
  @IsOptional()
  @IsEnum(GoalCategory)
  category?: GoalCategory;

  @ApiPropertyOptional({ example: 'Stripe onboarding, customer interviews' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  dependencies?: string;

  @ApiPropertyOptional({ example: 'High customer churn, onboarding drop-off' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  risks?: string;

  @ApiPropertyOptional({ enum: GoalReviewCadence, default: GoalReviewCadence.WEEKLY })
  @IsOptional()
  @IsEnum(GoalReviewCadence)
  reviewCadence?: GoalReviewCadence;

  @ApiPropertyOptional({ type: [CreateGoalMilestoneDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateGoalMilestoneDto)
  milestones?: CreateGoalMilestoneDto[];

  @ApiPropertyOptional({ type: [CreateGoalInitiativeDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateGoalInitiativeDto)
  initiatives?: CreateGoalInitiativeDto[];

  @ApiPropertyOptional({ description: 'Optional project ID to associate with this goal' })
  @IsOptional()
  @IsUUID()
  projectId?: string;
}
