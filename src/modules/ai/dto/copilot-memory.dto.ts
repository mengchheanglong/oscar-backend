import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  Equals,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { CopilotMemory, CopilotMemoryKind } from '../entities/copilot-memory.entity';

export class UpdateCopilotMemoryDto {
  @ApiProperty({ enum: CopilotMemoryKind })
  @IsEnum(CopilotMemoryKind)
  kind!: CopilotMemoryKind;

  @ApiProperty({ maxLength: 2000 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content!: string;

  @ApiProperty({
    type: 'boolean',
    enum: [true],
    example: true,
    description: 'The user reviewed and explicitly chose to save this text.',
  })
  @Equals(true)
  userConfirmed!: true;

  @ApiProperty({ type: 'integer', minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

export class CreateCopilotMemoryDto {
  @ApiProperty({ enum: CopilotMemoryKind })
  @IsEnum(CopilotMemoryKind)
  kind!: CopilotMemoryKind;

  @ApiProperty({ maxLength: 2000 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content!: string;

  @ApiProperty({
    type: 'boolean',
    enum: [true],
    example: true,
    description: 'The user reviewed and explicitly chose to save this text.',
  })
  @Equals(true)
  userConfirmed!: true;

  @ApiProperty({ format: 'uuid', description: 'Reuse this key when retrying the same save.' })
  @IsUUID()
  idempotencyKey!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  sourceMessageId?: string;
}

export class DeleteCopilotMemoryDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class CopilotMemoryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: CopilotMemoryKind }) kind!: CopilotMemoryKind;
  @ApiProperty() content!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) sourceMessageId!: string | null;
  @ApiProperty({ type: 'integer', minimum: 1 }) version!: number;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  static fromEntity(memory: CopilotMemory): CopilotMemoryResponseDto {
    return {
      id: memory.id,
      kind: memory.kind,
      content: memory.content,
      sourceMessageId: memory.sourceMessageId,
      version: memory.version,
      createdAt: memory.createdAt.toISOString(),
      updatedAt: memory.updatedAt.toISOString(),
    };
  }
}
