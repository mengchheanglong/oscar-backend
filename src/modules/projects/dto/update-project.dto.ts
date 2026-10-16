import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class UpdateProjectDto {
  @ApiPropertyOptional({ example: 'Renamed Project', minLength: 1, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'Updated project description' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 32, description: 'Project emoji icon' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  icon?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 4000,
    description: 'Shared project guidance for Assistant and Hermes; does not grant permissions',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  instructions?: string | null;

  @ApiPropertyOptional({
    description: 'Expected version number for optimistic concurrency control',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}
