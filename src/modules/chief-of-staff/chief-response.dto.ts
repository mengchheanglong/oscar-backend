import { ApiProperty } from '@nestjs/swagger';

export class ChiefPreferencesResponseDto {
  @ApiProperty({ enum: ['OFF', 'DAILY', 'WEEKLY'] }) cadence!: string;
  @ApiProperty() hourUtc!: number;
  @ApiProperty({ type: String, nullable: true }) monthlyBudgetUsd!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) nextBriefingAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastBriefingAt!: Date | null;
}
export class ExecutionReviewResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() projectId!: string;
  @ApiProperty() platform!: string;
  @ApiProperty() runId!: string;
  @ApiProperty({ type: String, nullable: true }) goalId!: string | null;
  @ApiProperty({ enum: ['ACCEPTED', 'NEEDS_WORK', 'REJECTED'] }) verdict!: string;
  @ApiProperty() observation!: string;
  @ApiProperty({ type: String, nullable: true }) reportedCostUsd!: string | null;
  @ApiProperty({ type: String, nullable: true }) memoryId!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}
class BriefingGoalDto {
  @ApiProperty() id!: string;
  @ApiProperty({ type: String, nullable: true }) projectId!: string | null;
  @ApiProperty() title!: string;
  @ApiProperty() measuredProgress!: number;
  @ApiProperty({ type: String, nullable: true }) targetDate!: string | null;
  @ApiProperty({ type: String, nullable: true }) risks!: string | null;
}
class BriefingTaskDto {
  @ApiProperty() id!: string;
  @ApiProperty() projectId!: string;
  @ApiProperty() title!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ type: String, nullable: true }) dueDate!: string | null;
}
class BriefingWorkReviewDto {
  @ApiProperty() verdict!: string;
  @ApiProperty() observation!: string;
  @ApiProperty({ type: String, nullable: true }) memoryId!: string | null;
}
class BriefingWorkDto {
  @ApiProperty() id!: string;
  @ApiProperty() projectId!: string;
  @ApiProperty({ type: String, nullable: true }) goalId!: string | null;
  @ApiProperty({ type: String, nullable: true }) conversationId!: string | null;
  @ApiProperty() platform!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ type: BriefingWorkReviewDto, nullable: true })
  review!: BriefingWorkReviewDto | null;
}
class BriefingBudgetDto {
  @ApiProperty() period!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() reportedUsd!: number;
  @ApiProperty() unknownRuns!: number;
  @ApiProperty() trackedRuns!: number;
  @ApiProperty({ type: Number, nullable: true }) monthlyBudgetUsd!: number | null;
  @ApiProperty() overBudget!: boolean;
  @ApiProperty() scope!: string;
  @ApiProperty() costSource!: string;
  @ApiProperty() notice!: string;
}
export class ChiefBriefingResponseDto {
  @ApiProperty() generatedAt!: string;
  @ApiProperty({ type: ChiefPreferencesResponseDto }) preferences!: ChiefPreferencesResponseDto;
  @ApiProperty({ type: [BriefingGoalDto] }) goals!: BriefingGoalDto[];
  @ApiProperty({ type: [BriefingTaskDto] }) tasks!: BriefingTaskDto[];
  @ApiProperty({ type: [BriefingWorkDto] }) work!: BriefingWorkDto[];
  @ApiProperty({ type: BriefingBudgetDto }) budget!: BriefingBudgetDto;
}
export class ExecutionReviewEnvelopeDto {
  @ApiProperty({ type: ExecutionReviewResponseDto, nullable: true })
  data!: ExecutionReviewResponseDto | null;
}
