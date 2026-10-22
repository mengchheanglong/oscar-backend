import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { PlatformConnectionStatus, PlatformType } from '../entities/platform-connection.entity';

export class QueryConnectionsDto {
  @ApiPropertyOptional({ enum: PlatformType })
  @IsOptional()
  @IsEnum(PlatformType)
  platformType?: PlatformType;

  @ApiPropertyOptional({ enum: PlatformConnectionStatus })
  @IsOptional()
  @IsEnum(PlatformConnectionStatus)
  status?: PlatformConnectionStatus;

  @ApiPropertyOptional({ description: 'Filter by project ID', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}
