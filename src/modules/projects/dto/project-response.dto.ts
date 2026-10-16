import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Project, ProjectStatus } from '../entities/project.entity';
import { ProjectRole } from '../entities/project-member.entity';

export class ProjectResponseDto {
  @ApiProperty({ example: 'f87a8f89-8d7b-4029-9fa9-6f9ec67bc9e3' })
  id!: string;

  @ApiProperty({ example: 'AIW' })
  key!: string;

  @ApiProperty({ example: 'Continuum Core' })
  name!: string;

  @ApiPropertyOptional({ example: 'Project description', nullable: true })
  description!: string | null;

  @ApiPropertyOptional({ nullable: true })
  icon!: string | null;

  @ApiPropertyOptional({ nullable: true })
  instructions!: string | null;

  @ApiProperty({ enum: ProjectStatus, example: ProjectStatus.ACTIVE })
  status!: ProjectStatus;

  @ApiProperty({ example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  createdBy!: string;

  @ApiProperty({ example: 1 })
  version!: number;

  @ApiPropertyOptional({ enum: ProjectRole, example: ProjectRole.OWNER })
  currentUserRole?: ProjectRole;

  @ApiProperty({ example: '2026-09-09T10:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-09-09T10:00:00.000Z' })
  updatedAt!: string;

  static fromEntity(project: Project, currentUserRole?: ProjectRole): ProjectResponseDto {
    return {
      id: project.id,
      key: project.key,
      name: project.name,
      description: project.description,
      icon: project.icon ?? null,
      instructions: project.instructions ?? null,
      status: project.status,
      createdBy: project.createdBy,
      version: project.version,
      currentUserRole,
      createdAt:
        project.createdAt instanceof Date ? project.createdAt.toISOString() : project.createdAt,
      updatedAt:
        project.updatedAt instanceof Date ? project.updatedAt.toISOString() : project.updatedAt,
    };
  }
}
