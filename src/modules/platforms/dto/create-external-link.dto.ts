import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ExternalEntityType } from '../entities/external-link.entity';

export class CreateExternalLinkDto {
  @ApiProperty({ description: 'Connection ID this record belongs to', format: 'uuid' })
  @IsUUID()
  connectionId!: string;

  @ApiProperty({ enum: ExternalEntityType, description: 'Type of external entity' })
  @IsEnum(ExternalEntityType)
  externalEntityType!: ExternalEntityType;

  @ApiProperty({ description: 'External entity ID on the native platform', example: 'issue-42' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  externalId!: string;

  @ApiProperty({
    description: 'External entity title or summary',
    example: 'Implement auth adapter',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  externalTitle?: string;

  @ApiProperty({ description: 'Deep link URL to native platform record' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  externalUrl?: string;

  @ApiPropertyOptional({ description: 'OSCAR Project ID to map to', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ description: 'OSCAR Goal ID to map to', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  goalId?: string;

  @ApiPropertyOptional({ description: 'Entity metadata and state snapshot' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
