import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { TaskStatus, Priority } from '../entities/task.entity';

export class UpdateTaskDto {
  @ApiProperty({ example: 1, description: 'Current version for optimistic locking' })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ example: 'Updated task title', minLength: 1, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional({ example: 'Updated description', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @ApiPropertyOptional({ enum: TaskStatus })
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @ApiPropertyOptional({ enum: Priority })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @ApiPropertyOptional({ description: 'UUID of assigned team member', nullable: true })
  @IsOptional()
  @IsUUID()
  assigneeId?: string | null;

  @ApiPropertyOptional({
    example: '2026-10-20',
    description: 'Due date in YYYY-MM-DD format',
    nullable: true,
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dueDate must be in YYYY-MM-DD format' })
  dueDate?: string | null;

  @ApiPropertyOptional({
    example: 'Waiting on Phase 2 scope decision',
    description: 'Reason why the task is blocked',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  blockedReason?: string | null;

  @ApiPropertyOptional({ description: 'UUID of associated goal', nullable: true })
  @IsOptional()
  @IsUUID()
  goalId?: string | null;
}
