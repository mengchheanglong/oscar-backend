import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Task, TaskStatus, Priority } from '../entities/task.entity';

export class TaskAiProvenanceDto {
  @ApiProperty() proposalId!: string;
  @ApiProperty() sourceEntityType!: string;
  @ApiProperty() sourceEntityId!: string;
  @ApiProperty() sourceRevision!: number;
  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        sourceId: { type: 'string', format: 'uuid' },
        sourceType: { type: 'string', enum: ['DOCUMENT'] },
        title: { type: 'string' },
        revision: { type: 'integer' },
        chunkId: { type: 'string', format: 'uuid' },
        locator: { type: 'string' },
      },
    },
  })
  sourceReferences!: Array<{
    sourceId: string;
    sourceType: 'DOCUMENT';
    title: string;
    revision: number;
    chunkId: string;
    locator: string;
  }>;
}

export class TaskResponseDto {
  @ApiPropertyOptional({
    type: TaskAiProvenanceDto,
    nullable: true,
    description: 'Confirmed AI source metadata on task detail; private draft text is omitted.',
  })
  aiProvenance?: TaskAiProvenanceDto | null;
  @ApiProperty({ example: 'f87a8f89-8d7b-4029-9fa9-6f9ec67bc9e3' })
  id!: string;

  @ApiProperty({ example: 'f87a8f89-8d7b-4029-9fa9-6f9ec67bc9e3' })
  projectId!: string;

  @ApiProperty({ example: 8 })
  number!: number;

  @ApiProperty({ example: 'AIW-TASK-8' })
  displayKey!: string;

  @ApiProperty({ example: 'Implement login API' })
  title!: string;

  @ApiPropertyOptional({ example: 'Set up endpoints and cookie sessions', nullable: true })
  description!: string | null;

  @ApiProperty({ enum: TaskStatus, example: TaskStatus.TODO })
  status!: TaskStatus;

  @ApiProperty({ enum: Priority, example: Priority.MEDIUM })
  priority!: Priority;

  @ApiPropertyOptional({ nullable: true })
  assigneeId!: string | null;

  @ApiPropertyOptional({
    description: 'Assignee details when loaded',
    nullable: true,
  })
  assignee?: {
    id: string;
    displayName: string;
    email: string;
  } | null;

  @ApiPropertyOptional({
    description: 'Project details when loaded',
    nullable: true,
  })
  project?: {
    id: string;
    name: string;
    key: string;
  } | null;

  @ApiPropertyOptional({ example: 'Waiting on Phase 2 scope decision', nullable: true })
  blockedReason!: string | null;

  @ApiPropertyOptional({ example: '2026-10-15', nullable: true })
  dueDate!: string | null;

  @ApiProperty()
  createdBy!: string;

  @ApiProperty()
  updatedBy!: string;

  @ApiProperty({ example: 1 })
  version!: number;

  @ApiProperty({ example: '2026-09-10T10:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-09-10T10:00:00.000Z' })
  updatedAt!: string;

  static fromEntity(task: Task, projectKey: string): TaskResponseDto {
    return {
      id: task.id,
      projectId: task.projectId,
      number: task.number,
      displayKey: `${task.project?.key || projectKey}-TASK-${task.number}`,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      assigneeId: task.assigneeId,
      assignee: task.assignee
        ? {
            id: task.assignee.id,
            displayName: task.assignee.displayName,
            email: task.assignee.email,
          }
        : null,
      project: task.project
        ? {
            id: task.project.id,
            name: task.project.name,
            key: task.project.key,
          }
        : null,
      blockedReason: task.blockedReason ?? null,
      dueDate: task.dueDate,
      createdBy: task.createdBy,
      updatedBy: task.updatedBy,
      version: task.version,
      createdAt: task.createdAt instanceof Date ? task.createdAt.toISOString() : task.createdAt,
      updatedAt: task.updatedAt instanceof Date ? task.updatedAt.toISOString() : task.updatedAt,
    };
  }
}
