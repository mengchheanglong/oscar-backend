import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AgentRun, AgentRunStatus } from '../entities/agent-run.entity';

export class CreateAgentRunDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Owned conversation for inline work.' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;
  @ApiProperty({ maxLength: 4000 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  prompt!: string;
  @ApiProperty({
    description: 'Stable UUID for safe creation retries. Use a new UUID for a new attempt.',
  })
  @IsUUID()
  idempotencyKey!: string;
}

export class AgentRunResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() projectId!: string;
  @ApiPropertyOptional({ nullable: true }) conversationId!: string | null;
  @ApiPropertyOptional({ nullable: true }) userMessageId!: string | null;
  @ApiPropertyOptional({ nullable: true }) assistantMessageId!: string | null;
  @ApiProperty() prompt!: string;
  @ApiProperty({ enum: AgentRunStatus }) status!: AgentRunStatus;
  @ApiProperty() model!: string;
  @ApiProperty() runtimeRevision!: string;
  @ApiProperty({ type: 'array', items: { type: 'object' } }) events!: AgentRun['events'];
  @ApiProperty({ type: 'array', items: { type: 'object' } }) evidence!: AgentRun['evidence'];
  @ApiPropertyOptional({ nullable: true }) artifact!: string | null;
  @ApiPropertyOptional({ nullable: true }) proposalId!: string | null;
  @ApiPropertyOptional({ nullable: true }) errorCode!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
  static fromEntity(r: AgentRun): AgentRunResponseDto {
    return {
      id: r.id,
      projectId: r.projectId,
      prompt: r.prompt,
      conversationId: r.conversationId,
      userMessageId: r.userMessageId,
      assistantMessageId: r.assistantMessageId,
      status: r.status,
      model: r.model,
      runtimeRevision: r.runtimeRevision,
      events: r.events,
      evidence: r.evidence,
      artifact: r.artifact,
      proposalId: r.proposalId,
      errorCode: r.errorCode,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}

export class RuntimeStatusDto {
  @ApiProperty() available!: boolean;
  @ApiProperty() runtime!: string;
  @ApiProperty() revision!: string;
}
