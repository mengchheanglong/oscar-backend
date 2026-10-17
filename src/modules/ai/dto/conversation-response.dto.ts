import { ApiProperty } from '@nestjs/swagger';
import { Conversation, AiMode } from '../entities/conversation.entity';

export class ConversationResponseDto {
  @ApiProperty({ example: '85bb1fd2-d5cb-42a1-8d2a-43d96924b17f' })
  id!: string;

  @ApiProperty({ example: '85bb1fd2-d5cb-42a1-8d2a-43d96924b17f' })
  projectId!: string;

  @ApiProperty({ example: '85bb1fd2-d5cb-42a1-8d2a-43d96924b17f' })
  userId!: string;

  @ApiProperty({ example: 'Sprint Architecture Q&A' })
  title!: string;

  @ApiProperty({ enum: AiMode, example: AiMode.PM })
  defaultMode!: AiMode;

  @ApiProperty({ default: false })
  includeAllWorkspaces!: boolean;

  @ApiProperty({ default: false })
  isPinned!: boolean;

  @ApiProperty({ example: '2026-09-16T10:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-09-16T10:00:00.000Z' })
  updatedAt!: string;

  static fromEntity(conversation: Conversation): ConversationResponseDto {
    return {
      id: conversation.id,
      projectId: conversation.projectId,
      userId: conversation.userId,
      title: conversation.title,
      isPinned: conversation.isPinned ?? false,
      includeAllWorkspaces: conversation.includeAllWorkspaces ?? false,
      defaultMode: conversation.defaultMode,
      createdAt:
        conversation.createdAt instanceof Date
          ? conversation.createdAt.toISOString()
          : conversation.createdAt,
      updatedAt:
        conversation.updatedAt instanceof Date
          ? conversation.updatedAt.toISOString()
          : conversation.updatedAt,
    };
  }
}
