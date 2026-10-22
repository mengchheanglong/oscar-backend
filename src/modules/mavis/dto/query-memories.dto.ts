import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import {
  MavisMemoryScopeType,
  MavisMemoryStatus,
  MavisMemoryType,
} from '../entities/mavis-memory.entity';

export class QueryMemoriesDto {
  @ApiPropertyOptional({ enum: MavisMemoryScopeType })
  @IsOptional()
  @IsEnum(MavisMemoryScopeType)
  scopeType?: MavisMemoryScopeType;

  @ApiPropertyOptional({ enum: MavisMemoryType })
  @IsOptional()
  @IsEnum(MavisMemoryType)
  type?: MavisMemoryType;

  @ApiPropertyOptional({ enum: MavisMemoryStatus })
  @IsOptional()
  @IsEnum(MavisMemoryStatus)
  status?: MavisMemoryStatus;

  @ApiPropertyOptional({ description: 'Filter by project ID' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Filter by goal ID' })
  @IsOptional()
  @IsUUID()
  goalId?: string;

  @ApiPropertyOptional({ description: 'Search term for statements and rationales' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'Limit results (default: 50, max: 100)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Pagination page offset (1-based)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}
