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
import { PlatformAuthType, PlatformType } from '../entities/platform-connection.entity';

export class CreateConnectionDto {
  @ApiProperty({ description: 'Display name for the connection', example: 'Production Paperclip' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiProperty({
    enum: PlatformType,
    description: 'Target platform type',
    example: PlatformType.PAPERCLIP,
  })
  @IsEnum(PlatformType)
  platformType!: PlatformType;

  @ApiProperty({ description: 'Platform base URL endpoint', example: 'https://api.paperclip.ai' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  baseUrl!: string;

  @ApiPropertyOptional({ enum: PlatformAuthType, default: PlatformAuthType.BEARER })
  @IsOptional()
  @IsEnum(PlatformAuthType)
  authType?: PlatformAuthType = PlatformAuthType.BEARER;

  @ApiPropertyOptional({ description: 'Authentication token or API key' })
  @IsOptional()
  @IsString()
  authToken?: string;

  @ApiPropertyOptional({ description: 'Project ID if scoped to a project', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Additional connection metadata' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
