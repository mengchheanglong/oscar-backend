import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class RetrieveContextDto {
  @ApiProperty({
    description: 'The current user query or goal context to retrieve relevant knowledge for',
  })
  @IsString()
  @IsNotEmpty()
  query!: string;

  @ApiPropertyOptional({ description: 'Project ID for project-scoped knowledge and evidence' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Goal ID for goal-scoped context and metrics' })
  @IsOptional()
  @IsUUID()
  goalId?: string;

  @ApiPropertyOptional({ description: 'Include approved canonical memories (default: true)' })
  @IsOptional()
  @IsBoolean()
  includeApprovedMemories?: boolean = true;

  @ApiPropertyOptional({ description: 'Include historical conversation dialogue (default: true)' })
  @IsOptional()
  @IsBoolean()
  includeHistoricalConversations?: boolean = true;

  @ApiPropertyOptional({ description: 'Include project documents, code and files (default: true)' })
  @IsOptional()
  @IsBoolean()
  includeProjectSources?: boolean = true;

  @ApiPropertyOptional({
    description: 'Include completed agent run outcomes and raw results (default: true)',
  })
  @IsOptional()
  @IsBoolean()
  includeExecutionResults?: boolean = true;

  @ApiPropertyOptional({ description: 'Max items per category (default: 6, max: 20)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}
