import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePlatformHandoffDto {
  @ApiPropertyOptional({ enum: ['t3', 'paperclip'], default: 't3' })
  @IsIn(['t3', 'paperclip'])
  platformType?: 't3' | 'paperclip' = 't3';
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  providerInstanceId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  model?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  remoteAgentId?: string;
  @ApiProperty() @IsUUID() conversationId!: string;
  @ApiProperty() @IsUUID() connectionId!: string;
  @ApiProperty() @IsUUID() idempotencyKey!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  remoteProjectId?: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(12000) prompt!: string;
}
