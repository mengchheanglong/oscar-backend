import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AssistantProposal, ProposalStatus, ProposalType } from '../entities/proposal.entity';

export class ResultRecordDto {
  @ApiProperty({ example: 'TASK' })
  entityType!: string;

  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiPropertyOptional({ example: 'AIW-TASK-4' })
  key?: string;
}

export class ProposalResponseDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  projectId!: string;

  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  userId!: string;

  @ApiProperty({ enum: ProposalType, example: ProposalType.TASK_PROPOSAL })
  proposalType!: ProposalType;

  @ApiProperty({ example: 'DECISION' })
  sourceEntityType!: string;

  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  sourceEntityId!: string;

  @ApiProperty({ example: 1 })
  sourceRevision!: number;

  @ApiProperty({
    description:
      'Validated proposal draft. Task drafts may contain server-owned sourceReferences (document ID, title, revision, chunk ID and page/section locator), preserved during editing.',
  })
  draftJson!: Record<string, unknown>;

  @ApiProperty({ example: 1 })
  version!: number;

  @ApiProperty({ enum: ProposalStatus, example: ProposalStatus.PENDING })
  status!: ProposalStatus;

  @ApiProperty({ example: '2026-09-18T12:00:00.000Z' })
  expiresAt!: string;

  @ApiPropertyOptional({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6', nullable: true })
  confirmedBy!: string | null;

  @ApiPropertyOptional({ example: '2026-09-17T12:30:00.000Z', nullable: true })
  confirmedAt!: string | null;

  @ApiProperty({ type: [ResultRecordDto] })
  resultRecordIds!: ResultRecordDto[];

  @ApiProperty({ example: '2026-09-17T12:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-09-17T12:00:00.000Z' })
  updatedAt!: string;

  static fromEntity(entity: AssistantProposal): ProposalResponseDto {
    const dto = new ProposalResponseDto();
    dto.id = entity.id;
    dto.projectId = entity.projectId;
    dto.userId = entity.userId;
    dto.proposalType = entity.proposalType;
    dto.sourceEntityType = entity.sourceEntityType;
    dto.sourceEntityId = entity.sourceEntityId;
    dto.sourceRevision = entity.sourceRevision;
    dto.draftJson = entity.draftJson;
    dto.version = entity.version;
    dto.status = entity.status;
    dto.expiresAt = entity.expiresAt.toISOString();
    dto.confirmedBy = entity.confirmedBy ?? null;
    dto.confirmedAt = entity.confirmedAt ? entity.confirmedAt.toISOString() : null;
    dto.resultRecordIds = entity.resultRecordIds ?? [];
    dto.createdAt = entity.createdAt.toISOString();
    dto.updatedAt = entity.updatedAt.toISOString();
    return dto;
  }
}
