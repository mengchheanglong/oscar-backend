import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import {
  KnowledgeSourceStatus,
  KnowledgeSourceType,
  ACTIVE_KNOWLEDGE_SOURCE_TYPES,
} from '../entities/knowledge-source.entity';

export class ListKnowledgeSourcesDto {
  @ApiPropertyOptional({ enum: ACTIVE_KNOWLEDGE_SOURCE_TYPES })
  @IsOptional()
  @IsIn(ACTIVE_KNOWLEDGE_SOURCE_TYPES)
  sourceType?: KnowledgeSourceType;

  @ApiPropertyOptional({ enum: KnowledgeSourceStatus })
  @IsOptional()
  @IsEnum(KnowledgeSourceStatus)
  status?: KnowledgeSourceStatus;

  @ApiPropertyOptional({ description: 'Search term for title' })
  @IsOptional()
  @IsString()
  search?: string;
}
