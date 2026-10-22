import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { PlatformAuthType } from '../entities/platform-connection.entity';

export class UpdateConnectionDto {
  @ApiPropertyOptional({ description: 'Display name for the connection' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ description: 'Platform base URL endpoint' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  baseUrl?: string;

  @ApiPropertyOptional({ enum: PlatformAuthType })
  @IsOptional()
  @IsEnum(PlatformAuthType)
  authType?: PlatformAuthType;

  @ApiPropertyOptional({ description: 'Updated authentication token or API key' })
  @IsOptional()
  @IsString()
  authToken?: string;

  @ApiPropertyOptional({ description: 'Additional connection metadata' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
