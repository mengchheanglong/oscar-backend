import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
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
import { CreateGoalInitiativeDto, CreateGoalMilestoneDto } from './create-goal.dto';

export class UpdateGoalDto {
  @ApiProperty({ example: 1, description: 'Current version for optimistic locking' })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({
    example: 'Validate product with 10 paying customers',
    minLength: 1,
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title?: string;

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

  @ApiPropertyOptional({ enum: GoalStatus })
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

  @ApiPropertyOptional({ example: 50, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;

  @ApiPropertyOptional({ enum: GoalConfidence })
  @IsOptional()
  @IsEnum(GoalConfidence)
  confidence?: GoalConfidence;

  @ApiPropertyOptional({ enum: GoalCategory })
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

  @ApiPropertyOptional({ enum: GoalReviewCadence })
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

  @ApiPropertyOptional({
    description: 'Optional project ID to associate with this goal',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  projectId?: string | null;

  @ApiPropertyOptional({ example: 'Updated customer target after initial cohort review' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  revisionReason?: string;
}
