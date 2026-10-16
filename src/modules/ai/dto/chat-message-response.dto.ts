import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ChatMessage,
  CitationItem,
  MessageRole,
  MessageStatus,
} from '../entities/chat-message.entity';
import { AiMode } from '../entities/conversation.entity';

export class ChatMessageResponseDto {
  @ApiProperty({ example: '32cb5e48-8dfa-45c1-8419-756da3df4f32' })
  id!: string;

  @ApiProperty({ example: '85bb1fd2-d5cb-42a1-8d2a-43d96924b17f' })
  conversationId!: string;

  @ApiProperty({ enum: MessageRole, example: MessageRole.USER })
  role!: MessageRole;

  @ApiProperty({ enum: AiMode, example: AiMode.PM })
  mode!: AiMode;

  @ApiProperty({ example: 'What are the key decisions made regarding the database architecture?' })
  content!: string;

  @ApiProperty({ enum: MessageStatus, example: MessageStatus.COMPLETED })
  status!: MessageStatus;

  @ApiProperty({
    description: 'Excluded from future dialogue context and history recall.',
    default: false,
  })
  contextExcluded!: boolean;

  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        evidenceNumber: {
          type: 'number',
          description: 'Original evidence marker number in the answer',
        },
        chunkId: { type: 'string' },
        sourceId: { type: 'string' },
        sourceType: { type: 'string' },
        title: { type: 'string' },
        revision: { type: 'number' },
        locator: { type: 'string', nullable: true },
        score: { type: 'number', nullable: true },
        snippet: { type: 'string', nullable: true },
      },
    },
  })
  citations!: CitationItem[];

  @ApiPropertyOptional({ example: 'deepseek-flash', nullable: true })
  modelName!: string | null;

  @ApiPropertyOptional({ example: 450, nullable: true })
  promptTokens!: number | null;

  @ApiPropertyOptional({ example: 180, nullable: true })
  completionTokens!: number | null;

  @ApiProperty({ example: '2026-09-16T10:00:00.000Z' })
  createdAt!: string;

  static fromEntity(message: ChatMessage): ChatMessageResponseDto {
    return {
      id: message.id,
      conversationId: message.conversationId,
      role: message.role,
      mode: message.mode,
      content: message.content,
      status: message.status,
      contextExcluded: message.contextExcluded ?? false,
      citations: message.citations || [],
      modelName: message.modelName,
      promptTokens: message.promptTokens,
      completionTokens: message.completionTokens,
      createdAt:
        message.createdAt instanceof Date ? message.createdAt.toISOString() : message.createdAt,
    };
  }
}
