import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PlatformHandoffResponseDto {
  @ApiProperty({ enum: ['t3', 'paperclip'] }) platformType!: string;
  @ApiPropertyOptional({ nullable: true }) remoteAgentId!: string | null;
  @ApiPropertyOptional({ nullable: true }) externalUrl!: string | null;
  @ApiProperty() id!: string;
  @ApiProperty() projectId!: string;
  @ApiProperty() conversationId!: string;
  @ApiProperty({ nullable: true }) remoteProjectId!: string | null;
  @ApiProperty() prompt!: string;
  @ApiProperty({
    enum: [
      'QUEUED',
      'DISPATCHING',
      'UNCERTAIN',
      'RUNNING',
      'WAITING',
      'SUCCEEDED',
      'FAILED',
      'CANCELLED',
    ],
  })
  status!: string;
  @ApiPropertyOptional({ nullable: true }) threadId!: string | null;
  @ApiPropertyOptional({ nullable: true }) runId!: string | null;
  @ApiPropertyOptional({ nullable: true }) remoteStatus!: string | null;
  @ApiPropertyOptional({ nullable: true }) result!: string | null;
  @ApiPropertyOptional({ nullable: true }) notice!: string | null;
  @ApiPropertyOptional({ nullable: true }) assistantMessageId!: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}
export class T3ModelResponseDto {
  @ApiProperty() provider!: string;
  @ApiProperty() instanceId!: string;
  @ApiProperty() model!: string;
  @ApiProperty() label!: string;
}

class PaperclipTargetDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}
export class PaperclipTargetsResponseDto {
  @ApiProperty({ type: [PaperclipTargetDto] }) agents!: PaperclipTargetDto[];
  @ApiProperty({ type: [PaperclipTargetDto] }) projects!: PaperclipTargetDto[];
}
