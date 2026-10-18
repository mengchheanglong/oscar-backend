import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { DecisionStatus } from '../entities/decision.entity';

export class UpdateDecisionDto {
  @ApiProperty({ example: 1, description: 'Current version for optimistic locking' })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ example: 'Updated title', minLength: 1, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional({ example: 'Updated decision text' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  decisionText?: string;

  @ApiPropertyOptional({ example: 'Updated rationale' })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  rationale?: string;

  @ApiPropertyOptional({ enum: DecisionStatus })
  @IsOptional()
  @IsEnum(DecisionStatus)
  status?: DecisionStatus;

  @ApiPropertyOptional({ description: 'ID of an existing decision this supersedes' })
  @IsOptional()
  @IsUUID()
  supersedesDecisionId?: string;
}
