import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DataSource, IsNull, LessThan, Repository } from 'typeorm';
import { STORAGE_DRIVER, StorageDriver } from '../storage/storage.interface';
import { Document, ProcessingStatus } from '../documents/entities/document.entity';
import { SemanticChunker } from './chunker/semantic-chunker';
import { ListKnowledgeSourcesDto } from './dto/list-sources.dto';
import { EmbeddingProvider, MockEmbeddingProvider, OpenAiEmbeddingProvider } from './embedding';
import {
  KnowledgeChunk,
  KnowledgeSource,
  KnowledgeSourceStatus,
  KnowledgeSourceType,
  OutboxEvent,
  ProcessingJob,
  ProcessingJobStatus,
  ProcessingJobType,
} from './entities';
import {
  DocxExtractor,
  EntityExtractor,
  ExtractedDocument,
  PdfExtractor,
  PlainTextExtractor,
} from './extractors';
import { OutboxService } from './outbox.service';

export interface DocumentPayload {
  documentId: string;
  revision?: number;
  title: string;
  storageKey?: string;
  mimeType?: string;
  originalFilename?: string;
}

export interface DecisionPayload {
  decisionId: string;
  revision?: number;
  title: string;
  status?: string;
  category?: string;
  context?: string | null;
  decision?: string | null;
  consequences?: string | null;
}

export interface TaskPayload {
  taskId: string;
  revision?: number;
  title: string;
  description?: string | null;
  status?: string;
  priority?: string;
  dueDate?: string | Date | null;
}

export interface GitHubIssuePayload {
  issueId: string;
  issueNumber: number;
  title: string;
  body?: string | null;
  state: string;
  htmlUrl: string;
  authorLogin?: string | null;
  labels?: string[] | null;
  repositoryOwner?: string;
  repositoryName?: string;
  comments?: Array<{ authorLogin?: string | null; body: string }>;
  revision?: number;
}

export interface GitHubPullRequestPayload {
  prId: string;
  prNumber: number;
  title: string;
  body?: string | null;
  state: string;
  htmlUrl: string;
  authorLogin?: string | null;
  baseBranch?: string | null;
  headBranch?: string | null;
  isMerged?: boolean;
  labels?: string[] | null;
  repositoryOwner?: string;
  repositoryName?: string;
  revision?: number;
}

export interface GitHubCodeFilePayload {
  fileId: string;
  path: string;
  fileName: string;
  extension: string;
  content: string;
  size: number;
  htmlUrl: string;
  repositoryOwner?: string;
  repositoryName?: string;
  revision?: number;
}

@Injectable()
export class IngestionService implements OnModuleInit {
  private readonly logger = new Logger(IngestionService.name);
  private readonly plainTextExtractor = new PlainTextExtractor();
  private readonly pdfExtractor = new PdfExtractor();
  private readonly docxExtractor = new DocxExtractor();
  private readonly entityExtractor = new EntityExtractor();
  private readonly chunker: SemanticChunker;
  private embeddingProvider?: EmbeddingProvider;

  constructor(
    @InjectRepository(KnowledgeSource)
    private readonly sourceRepo: Repository<KnowledgeSource>,
    @InjectRepository(KnowledgeChunk)
    private readonly chunkRepo: Repository<KnowledgeChunk>,
    @InjectRepository(ProcessingJob)
    private readonly jobRepo: Repository<ProcessingJob>,
    @Inject(STORAGE_DRIVER)
    private readonly storageDriver: StorageDriver,
    private readonly outboxService: OutboxService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {
    this.chunker = new SemanticChunker({
      targetTokens: 600,
      overlapTokens: 100,
      approxCharsPerToken: 4,
    });

    const providerType = this.configService.get<string>('AI_EMBEDDING_PROVIDER') ?? 'disabled';
    const openAiApiKey = this.configService.get<string>('OPENAI_API_KEY');

    if (providerType === 'openai' && openAiApiKey) {
      this.embeddingProvider = new OpenAiEmbeddingProvider({
        apiKey: openAiApiKey,
        baseUrl: this.configService.get<string>('OPENAI_EMBEDDING_BASE_URL'),
        dimensions: this.configService.get<number>('AI_EMBEDDING_DIMENSIONS') ?? 1536,
        modelName: this.configService.get<string>('AI_EMBEDDING_MODEL') ?? 'text-embedding-3-small',
      });
      this.logger.log('IngestionService using OpenAiEmbeddingProvider');
    } else if (providerType === 'mock' && process.env.NODE_ENV === 'test') {
      this.embeddingProvider = new MockEmbeddingProvider(1536, 'mock-embedding-3-small');
    } else {
      this.logger.log(
        'IngestionService indexing source text for keyword search without embeddings',
      );
    }
  }

  onModuleInit(): void {
    this.outboxService.setEventHandler(this.handleOutboxEvent.bind(this));
  }

  setEmbeddingProvider(provider: EmbeddingProvider): void {
    this.embeddingProvider = provider;
  }

  getEmbeddingProvider(): EmbeddingProvider | undefined {
    return this.embeddingProvider;
  }

  async handleOutboxEvent(event: OutboxEvent): Promise<void> {
    const { eventType, projectId, payload } = event;

    switch (eventType) {
      case 'DOCUMENT_CREATED':
      case 'DOCUMENT_UPDATED':
        await this.syncDocument(projectId, payload as unknown as DocumentPayload);
        break;
      case 'DOCUMENT_DELETED':
        await this.deleteSource(
          projectId,
          KnowledgeSourceType.DOCUMENT,
          (payload as unknown as { documentId: string }).documentId,
        );
        break;

      case 'DECISION_CREATED':
      case 'DECISION_UPDATED':
        await this.syncDecision(projectId, payload as unknown as DecisionPayload);
        break;
      case 'DECISION_DELETED':
        await this.deleteSource(
          projectId,
          KnowledgeSourceType.DECISION,
          (payload as unknown as { decisionId: string }).decisionId,
        );
        break;

      case 'TASK_CREATED':
      case 'TASK_UPDATED':
        await this.syncTask(projectId, payload as unknown as TaskPayload);
        break;
      case 'TASK_DELETED':
        await this.deleteSource(
          projectId,
          KnowledgeSourceType.TASK,
          (payload as unknown as { taskId: string }).taskId,
        );
        break;

      default:
        this.logger.debug(`Ignoring unhandled outbox event type: ${eventType}`);
    }
  }

  async syncDocument(projectId: string, payload: DocumentPayload): Promise<KnowledgeSource | null> {
    // Manual reindex jobs carry the source identity, not storage credentials.
    if (!payload.storageKey || !payload.mimeType) {
      const document = await this.dataSource.manager.findOne(Document, {
        where: {
          id: payload.documentId,
          projectId,
          revision: payload.revision ?? 1,
          deletedAt: IsNull(),
        },
      });
      if (!document) return null;
      payload = {
        ...payload,
        storageKey: document.storageKey,
        mimeType: document.mimeType,
        originalFilename: document.originalFilename,
      };
    }
    if (!payload.storageKey || !payload.mimeType) {
      this.logger.warn(`Missing storageKey or mimeType for document ${payload.documentId}`);
      await this.updateDocumentProcessingStatus(
        projectId,
        payload,
        ProcessingStatus.FAILED,
        'DOCUMENT_METADATA_MISSING',
      );
      throw new Error('DOCUMENT_METADATA_MISSING');
    }

    let buffer: Buffer;
    try {
      const filePath = this.storageDriver.getAbsolutePath(payload.storageKey);
      buffer = await readFile(filePath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to read document file for ${payload.documentId}: ${message}`);
      await this.updateDocumentProcessingStatus(
        projectId,
        payload,
        ProcessingStatus.FAILED,
        'DOCUMENT_READ_FAILED',
      );
      throw err;
    }

    let extractedDoc: ExtractedDocument;
    try {
      if (this.pdfExtractor.supports(payload.mimeType, payload.originalFilename)) {
        extractedDoc = await this.pdfExtractor.extract(
          buffer,
          payload.mimeType,
          payload.originalFilename,
        );
      } else if (this.docxExtractor.supports(payload.mimeType, payload.originalFilename)) {
        extractedDoc = await this.docxExtractor.extract(
          buffer,
          payload.mimeType,
          payload.originalFilename,
        );
      } else if (this.plainTextExtractor.supports(payload.mimeType, payload.originalFilename)) {
        extractedDoc = await this.plainTextExtractor.extract(
          buffer,
          payload.mimeType,
          payload.originalFilename,
        );
      } else {
        this.logger.warn(
          `Unsupported mimeType ${payload.mimeType} for document ${payload.documentId}`,
        );
        await this.updateDocumentProcessingStatus(
          projectId,
          payload,
          ProcessingStatus.UNSUPPORTED,
          'DOCUMENT_FORMAT_UNSUPPORTED',
        );
        return null;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to extract text from document ${payload.documentId}: ${message}`);
      await this.updateDocumentProcessingStatus(
        projectId,
        payload,
        ProcessingStatus.FAILED,
        'DOCUMENT_EXTRACTION_FAILED',
      );
      throw err;
    }

    if (!extractedDoc.text.trim()) {
      await this.updateDocumentProcessingStatus(
        projectId,
        payload,
        ProcessingStatus.UNSUPPORTED,
        'DOCUMENT_TEXT_EMPTY',
      );
      return null;
    }

    let source: KnowledgeSource | null;
    try {
      source = await this.processKnowledgeSource({
        projectId,
        sourceType: KnowledgeSourceType.DOCUMENT,
        sourceId: payload.documentId,
        sourceRevision: payload.revision ?? 1,
        title: payload.title,
        extractedDoc,
      });
    } catch (err: unknown) {
      await this.updateDocumentProcessingStatus(
        projectId,
        payload,
        ProcessingStatus.FAILED,
        'DOCUMENT_INDEXING_FAILED',
      );
      throw err;
    }

    if (
      source?.status === KnowledgeSourceStatus.INDEXED &&
      source.sourceRevision === (payload.revision ?? 1)
    ) {
      await this.updateDocumentProcessingStatus(projectId, payload, ProcessingStatus.COMPLETED);
    }
    return source;
  }

  private async updateDocumentProcessingStatus(
    projectId: string,
    payload: DocumentPayload,
    processingStatus: ProcessingStatus,
    lastErrorCode: string | null = null,
  ): Promise<void> {
    // Late work for an older revision must not overwrite a replacement or deleted file.
    await this.dataSource.manager.update(
      Document,
      {
        id: payload.documentId,
        projectId,
        revision: payload.revision ?? 1,
        deletedAt: IsNull(),
      },
      { processingStatus, lastErrorCode },
    );
  }

  async syncDecision(projectId: string, payload: DecisionPayload): Promise<KnowledgeSource | null> {
    const extractedDoc = this.entityExtractor.extractDecision({
      id: payload.decisionId,
      title: payload.title,
      status: payload.status,
      category: payload.category,
      context: payload.context,
      decision: payload.decision,
      consequences: payload.consequences,
    });

    return this.processKnowledgeSource({
      projectId,
      sourceType: KnowledgeSourceType.DECISION,
      sourceId: payload.decisionId,
      sourceRevision: payload.revision ?? 1,
      title: payload.title,
      extractedDoc,
    });
  }

  async syncTask(projectId: string, payload: TaskPayload): Promise<KnowledgeSource | null> {
    const extractedDoc = this.entityExtractor.extractTask({
      id: payload.taskId,
      title: payload.title,
      description: payload.description,
      status: payload.status,
      priority: payload.priority,
      dueDate: payload.dueDate,
    });

    return this.processKnowledgeSource({
      projectId,
      sourceType: KnowledgeSourceType.TASK,
      sourceId: payload.taskId,
      sourceRevision: payload.revision ?? 1,
      title: payload.title,
      extractedDoc,
    });
  }

  async syncGitHubIssue(
    projectId: string,
    payload: GitHubIssuePayload,
  ): Promise<KnowledgeSource | null> {
    const extractedDoc = this.entityExtractor.extractGitHubIssue({
      id: payload.issueId,
      issueNumber: payload.issueNumber,
      title: payload.title,
      body: payload.body,
      state: payload.state,
      htmlUrl: payload.htmlUrl,
      authorLogin: payload.authorLogin,
      labels: payload.labels,
      repositoryOwner: payload.repositoryOwner,
      repositoryName: payload.repositoryName,
      comments: payload.comments,
    });

    return this.processKnowledgeSource({
      projectId,
      sourceType: KnowledgeSourceType.GITHUB_ISSUE,
      sourceId: payload.issueId,
      sourceRevision: payload.revision ?? 1,
      title: `[GitHub #${payload.issueNumber}] ${payload.title}`,
      extractedDoc,
    });
  }

  async syncGitHubPullRequest(
    projectId: string,
    payload: GitHubPullRequestPayload,
  ): Promise<KnowledgeSource | null> {
    const extractedDoc = this.entityExtractor.extractGitHubPullRequest({
      id: payload.prId,
      prNumber: payload.prNumber,
      title: payload.title,
      body: payload.body,
      state: payload.state,
      htmlUrl: payload.htmlUrl,
      authorLogin: payload.authorLogin,
      baseBranch: payload.baseBranch,
      headBranch: payload.headBranch,
      isMerged: payload.isMerged,
      labels: payload.labels,
      repositoryOwner: payload.repositoryOwner,
      repositoryName: payload.repositoryName,
    });

    return this.processKnowledgeSource({
      projectId,
      sourceType: KnowledgeSourceType.GITHUB_PR,
      sourceId: payload.prId,
      sourceRevision: payload.revision ?? 1,
      title: `[GitHub PR #${payload.prNumber}] ${payload.title}`,
      extractedDoc,
    });
  }

  async syncGitHubCodeFile(
    projectId: string,
    payload: GitHubCodeFilePayload,
  ): Promise<KnowledgeSource | null> {
    const extractedDoc = this.entityExtractor.extractGitHubCodeFile({
      id: payload.fileId,
      path: payload.path,
      fileName: payload.fileName,
      extension: payload.extension,
      content: payload.content,
      size: payload.size,
      repositoryOwner: payload.repositoryOwner,
      repositoryName: payload.repositoryName,
      htmlUrl: payload.htmlUrl,
    });

    return this.processKnowledgeSource({
      projectId,
      sourceType: KnowledgeSourceType.GITHUB_CODE,
      sourceId: payload.fileId,
      sourceRevision: payload.revision ?? 1,
      title: `[Code] ${payload.path}`,
      extractedDoc,
    });
  }

  private async processKnowledgeSource(params: {
    projectId: string;
    sourceType: KnowledgeSourceType;
    sourceId: string;
    sourceRevision: number;
    title: string;
    extractedDoc: ExtractedDocument;
  }): Promise<KnowledgeSource | null> {
    const { projectId, sourceType, sourceId, sourceRevision, title, extractedDoc } = params;

    let source = await this.sourceRepo.findOne({
      where: { projectId, sourceType, sourceId },
    });

    if (!source) {
      source = this.sourceRepo.create({
        projectId,
        sourceType,
        sourceId,
        sourceRevision,
        title,
        status: KnowledgeSourceStatus.QUEUED,
        activeIndexVersion: 0,
        contentHash: null,
      });
      source = await this.sourceRepo.save(source);
    }

    if (source.deletedAt) {
      this.logger.debug(`Source ${sourceId} is deleted. Skipping indexing.`);
      return null;
    }

    if (sourceRevision < source.sourceRevision) {
      this.logger.debug(
        `Source revision ${sourceRevision} is older than current ${source.sourceRevision}. Skipping.`,
      );
      return source;
    }

    // Hash check for idempotency
    const contentHash = createHash('sha256').update(extractedDoc.text).digest('hex');
    if (
      source.contentHash === contentHash &&
      source.status === KnowledgeSourceStatus.INDEXED &&
      source.activeIndexVersion > 0
    ) {
      source.title = title;
      source.sourceRevision = sourceRevision;
      return this.sourceRepo.save(source);
    }

    source.status = KnowledgeSourceStatus.PROCESSING;
    source.title = title;
    source.sourceRevision = sourceRevision;
    await this.sourceRepo.save(source);

    try {
      const chunks = this.chunker.chunk(extractedDoc);

      if (chunks.length === 0) {
        source.contentHash = contentHash;
        source.status = KnowledgeSourceStatus.INDEXED;
        source.lastErrorCode = null;
        return await this.sourceRepo.save(source);
      }

      // Generate embeddings
      const texts = chunks.map((c) => c.text);
      const embeddingProvider = this.embeddingProvider;
      const embeddings = embeddingProvider ? await embeddingProvider.embed(texts) : [];

      // Atomic activation in transaction
      return await this.dataSource.transaction(async (tx) => {
        const freshSource = await tx.findOne(KnowledgeSource, {
          where: { id: source.id },
          lock: { mode: 'pessimistic_write' },
        });

        if (!freshSource || freshSource.deletedAt || sourceRevision < freshSource.sourceRevision) {
          return null;
        }

        const nextIndexVersion = freshSource.activeIndexVersion + 1;

        const chunkEntities = chunks.map((c, idx) =>
          tx.create(KnowledgeChunk, {
            projectId,
            knowledgeSourceId: freshSource.id,
            indexVersion: nextIndexVersion,
            chunkIndex: c.chunkIndex,
            text: c.text,
            tokenCount: c.tokenCount,
            metadata: c.metadata,
            embeddingModel: embeddingProvider?.modelName ?? 'keyword-only',
            embeddingDimensions: embeddingProvider?.dimensions ?? 0,
            embedding: embeddingProvider ? (embeddings[idx] ?? []) : null,
          }),
        );

        await tx.save(KnowledgeChunk, chunkEntities);

        freshSource.activeIndexVersion = nextIndexVersion;
        freshSource.contentHash = contentHash;
        freshSource.status = KnowledgeSourceStatus.INDEXED;
        freshSource.lastErrorCode = null;
        const savedSource = await tx.save(KnowledgeSource, freshSource);

        // Garbage collect old inactive chunks
        await tx.delete(KnowledgeChunk, {
          knowledgeSourceId: freshSource.id,
          indexVersion: LessThan(nextIndexVersion),
        });

        return savedSource;
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to index knowledge source ${source.id} (${sourceType}:${sourceId}): ${message}`,
      );
      source.status = KnowledgeSourceStatus.FAILED;
      source.lastErrorCode = message;
      await this.sourceRepo.save(source);
      throw err;
    }
  }

  async deleteSource(
    projectId: string,
    sourceType: KnowledgeSourceType,
    sourceId: string,
  ): Promise<void> {
    const source = await this.sourceRepo.findOne({
      where: { projectId, sourceType, sourceId },
    });

    if (!source) return;

    await this.dataSource.transaction(async (tx) => {
      source.deletedAt = new Date();
      source.status = KnowledgeSourceStatus.QUEUED;
      await tx.save(KnowledgeSource, source);

      // Delete chunks immediately so deleted content disappears from search & AI context
      await tx.delete(KnowledgeChunk, {
        knowledgeSourceId: source.id,
      });
    });
  }

  async deactivateSourcesByType(projectId: string, sourceType: KnowledgeSourceType): Promise<void> {
    const sources = await this.sourceRepo.find({
      where: { projectId, sourceType },
    });

    if (sources.length === 0) return;

    await this.dataSource.transaction(async (tx) => {
      const now = new Date();
      for (const source of sources) {
        source.deletedAt = now;
        await tx.save(KnowledgeSource, source);
        await tx.delete(KnowledgeChunk, { knowledgeSourceId: source.id });
      }
    });
  }

  async listSources(
    projectId: string,
    query: ListKnowledgeSourcesDto,
    actorId?: string,
  ): Promise<(KnowledgeSource & { chunkCount: number })[]> {
    const qb = this.sourceRepo
      .createQueryBuilder('source')
      .where('source.project_id = :projectId', { projectId })
      .andWhere("source.source_type NOT IN ('REQUIREMENT', 'MEETING')")
      .andWhere('source.deleted_at IS NULL')
      .andWhere('(source.owner_id IS NULL OR source.owner_id = :actorId)', {
        actorId: actorId ?? null,
      });

    if (query.sourceType) {
      qb.andWhere('source.source_type = :sourceType', { sourceType: query.sourceType });
    }

    if (query.status) {
      qb.andWhere('source.status = :status', { status: query.status });
    }

    if (query.search) {
      qb.andWhere('source.title ILIKE :search', { search: `%${query.search}%` });
    }

    qb.orderBy('source.updated_at', 'DESC');

    const sources = await qb.getMany();

    // Query chunk counts for active index versions
    const sourceIds = sources.map((s) => s.id);
    const chunkCountsMap = new Map<string, number>();

    if (sourceIds.length > 0) {
      const counts = await this.chunkRepo
        .createQueryBuilder('chunk')
        .select('chunk.knowledge_source_id', 'sourceId')
        .addSelect('COUNT(chunk.id)', 'count')
        .where('chunk.knowledge_source_id IN (:...sourceIds)', { sourceIds })
        .groupBy('chunk.knowledge_source_id')
        .getRawMany();

      for (const row of counts) {
        chunkCountsMap.set(row.sourceId, parseInt(row.count, 10));
      }
    }

    return sources.map((s) =>
      Object.assign(s, {
        chunkCount: chunkCountsMap.get(s.id) ?? 0,
      }),
    );
  }

  async isSourceIndexed(
    projectId: string,
    sourceType: KnowledgeSourceType,
    sourceId: string,
  ): Promise<boolean> {
    const source = await this.sourceRepo.findOne({
      where: { projectId, sourceType, sourceId, deletedAt: IsNull() },
    });
    return source?.status === KnowledgeSourceStatus.INDEXED && source.activeIndexVersion > 0;
  }

  async getSource(
    projectId: string,
    sourceId: string,
    actorId?: string,
  ): Promise<KnowledgeSource & { chunks: KnowledgeChunk[] }> {
    const source = await this.sourceRepo.findOne({
      where: { id: sourceId, projectId, deletedAt: IsNull() },
    });

    if (
      !source ||
      [KnowledgeSourceType.REQUIREMENT, KnowledgeSourceType.MEETING].includes(source.sourceType) ||
      (source.ownerId && source.ownerId !== actorId)
    ) {
      throw new NotFoundException(`Knowledge source ${sourceId} not found in project ${projectId}`);
    }

    const chunks = await this.chunkRepo.find({
      where: {
        knowledgeSourceId: source.id,
        indexVersion: source.activeIndexVersion,
      },
      order: { chunkIndex: 'ASC' },
    });

    return Object.assign(source, { chunks });
  }

  async reindexSource(
    projectId: string,
    sourceId: string,
    actorId?: string,
  ): Promise<ProcessingJob> {
    const source = await this.sourceRepo.findOne({
      where: { id: sourceId, projectId, deletedAt: IsNull() },
    });

    if (
      !source ||
      [KnowledgeSourceType.REQUIREMENT, KnowledgeSourceType.MEETING].includes(source.sourceType) ||
      (source.ownerId && source.ownerId !== actorId)
    ) {
      throw new NotFoundException(`Knowledge source ${sourceId} not found in project ${projectId}`);
    }

    if (source.sourceType === KnowledgeSourceType.LOCAL_FILE)
      throw new BadRequestException('Rescan this source from its connected local folder.');

    // Reset status to QUEUED and force reindex
    source.status = KnowledgeSourceStatus.QUEUED;
    source.contentHash = null; // Forces recalculation
    await this.sourceRepo.save(source);

    // Create a processing job record
    const job = this.jobRepo.create({
      projectId,
      requestedBy: actorId ?? null,
      jobType: ProcessingJobType.REINDEX,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceRevision: source.sourceRevision,
      status: ProcessingJobStatus.PENDING,
      attempts: 0,
      progress: 0,
    });

    const savedJob = await this.jobRepo.save(job);

    // Trigger re-ingestion asynchronously
    setImmediate(() => {
      void (async () => {
        savedJob.status = ProcessingJobStatus.RUNNING;
        savedJob.startedAt = new Date();
        await this.jobRepo.save(savedJob);

        try {
          // Emit outbox event to re-sync
          const eventType = `${source.sourceType}_UPDATED`;
          await this.handleOutboxEvent({
            id: 'manual-reindex',
            projectId,
            eventType,
            dedupeKey: `reindex:${source.id}:${Date.now()}`,
            payload: {
              [`${source.sourceType.toLowerCase()}Id`]: source.sourceId,
              title: source.title,
              revision: source.sourceRevision,
            },
            attempts: 0,
            dispatchedAt: null,
            lastError: null,
            createdAt: new Date(),
          });

          savedJob.status = ProcessingJobStatus.COMPLETED;
          savedJob.progress = 100;
          savedJob.completedAt = new Date();
          await this.jobRepo.save(savedJob);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          savedJob.status = ProcessingJobStatus.FAILED;
          savedJob.safeFailureReason = message;
          await this.jobRepo.save(savedJob);
        }
      })();
    });

    return savedJob;
  }

  async listJobs(projectId: string): Promise<ProcessingJob[]> {
    return this.jobRepo.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }
}
