import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Decision, DecisionStatus } from '../entities/decision.entity';

export class DecisionResponseDto {
  @ApiProperty({ example: 'f87a8f89-8d7b-4029-9fa9-6f9ec67bc9e3' })
  id!: string;

  @ApiProperty({ example: 'f87a8f89-8d7b-4029-9fa9-6f9ec67bc9e3' })
  projectId!: string;

  @ApiProperty({ example: 3 })
  number!: number;

  @ApiProperty({ example: 'AIW-DEC-3' })
  displayKey!: string;

  @ApiProperty({ example: 'Use PostgreSQL for primary storage' })
  title!: string;

  @ApiProperty({ example: 'We will use PostgreSQL as the primary database' })
  decisionText!: string;

  @ApiPropertyOptional({ nullable: true })
  rationale!: string | null;

  @ApiProperty({ enum: DecisionStatus, example: DecisionStatus.PROPOSED })
  status!: DecisionStatus;

  @ApiPropertyOptional({ nullable: true, example: '2026-09-09T10:00:00.000Z' })
  decidedAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  decidedBy!: string | null;

  @ApiPropertyOptional({ nullable: true })
  supersedesDecisionId!: string | null;

  @ApiProperty()
  createdBy!: string;

  @ApiProperty()
  updatedBy!: string;

  @ApiProperty({ example: 1 })
  version!: number;

  @ApiProperty({ example: '2026-09-09T10:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-09-09T10:00:00.000Z' })
  updatedAt!: string;

  static fromEntity(decision: Decision, projectKey: string): DecisionResponseDto {
    return {
      id: decision.id,
      projectId: decision.projectId,
      number: decision.number,
      displayKey: `${projectKey}-DEC-${decision.number}`,
      title: decision.title,
      decisionText: decision.decisionText,
      rationale: decision.rationale,
      status: decision.status,
      decidedAt:
        decision.decidedAt instanceof Date ? decision.decidedAt.toISOString() : decision.decidedAt,
      decidedBy: decision.decidedBy,
      supersedesDecisionId: decision.supersedesDecisionId,
      createdBy: decision.createdBy,
      updatedBy: decision.updatedBy,
      version: decision.version,
      createdAt:
        decision.createdAt instanceof Date ? decision.createdAt.toISOString() : decision.createdAt,
      updatedAt:
        decision.updatedAt instanceof Date ? decision.updatedAt.toISOString() : decision.updatedAt,
    };
  }
}
