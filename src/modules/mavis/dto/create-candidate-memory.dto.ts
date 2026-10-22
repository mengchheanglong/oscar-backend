import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsDateString,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  MavisMemoryScopeType,
  MavisMemoryType,
  MavisSourceType,
} from '../entities/mavis-memory.entity';

export class CreateCandidateMemoryDto {
  @ApiProperty({ description: 'The substantive statement or finding of the memory' })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(2000)
  statement!: string;

  @ApiPropertyOptional({ description: 'Optional explanation or reasoning behind this memory' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  rationale?: string;

  @ApiProperty({ enum: MavisMemoryType, description: 'Canonical type of memory' })
  @IsEnum(MavisMemoryType)
  type!: MavisMemoryType;

  @ApiProperty({ enum: MavisMemoryScopeType, description: 'Scope of applicability' })
  @IsEnum(MavisMemoryScopeType)
  scopeType!: MavisMemoryScopeType;

  @ApiPropertyOptional({ description: 'Project ID if scoped or linked to a project' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Goal ID if scoped or linked to a goal' })
  @IsOptional()
  @IsUUID()
  goalId?: string;

  @ApiPropertyOptional({
    description: 'Platform originating this candidate memory',
    default: 'oscar',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  sourcePlatform?: string;

  @ApiPropertyOptional({
    enum: MavisSourceType,
    description: 'Kind of source generating the memory',
  })
  @IsOptional()
  @IsEnum(MavisSourceType)
  sourceType?: MavisSourceType;

  @ApiPropertyOptional({
    description: 'ID of originating entity (run ID, message ID, decision ID, etc.)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sourceId?: string;

  @ApiPropertyOptional({ description: 'Additional structured provenance metadata' })
  @IsOptional()
  @IsObject()
  sourceMetadata?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Expiration date after which memory is considered stale' })
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiPropertyOptional({ description: 'Optional idempotency key to prevent duplicate creation' })
  @IsOptional()
  @IsUUID()
  idempotencyKey?: string;
}
