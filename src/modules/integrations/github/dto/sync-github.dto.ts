import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class SyncGitHubDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  connectionId?: string;

  @ApiPropertyOptional({ description: 'Temporary repository access token; never stored.' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  accessToken?: string;
}
