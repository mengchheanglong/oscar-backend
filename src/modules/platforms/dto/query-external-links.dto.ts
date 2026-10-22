import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ExternalEntityType } from '../entities/external-link.entity';
import { PlatformType } from '../entities/platform-connection.entity';

export class QueryExternalLinksDto {
  @ApiPropertyOptional({ description: 'Filter by connection ID', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  connectionId?: string;

  @ApiPropertyOptional({ enum: PlatformType })
  @IsOptional()
  @IsEnum(PlatformType)
  platformType?: PlatformType;

  @ApiPropertyOptional({ enum: ExternalEntityType })
  @IsOptional()
  @IsEnum(ExternalEntityType)
  externalEntityType?: ExternalEntityType;

  @ApiPropertyOptional({ description: 'Filter by mapped project ID', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Filter by mapped goal ID', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  goalId?: string;

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
