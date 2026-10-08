import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ProjectRole } from '../entities/project-member.entity';

export class ProjectInitialMemberDto {
  @ApiProperty({
    example: '85bb1fd2-d5cb-42a1-8d2a-43d96924b17f',
    description: 'User ID of the member to invite',
  })
  @IsUUID()
  userId!: string;

  @ApiPropertyOptional({
    enum: [ProjectRole.MANAGER, ProjectRole.CONTRIBUTOR, ProjectRole.VIEWER],
    default: ProjectRole.CONTRIBUTOR,
  })
  @IsOptional()
  @IsEnum([ProjectRole.MANAGER, ProjectRole.CONTRIBUTOR, ProjectRole.VIEWER], {
    message: 'Role must be MANAGER, CONTRIBUTOR, or VIEWER',
  })
  role?: ProjectRole;
}

export class CreateProjectDto {
  @ApiProperty({
    example: 'AIW',
    description: 'Unique project key identifier (2-10 uppercase alphanumeric characters)',
  })
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z0-9]{2,10}$/, {
    message: 'Project key must consist of 2 to 10 uppercase letters or numbers.',
  })
  key!: string;

  @ApiProperty({ example: 'AI Workspace Core', minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ example: 'Central backend workspace for multi-modal project management' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({
    type: () => [ProjectInitialMemberDto],
    description: 'Initial workspace members to invite into the project',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProjectInitialMemberDto)
  members?: ProjectInitialMemberDto[];
}
