import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class TaskProgressDto {
  @ApiProperty({ description: 'Number of completed tasks (DONE)', example: 5 })
  done!: number;

  @ApiProperty({
    description: 'Total number of active (non-deleted, non-cancelled) tasks',
    example: 10,
  })
  total!: number;

  @ApiPropertyOptional({
    description: 'Progress percentage rounded to integer, or null if no tasks',
    example: 50,
    nullable: true,
  })
  percentage!: number | null;

  @ApiProperty({
    description: 'Formatted label, e.g. "50%" or "No tasks yet"',
    example: '50%',
  })
  label!: string;
}

export class TaskCountsByStatusDto {
  @ApiProperty({ example: 2 })
  TODO!: number;

  @ApiProperty({ example: 3 })
  IN_PROGRESS!: number;

  @ApiProperty({ example: 1 })
  IN_REVIEW!: number;

  @ApiProperty({ example: 5 })
  DONE!: number;

  @ApiProperty({ example: 0 })
  CANCELLED!: number;

  @ApiProperty({ example: 0 })
  BLOCKED!: number;
}

export class RequirementCountsByStatusDto {
  @ApiProperty({ example: 1 })
  DRAFT!: number;

  @ApiProperty({ example: 1 })
  IN_REVIEW!: number;

  @ApiProperty({ example: 2 })
  APPROVED!: number;

  @ApiProperty({ example: 3 })
  IN_PROGRESS!: number;

  @ApiProperty({ example: 1 })
  DONE!: number;

  @ApiProperty({ example: 0 })
  ARCHIVED!: number;
}

export class ProjectSummaryDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d' })
  id!: string;

  @ApiProperty({ example: 'AIW' })
  key!: string;

  @ApiProperty({ example: 'Continuum' })
  name!: string;

  @ApiPropertyOptional({ example: 'Workspace for building AI software', nullable: true })
  description!: string | null;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;
}

export class ActivityActorDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d' })
  id!: string;

  @ApiProperty({ example: 'Alice Developer' })
  displayName!: string;

  @ApiProperty({ example: 'alice@example.com' })
  email!: string;
}

export class RecentActivityItemDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d' })
  id!: string;

  @ApiProperty({ example: 'CREATE_TASK' })
  action!: string;

  @ApiProperty({ example: 'TASK' })
  entityType!: string;

  @ApiPropertyOptional({ example: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d', nullable: true })
  entityId!: string | null;

  @ApiPropertyOptional({ type: ActivityActorDto, nullable: true })
  actor!: ActivityActorDto | null;

  @ApiPropertyOptional({ example: { number: 1, title: 'Build Search' }, nullable: true })
  metadata!: Record<string, unknown> | null;

  @ApiProperty({ example: '2026-09-15T12:00:00.000Z' })
  createdAt!: Date;
}

export class DashboardResponseDto {
  @ApiProperty({ type: ProjectSummaryDto })
  project!: ProjectSummaryDto;

  @ApiProperty({ type: TaskProgressDto })
  taskProgress!: TaskProgressDto;

  @ApiProperty({ type: TaskCountsByStatusDto })
  taskCountsByStatus!: TaskCountsByStatusDto;

  @ApiProperty({
    description: 'Number of active tasks with due date prior to today in display timezone',
    example: 2,
  })
  overdueTasksCount!: number;

  @ApiProperty({
    description: 'Number of active non-completed tasks assigned to the requesting user',
    example: 3,
  })
  myAssignedTasksCount!: number;

  @ApiProperty({ type: RequirementCountsByStatusDto })
  requirementCountsByStatus!: RequirementCountsByStatusDto;

  @ApiPropertyOptional({
    description: 'Project summary description / derived status text',
    example: 'Workspace for building AI software',
    nullable: true,
  })
  summary!: string | null;

  @ApiProperty({ type: [RecentActivityItemDto] })
  recentActivity!: RecentActivityItemDto[];
}

export class ListActivityQueryDto {
  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
