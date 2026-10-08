import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { AiMode } from '../entities/conversation.entity';
import { KnowledgeSourceType } from '../../ingestion/entities';

export class PostMessageDto {
  @ApiProperty({ example: 'What are the key decisions made regarding the database architecture?' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  content!: string;

  @ApiPropertyOptional({ enum: AiMode })
  @IsOptional()
  @IsEnum(AiMode)
  mode?: AiMode;

  @ApiPropertyOptional({ enum: KnowledgeSourceType })
  @IsOptional()
  @IsEnum(KnowledgeSourceType)
  sourceType?: KnowledgeSourceType;

  @ApiPropertyOptional({
    description:
      'Whether to retrieve and share context across all workspaces the user has access to',
    default: false,
  })
  @IsOptional()
  includeAllWorkspaces?: boolean;
}
