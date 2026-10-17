import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { AiMode } from '../entities/conversation.entity';

export class CreateConversationDto {
  @ApiPropertyOptional({ example: 'Sprint Architecture Q&A', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({
    description: 'Use context across all accessible projects for this chat',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  includeAllWorkspaces?: boolean;

  @ApiPropertyOptional({ enum: AiMode, default: AiMode.PM })
  @IsOptional()
  @IsEnum(AiMode)
  defaultMode?: AiMode;
}
