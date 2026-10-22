import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateDecisionDto {
  @ApiProperty({ example: 'Use PostgreSQL for primary storage', minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title!: string;

  @ApiProperty({ example: 'We will use PostgreSQL as the primary database' })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  decisionText!: string;

  @ApiPropertyOptional({ example: 'PostgreSQL supports pgvector for embeddings' })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  rationale?: string;

  @ApiPropertyOptional({ description: 'ID of an existing decision this supersedes' })
  @IsOptional()
  @IsUUID()
  supersedesDecisionId?: string;

  @ApiPropertyOptional({ description: 'UUID of associated goal' })
  @IsOptional()
  @IsUUID()
  goalId?: string;
}
