import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiConflictResponse,
  ApiTooManyRequestsResponse,
  ApiPayloadTooLargeResponse,
  ApiServiceUnavailableResponse,
  ApiExtraModels,
  getSchemaPath,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { ProjectPolicyGuard } from '../../common/guards/project-policy.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { User } from '../users/entities/user.entity';
import { AssistantService } from './assistant.service';
import { ChatMessageResponseDto } from './dto/chat-message-response.dto';
import { ConversationResponseDto } from './dto/conversation-response.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { PostMessageDto } from './dto/post-message.dto';

@ApiTags('AI Assistant')
@ApiExtraModels(ChatMessageResponseDto)
@ApiCookieAuth()
@Controller('projects/:projectId/ai/conversations')
@UseGuards(SessionAuthGuard, CsrfGuard, ProjectPolicyGuard)
export class AssistantController {
  constructor(private readonly aiService: AssistantService) {}

  @Get()
  @ApiOperation({ summary: 'List user conversations in the project' })
  @ApiOkResponse({ description: 'Conversations returned', type: [ConversationResponseDto] })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiNotFoundResponse({ description: 'Project not found' })
  async listConversations(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: User,
  ): Promise<ConversationResponseDto[]> {
    const conversations = await this.aiService.listConversations(projectId, user.id);
    return conversations.map((conv) => ConversationResponseDto.fromEntity(conv));
  }

  @Post()
  @ApiOperation({ summary: 'Create a new conversation' })
  @ApiCreatedResponse({ description: 'Conversation created', type: ConversationResponseDto })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiNotFoundResponse({ description: 'Project not found' })
  async createConversation(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateConversationDto,
  ): Promise<ConversationResponseDto> {
    const conversation = await this.aiService.createConversation(projectId, user.id, dto);
    return ConversationResponseDto.fromEntity(conversation);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get conversation details' })
  @ApiOkResponse({ description: 'Conversation details returned', type: ConversationResponseDto })
  @ApiNotFoundResponse({ description: 'Conversation not found' })
  async getConversation(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<ConversationResponseDto> {
    const conversation = await this.aiService.getConversation(projectId, user.id, id);
    return ConversationResponseDto.fromEntity(conversation);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename or pin your own conversation' })
  @ApiOkResponse({ type: ConversationResponseDto })
  @ApiNotFoundResponse({ description: 'Conversation not found or inaccessible' })
  async updateConversation(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateConversationDto,
  ): Promise<ConversationResponseDto> {
    return ConversationResponseDto.fromEntity(
      await this.aiService.updateConversation(projectId, user.id, id, dto),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a conversation' })
  @ApiNoContentResponse({ description: 'Conversation deleted' })
  @ApiNotFoundResponse({ description: 'Conversation not found' })
  async deleteConversation(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.aiService.deleteConversation(projectId, user.id, id);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'List messages in a conversation' })
  @ApiOkResponse({ description: 'Messages returned', type: [ChatMessageResponseDto] })
  @ApiNotFoundResponse({ description: 'Conversation not found' })
  async listMessages(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<ChatMessageResponseDto[]> {
    const messages = await this.aiService.listMessages(projectId, user.id, id);
    return messages.map((m) => ChatMessageResponseDto.fromEntity(m));
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Post a message and receive an AI assistant response' })
  @ApiConflictResponse({
    description:
      'Conversation is busy, context changed, a request UUID was reused with different input, or an unfinished turn is too old to retry.',
  })
  @ApiTooManyRequestsResponse({
    description: 'This backend has reached its concurrent chat capacity.',
  })
  @ApiPayloadTooLargeResponse({
    description: 'Required context or unsummarized history exceeds safe bounds.',
  })
  @ApiServiceUnavailableResponse({
    description: 'Retrieval or context summarization failed; original messages are preserved.',
  })
  @ApiCreatedResponse({
    description: 'Message sent and assistant response generated',
    schema: {
      type: 'object',
      required: ['userMessage', 'assistantMessage'],
      properties: {
        userMessage: { $ref: getSchemaPath(ChatMessageResponseDto) },
        assistantMessage: { $ref: getSchemaPath(ChatMessageResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Conversation not found' })
  async postMessage(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: PostMessageDto,
  ): Promise<{ userMessage: ChatMessageResponseDto; assistantMessage: ChatMessageResponseDto }> {
    const { userMessage, assistantMessage } = await this.aiService.postMessage(
      projectId,
      user.id,
      id,
      dto,
    );

    return {
      userMessage: ChatMessageResponseDto.fromEntity(userMessage),
      assistantMessage: ChatMessageResponseDto.fromEntity(assistantMessage),
    };
  }

  @Post(':id/messages/:messageId/exclude-context')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Exclude a message and affected generated replies from future context; preserve transcripts',
  })
  @ApiNoContentResponse({ description: 'Message excluded, dependent summaries invalidated.' })
  @ApiNotFoundResponse({ description: 'Conversation or message not found.' })
  async excludeMessage(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.aiService.excludeMessage(projectId, user.id, id, messageId);
  }
}
