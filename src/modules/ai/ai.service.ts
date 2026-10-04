import { Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Project } from '../projects/entities/project.entity';
import { ContextAssembler } from './context/context-assembler';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { PostMessageDto } from './dto/post-message.dto';
import {
  ChatMessage,
  CitationItem,
  MessageRole,
  MessageStatus,
} from './entities/chat-message.entity';
import { AiMode, Conversation } from './entities/conversation.entity';
import { LlmProvider } from './llm/llm-provider.interface';
import { RetrievalService } from './retrieval/retrieval.service';
import { IngestionService } from '../ingestion/ingestion.service';
import { CopilotMemoryService } from './copilot-memory.service';

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(ChatMessage)
    private readonly messageRepo: Repository<ChatMessage>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    private readonly retrievalService: RetrievalService,
    private readonly contextAssembler: ContextAssembler,
    @Inject('LLM_PROVIDER')
    private readonly llmProvider: LlmProvider,
    private readonly ingestionService: IngestionService,
    private readonly memoryService: CopilotMemoryService,
  ) {}

  onModuleInit(): void {
    const embeddingProvider = this.ingestionService.getEmbeddingProvider();
    if (embeddingProvider) {
      this.retrievalService.setEmbeddingProvider(embeddingProvider);
      this.logger.log('RetrievalService initialized with embedding provider');
    }
  }

  async createConversation(
    projectId: string,
    userId: string,
    dto: CreateConversationDto,
  ): Promise<Conversation> {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const conversation = this.conversationRepo.create({
      projectId,
      userId,
      title: dto.title?.trim() || 'New Conversation',
      defaultMode: dto.defaultMode || AiMode.PM,
    });

    return this.conversationRepo.save(conversation);
  }

  async listConversations(projectId: string, userId: string): Promise<Conversation[]> {
    return this.conversationRepo.find({
      where: {
        projectId,
        userId,
        deletedAt: IsNull(),
      },
      order: { updatedAt: 'DESC' },
    });
  }

  async getConversation(projectId: string, userId: string, id: string): Promise<Conversation> {
    const conversation = await this.conversationRepo.findOne({
      where: {
        id,
        projectId,
        userId,
        deletedAt: IsNull(),
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return conversation;
  }

  async deleteConversation(projectId: string, userId: string, id: string): Promise<void> {
    const conversation = await this.getConversation(projectId, userId, id);
    conversation.deletedAt = new Date();
    await this.conversationRepo.save(conversation);
  }

  async listMessages(
    projectId: string,
    userId: string,
    conversationId: string,
  ): Promise<ChatMessage[]> {
    await this.getConversation(projectId, userId, conversationId);

    return this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });
  }

  async postMessage(
    projectId: string,
    userId: string,
    conversationId: string,
    dto: PostMessageDto,
  ): Promise<{ userMessage: ChatMessage; assistantMessage: ChatMessage }> {
    const conversation = await this.getConversation(projectId, userId, conversationId);
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    const projectName = project?.name || 'Workspace';

    const mode = dto.mode || conversation.defaultMode || AiMode.PM;

    // Persist user message
    const userMessage = this.messageRepo.create({
      conversationId: conversation.id,
      role: MessageRole.USER,
      mode,
      content: dto.content,
      status: MessageStatus.COMPLETED,
      citations: [],
    });
    await this.messageRepo.save(userMessage);

    // Update conversation title if default, and bump updatedAt
    if (conversation.title === 'New Conversation' || !conversation.title) {
      const trimmed = dto.content.trim();
      conversation.title = trimmed.length > 50 ? `${trimmed.substring(0, 47)}...` : trimmed;
    }
    conversation.updatedAt = new Date();
    await this.conversationRepo.save(conversation);

    // Retrieve evidence
    const retrievedEvidence = await this.retrievalService.retrieve({
      actorId: userId,
      projectId,
      query: dto.content,
      filters: dto.sourceType ? { sourceType: dto.sourceType } : undefined,
      limit: 8,
      mode: 'hybrid',
    });

    // Assemble context
    const memories = await this.memoryService.list(projectId, userId, 8);
    const assembled = this.contextAssembler.assemble(
      projectName,
      mode,
      retrievedEvidence,
      memories,
    );

    // Fetch bounded history (up to 10 most recent messages)
    const recentMessages = await this.messageRepo.find({
      where: { conversationId: conversation.id },
      order: { createdAt: 'DESC' },
      take: 11,
    });

    const history = recentMessages
      .reverse()
      .filter((m) => m.id !== userMessage.id)
      .map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      }));

    const messagesForLlm = [
      { role: 'system' as const, content: assembled.systemPrompt },
      ...history,
      { role: 'user' as const, content: dto.content },
    ];

    // Generate LLM response
    let generateResult;
    try {
      generateResult = await this.llmProvider.generateAnswer({
        messages: messagesForLlm,
        evidence: assembled.evidenceItems,
      });
    } catch (err: unknown) {
      this.logger.error(`LLM error: ${err instanceof Error ? err.message : 'Unknown'}`);
      const failedMessage = this.messageRepo.create({
        conversationId: conversation.id,
        role: MessageRole.ASSISTANT,
        mode,
        content: 'An error occurred while generating the response. Please try again.',
        status: MessageStatus.FAILED,
        citations: [],
      });
      await this.messageRepo.save(failedMessage);
      return { userMessage, assistantMessage: failedMessage };
    }

    // Validate citations: must correspond strictly to retrieved evidence
    const validChunkIds = new Set(assembled.evidenceItems.map((e) => e.chunkId));
    const validatedCitations: CitationItem[] = (generateResult.citations || [])
      .filter((citation) => validChunkIds.has(citation.chunkId))
      .map((citation) => ({
        ...citation,
        evidenceNumber:
          assembled.evidenceItems.findIndex((item) => item.chunkId === citation.chunkId) + 1,
      }));

    const assistantMessage = this.messageRepo.create({
      conversationId: conversation.id,
      role: MessageRole.ASSISTANT,
      mode,
      content: generateResult.content,
      status: MessageStatus.COMPLETED,
      citations: validatedCitations,
      modelName: generateResult.modelName,
      promptTokens: generateResult.promptTokens,
      completionTokens: generateResult.completionTokens,
    });

    await this.messageRepo.save(assistantMessage);

    return { userMessage, assistantMessage };
  }
}
