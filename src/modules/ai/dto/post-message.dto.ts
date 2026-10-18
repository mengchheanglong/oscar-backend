import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { AiMode } from '../entities/conversation.entity';
import { KnowledgeSourceType, ACTIVE_KNOWLEDGE_SOURCE_TYPES } from '../../ingestion/entities';

export class PostMessageDto {
  @ApiPropertyOptional({
    description:
      'Stable UUID for this send and its retries. Reusing it with different content is rejected.',
  })
  @IsOptional()
  @IsUUID()
  clientRequestId?: string;

  @ApiProperty({ example: 'What are the key decisions made regarding the database architecture?' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  content!: string;

  @ApiPropertyOptional({ enum: AiMode })
  @IsOptional()
  @IsEnum(AiMode)
  mode?: AiMode;

  @ApiPropertyOptional({ enum: ACTIVE_KNOWLEDGE_SOURCE_TYPES })
  @IsOptional()
  @IsIn(ACTIVE_KNOWLEDGE_SOURCE_TYPES)
  sourceType?: KnowledgeSourceType;

  @ApiPropertyOptional({
    description:
      'Whether to retrieve and share context across all workspaces the user has access to',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  includeAllWorkspaces?: boolean;
}
