import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ProjectRole } from '../entities/project-member.entity';

export class AddMemberDto {
  @ApiPropertyOptional({ example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @ApiPropertyOptional({ example: 'colleague@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({
    enum: [ProjectRole.MANAGER, ProjectRole.CONTRIBUTOR, ProjectRole.VIEWER],
    example: ProjectRole.CONTRIBUTOR,
  })
  @IsEnum(ProjectRole)
  accessRole!: ProjectRole;
}
