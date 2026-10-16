import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { ProjectMember } from '../projects/entities/project-member.entity';
import { Project, ProjectStatus } from '../projects/entities/project.entity';
import { SystemRole, User } from '../users/entities/user.entity';
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
import { PrivateMemoryService } from './memory/private-memory.service';
import { ConversationContextService } from './context/conversation-context.service';

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
    @InjectRepository(ProjectMember)
    private readonly projectMemberRepo: Repository<ProjectMember>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly retrievalService: RetrievalService,
    private readonly contextAssembler: ContextAssembler,
    @Inject('LLM_PROVIDER')
    private readonly llmProvider: LlmProvider,
    private readonly ingestionService: IngestionService,
    private readonly memoryService: PrivateMemoryService,
    private readonly conversationContext: ConversationContextService,
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
    await this.conversationContext.deleteConversation({ projectId, userId, conversationId: id });
  }

  async excludeMessage(
    projectId: string,
    userId: string,
    conversationId: string,
    messageId: string,
  ): Promise<void> {
    await this.conversationContext.excludeMessage({ projectId, userId, conversationId }, messageId);
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
    return this.conversationContext.withTurn({ projectId, userId, conversationId }, () =>
      this.postMessageTurn(projectId, userId, conversationId, dto),
    );
  }

  private async postMessageTurn(
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

    // Determine target project scope
    const includeAllWorkspaces = !!dto.includeAllWorkspaces;
    let targetProjectIds = [projectId];
    if (includeAllWorkspaces) {
      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (user?.systemRole === SystemRole.ADMIN) {
        const allActiveProjects = await this.projectRepo.find({
          where: { status: ProjectStatus.ACTIVE },
          select: ['id'],
        });
        targetProjectIds = allActiveProjects.map((p) => p.id);
      } else {
        const activeMemberships = await this.projectMemberRepo.find({
          where: { userId, removedAt: IsNull() },
          select: ['projectId'],
        });
        targetProjectIds = Array.from(
          new Set([projectId, ...activeMemberships.map((m) => m.projectId)]),
        );
      }
    }

    // Retrieve evidence
    const retrievedEvidence = await this.retrievalService
      .retrieve({
        actorId: userId,
        projectId,
        projectIds: targetProjectIds,
        query: dto.content,
        filters: dto.sourceType ? { sourceType: dto.sourceType } : undefined,
        limit: includeAllWorkspaces ? 12 : 8,
        mode: 'hybrid',
      })
      .catch(() => {
        this.logger.error('AI_RETRIEVAL_FAILED');
        throw new ServiceUnavailableException({
          code: 'AI_RETRIEVAL_FAILED',
          message: 'Project search could not complete. Your request is saved; please retry.',
        });
      });

    // Build inventory overview for the target workspaces
    const inventoryOverview = await this.buildInventoryOverview(targetProjectIds);

    // Assemble context
    const memories = await this.memoryService.select(projectId, userId, dto.content);
    const assembled = this.contextAssembler.assemble(
      includeAllWorkspaces ? 'All Workspaces' : projectName,
      mode,
      retrievedEvidence,
      includeAllWorkspaces,
      inventoryOverview,
      memories,
    );

    const scope = { projectId, userId, conversationId };
    const prepared = await this.conversationContext.prepare(
      scope,
      userMessage.id,
      assembled.systemPrompt,
    );

    // Generate LLM response
    let generateResult;
    try {
      generateResult = await this.llmProvider.generateAnswer({
        messages: prepared.messages,
        evidence: assembled.evidenceItems,
      });
    } catch {
      this.logger.error('AI_GENERATION_FAILED');
      const failedMessage = this.messageRepo.create({
        conversationId: conversation.id,
        role: MessageRole.ASSISTANT,
        mode,
        content: 'An error occurred while generating the response. Please try again.',
        status: MessageStatus.FAILED,
        citations: [],
      });
      await this.conversationContext.commit(scope, { ...prepared, compactions: 0 }, failedMessage);
      return { userMessage, assistantMessage: failedMessage };
    }

    // Validate citations: must correspond strictly to retrieved evidence
    const evidenceByChunkId = new Map(assembled.evidenceItems.map((e) => [e.chunkId, e]));
    const validatedCitations: CitationItem[] = (generateResult.citations || [])
      .filter((citation) => evidenceByChunkId.has(citation.chunkId))
      .map((citation) => {
        const matched = evidenceByChunkId.get(citation.chunkId);
        return {
          ...citation,
          evidenceNumber:
            assembled.evidenceItems.findIndex((item) => item.chunkId === citation.chunkId) + 1,
          projectName: matched?.projectName ?? citation.projectName,
          projectKey: matched?.projectKey ?? citation.projectKey,
        };
      });

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

    await this.conversationContext.commit(scope, prepared, assistantMessage);

    return { userMessage, assistantMessage };
  }

  private async buildInventoryOverview(projectIds: string[]): Promise<string> {
    if (!projectIds.length || typeof this.projectRepo?.manager?.query !== 'function') return '';
    try {
      const projects = await this.projectRepo.find({
        where: { id: In(projectIds) },
        select: ['id', 'key', 'name'],
      });

      const counts = await this.projectRepo.manager.query<
        { project_id: string; source_type: string; count: string }[]
      >(
        `SELECT project_id, source_type, COUNT(*)::text as count
         FROM knowledge_sources
         WHERE project_id = ANY($1::uuid[]) AND deleted_at IS NULL AND status = 'INDEXED'
         GROUP BY project_id, source_type`,
        [projectIds],
      );

      const docs = await this.projectRepo.manager.query<{ project_id: string; title: string }[]>(
        `SELECT project_id, title
         FROM documents
         WHERE project_id = ANY($1::uuid[]) AND deleted_at IS NULL`,
        [projectIds],
      );

      const lines: string[] = ['Projects in scope:'];
      for (const p of projects) {
        const pCounts = counts.filter((c) => c.project_id === p.id);
        const pDocs = docs.filter((d) => d.project_id === p.id).map((d) => d.title);
        const domainCounts = pCounts
          .filter((c) =>
            ['TASK', 'REQUIREMENT', 'DECISION', 'MEETING', 'DOCUMENT'].includes(c.source_type),
          )
          .map((c) => `${c.count} ${c.source_type.toLowerCase()}s`)
          .join(', ');
        const docStr =
          pDocs.length > 0 ? ` (Documents: ${pDocs.map((t) => `"${t}"`).join(', ')})` : '';
        lines.push(
          `- [${p.key}] "${p.name}": ${domainCounts || 'no active domain records'}${docStr}`,
        );
      }
      const totalDocs = docs.length;
      lines.push(
        `Total active documents across scope: ${totalDocs}${
          totalDocs > 0 ? ` (${docs.map((d) => `"${d.title}"`).join(', ')})` : ''
        }`,
      );

      return lines.join('\n');
    } catch (err) {
      this.logger.warn(
        `Could not build inventory overview: ${err instanceof Error ? err.message : 'Unknown'}`,
      );
      return '';
    }
  }
}
