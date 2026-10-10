import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../projects/entities/project.entity';
import { Requirement } from '../requirements/entities/requirement.entity';
import { Decision } from '../decisions/entities/decision.entity';
import { Task } from '../tasks/entities/task.entity';
import { Meeting } from '../meetings/entities/meeting.entity';
import { Document } from '../documents/entities/document.entity';
import {
  SearchEntityType,
  SearchQueryDto,
  SearchResultItemDto,
  SearchMetaCountsDto,
  SearchResponseDto,
} from './dto/search.dto';
import { RetrievalService } from '../ai/retrieval/retrieval.service';
import { KnowledgeSourceType } from '../ingestion/entities';

@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(Requirement)
    private readonly requirementRepository: Repository<Requirement>,
    @InjectRepository(Decision)
    private readonly decisionRepository: Repository<Decision>,
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    @InjectRepository(Meeting)
    private readonly meetingRepository: Repository<Meeting>,
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    private readonly retrievalService: RetrievalService,
  ) {}

  async search(projectId: string, query: SearchQueryDto): Promise<SearchResponseDto> {
    const project = await this.projectRepository.findOneBy({ id: projectId });
    if (!project) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found.',
      });
    }

    const projectKey = project.key;
    const q = query.q.trim();
    const term = `%${q}%`;
    const selectedType = query.type;
    const searchMode = query.mode || 'keyword';

    // If semantic or hybrid search mode is requested, use RetrievalService
    if (searchMode === 'semantic' || searchMode === 'hybrid') {
      return this.searchViaRetrieval(projectId, q, searchMode, query);
    }

    const countsByType: SearchMetaCountsDto = {
      REQUIREMENT: 0,
      DECISION: 0,
      TASK: 0,
      MEETING: 0,
      DOCUMENT: 0,
    };

    const searchPromises: Promise<SearchResultItemDto[]>[] = [];

    // 1. Requirements
    if (!selectedType || selectedType === SearchEntityType.REQUIREMENT) {
      searchPromises.push(this.searchRequirements(projectId, projectKey, q, term, query));
    }

    // 2. Decisions
    if (!selectedType || selectedType === SearchEntityType.DECISION) {
      searchPromises.push(this.searchDecisions(projectId, projectKey, q, term, query));
    }

    // 3. Tasks
    if (!selectedType || selectedType === SearchEntityType.TASK) {
      searchPromises.push(this.searchTasks(projectId, projectKey, q, term, query));
    }

    // 4. Meetings
    if (!selectedType || selectedType === SearchEntityType.MEETING) {
      searchPromises.push(this.searchMeetings(projectId, projectKey, q, term, query));
    }

    // 5. Documents
    if (!selectedType || selectedType === SearchEntityType.DOCUMENT) {
      searchPromises.push(this.searchDocuments(projectId, projectKey, q, term, query));
    }

    const resultsArrays = await Promise.all(searchPromises);
    const allResults: SearchResultItemDto[] = resultsArrays.flat();

    // Populate countsByType
    for (const item of allResults) {
      if (countsByType[item.type] !== undefined) {
        countsByType[item.type]++;
      }
    }

    // Sort combined results by updatedAt DESC
    allResults.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const total = allResults.length;
    const startIndex = (page - 1) * pageSize;
    const paginatedResults = allResults.slice(startIndex, startIndex + pageSize);

    return {
      data: paginatedResults,
      meta: {
        page,
        pageSize,
        total,
        countsByType,
      },
    };
  }

  private async searchRequirements(
    projectId: string,
    projectKey: string,
    q: string,
    term: string,
    query: SearchQueryDto,
  ): Promise<SearchResultItemDto[]> {
    const qb = this.requirementRepository
      .createQueryBuilder('req')
      .where('req.project_id = :projectId', { projectId })
      .andWhere('req.deleted_at IS NULL')
      .andWhere(
        "(to_tsvector('english', coalesce(req.title, '') || ' ' || coalesce(req.description, '')) @@ plainto_tsquery('english', :q) OR req.title ILIKE :term OR req.description ILIKE :term OR req.acceptance_criteria ILIKE :term)",
        { q, term },
      );

    if (query.status) {
      qb.andWhere('req.status = :status', { status: query.status });
    }
    if (query.startDate) {
      qb.andWhere('req.updated_at >= :startDate', { startDate: query.startDate });
    }
    if (query.endDate) {
      qb.andWhere('req.updated_at <= :endDate', { endDate: query.endDate });
    }

    const items = await qb.getMany();
    return items.map((item) => ({
      id: item.id,
      type: SearchEntityType.REQUIREMENT,
      key: `${projectKey}-REQ-${item.number}`,
      title: item.title,
      snippet: this.createSnippet(item.description || item.acceptanceCriteria),
      status: item.status,
      priority: item.priority,
      updatedAt: item.updatedAt,
      metadata: {
        acceptanceCriteria: item.acceptanceCriteria,
        sourceMeetingId: item.sourceMeetingId,
      },
    }));
  }

  private async searchDecisions(
    projectId: string,
    projectKey: string,
    q: string,
    term: string,
    query: SearchQueryDto,
  ): Promise<SearchResultItemDto[]> {
    const qb = this.decisionRepository
      .createQueryBuilder('dec')
      .where('dec.project_id = :projectId', { projectId })
      .andWhere('dec.deleted_at IS NULL')
      .andWhere(
        "(to_tsvector('english', coalesce(dec.title, '') || ' ' || coalesce(dec.decision_text, '')) @@ plainto_tsquery('english', :q) OR dec.title ILIKE :term OR dec.decision_text ILIKE :term OR dec.rationale ILIKE :term)",
        { q, term },
      );

    if (query.status) {
      qb.andWhere('dec.status = :status', { status: query.status });
    }
    if (query.startDate) {
      qb.andWhere('dec.updated_at >= :startDate', { startDate: query.startDate });
    }
    if (query.endDate) {
      qb.andWhere('dec.updated_at <= :endDate', { endDate: query.endDate });
    }

    const items = await qb.getMany();
    return items.map((item) => ({
      id: item.id,
      type: SearchEntityType.DECISION,
      key: `${projectKey}-DEC-${item.number}`,
      title: item.title,
      snippet: this.createSnippet(item.decisionText || item.rationale),
      status: item.status,
      priority: null,
      updatedAt: item.updatedAt,
      metadata: {
        rationale: item.rationale,
        decidedAt: item.decidedAt,
        decidedBy: item.decidedBy,
        supersedesDecisionId: item.supersedesDecisionId,
      },
    }));
  }

  private async searchTasks(
    projectId: string,
    projectKey: string,
    q: string,
    term: string,
    query: SearchQueryDto,
  ): Promise<SearchResultItemDto[]> {
    const qb = this.taskRepository
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.assignee', 'assignee')
      .where('task.project_id = :projectId', { projectId })
      .andWhere('task.deleted_at IS NULL')
      .andWhere(
        "(to_tsvector('english', coalesce(task.title, '') || ' ' || coalesce(task.description, '')) @@ plainto_tsquery('english', :q) OR task.title ILIKE :term OR task.description ILIKE :term)",
        { q, term },
      );

    if (query.status) {
      qb.andWhere('task.status = :status', { status: query.status });
    }
    if (query.assigneeId) {
      qb.andWhere('task.assignee_id = :assigneeId', { assigneeId: query.assigneeId });
    }
    if (query.startDate) {
      qb.andWhere('task.updated_at >= :startDate', { startDate: query.startDate });
    }
    if (query.endDate) {
      qb.andWhere('task.updated_at <= :endDate', { endDate: query.endDate });
    }

    const items = await qb.getMany();
    return items.map((item) => ({
      id: item.id,
      type: SearchEntityType.TASK,
      key: `${projectKey}-TSK-${item.number}`,
      title: item.title,
      snippet: this.createSnippet(item.description),
      status: item.status,
      priority: item.priority,
      updatedAt: item.updatedAt,
      metadata: {
        dueDate: item.dueDate,
        assigneeId: item.assigneeId,
        assigneeName: item.assignee?.displayName ?? null,
        requirementId: item.requirementId,
      },
    }));
  }

  private async searchMeetings(
    projectId: string,
    projectKey: string,
    q: string,
    term: string,
    query: SearchQueryDto,
  ): Promise<SearchResultItemDto[]> {
    const qb = this.meetingRepository
      .createQueryBuilder('mtg')
      .where('mtg.project_id = :projectId', { projectId })
      .andWhere('mtg.deleted_at IS NULL')
      .andWhere(
        "(to_tsvector('english', coalesce(mtg.title, '') || ' ' || coalesce(mtg.notes, '') || ' ' || coalesce(mtg.agenda, '')) @@ plainto_tsquery('english', :q) OR mtg.title ILIKE :term OR mtg.notes ILIKE :term OR mtg.agenda ILIKE :term OR mtg.summary ILIKE :term)",
        { q, term },
      );

    if (query.startDate) {
      qb.andWhere('mtg.starts_at >= :startDate', { startDate: query.startDate });
    }
    if (query.endDate) {
      qb.andWhere('mtg.ends_at <= :endDate', { endDate: query.endDate });
    }

    const items = await qb.getMany();
    return items.map((item) => ({
      id: item.id,
      type: SearchEntityType.MEETING,
      key: null,
      title: item.title,
      snippet: this.createSnippet(item.summary || item.notes || item.agenda),
      status: null,
      priority: null,
      updatedAt: item.updatedAt,
      metadata: {
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        transcriptVersion: item.transcriptVersion,
      },
    }));
  }

  private async searchDocuments(
    projectId: string,
    projectKey: string,
    q: string,
    term: string,
    query: SearchQueryDto,
  ): Promise<SearchResultItemDto[]> {
    const qb = this.documentRepository
      .createQueryBuilder('doc')
      .where('doc.project_id = :projectId', { projectId })
      .andWhere('doc.deleted_at IS NULL')
      .andWhere(
        "(to_tsvector('english', coalesce(doc.title, '') || ' ' || coalesce(doc.description, '') || ' ' || coalesce(doc.original_filename, '')) @@ plainto_tsquery('english', :q) OR doc.title ILIKE :term OR doc.description ILIKE :term OR doc.original_filename ILIKE :term)",
        { q, term },
      );

    if (query.status) {
      qb.andWhere('doc.processing_status = :status', { status: query.status });
    }
    if (query.startDate) {
      qb.andWhere('doc.updated_at >= :startDate', { startDate: query.startDate });
    }
    if (query.endDate) {
      qb.andWhere('doc.updated_at <= :endDate', { endDate: query.endDate });
    }

    const items = await qb.getMany();
    return items.map((item) => ({
      id: item.id,
      type: SearchEntityType.DOCUMENT,
      key: null,
      title: item.title,
      snippet: this.createSnippet(item.description || item.originalFilename),
      status: item.processingStatus,
      priority: null,
      updatedAt: item.updatedAt,
      metadata: {
        originalFilename: item.originalFilename,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        revision: item.revision,
      },
    }));
  }

  private createSnippet(text: string | null | undefined, maxLength = 250): string | null {
    if (!text) return null;
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length <= maxLength) return clean;
    return `${clean.slice(0, maxLength)}...`;
  }

  private async searchViaRetrieval(
    projectId: string,
    q: string,
    mode: 'semantic' | 'hybrid',
    query: SearchQueryDto,
  ): Promise<SearchResponseDto> {
    const countsByType: SearchMetaCountsDto = {
      REQUIREMENT: 0,
      DECISION: 0,
      TASK: 0,
      MEETING: 0,
      DOCUMENT: 0,
      GITHUB_ISSUE: 0,
      GITHUB_PR: 0,
      GITHUB_CODE: 0,
    };

    const typeMap: Record<KnowledgeSourceType, SearchEntityType> = {
      [KnowledgeSourceType.DOCUMENT]: SearchEntityType.DOCUMENT,
      [KnowledgeSourceType.LOCAL_FILE]: SearchEntityType.DOCUMENT,
      [KnowledgeSourceType.REQUIREMENT]: SearchEntityType.REQUIREMENT,
      [KnowledgeSourceType.DECISION]: SearchEntityType.DECISION,
      [KnowledgeSourceType.TASK]: SearchEntityType.TASK,
      [KnowledgeSourceType.MEETING]: SearchEntityType.MEETING,
      [KnowledgeSourceType.GITHUB_ISSUE]: SearchEntityType.GITHUB_ISSUE,
      [KnowledgeSourceType.GITHUB_PR]: SearchEntityType.GITHUB_PR,
      [KnowledgeSourceType.GITHUB_CODE]: SearchEntityType.GITHUB_CODE,
    };

    const reverseTypeMap: Record<SearchEntityType, KnowledgeSourceType> = {
      [SearchEntityType.DOCUMENT]: KnowledgeSourceType.DOCUMENT,
      [SearchEntityType.REQUIREMENT]: KnowledgeSourceType.REQUIREMENT,
      [SearchEntityType.DECISION]: KnowledgeSourceType.DECISION,
      [SearchEntityType.TASK]: KnowledgeSourceType.TASK,
      [SearchEntityType.MEETING]: KnowledgeSourceType.MEETING,
      [SearchEntityType.GITHUB_ISSUE]: KnowledgeSourceType.GITHUB_ISSUE,
      [SearchEntityType.GITHUB_PR]: KnowledgeSourceType.GITHUB_PR,
      [SearchEntityType.GITHUB_CODE]: KnowledgeSourceType.GITHUB_CODE,
    };

    const sourceTypeFilter = query.type ? reverseTypeMap[query.type] : undefined;

    const evidence = await this.retrievalService.retrieve({
      actorId: '',
      projectId,
      query: q,
      filters: sourceTypeFilter ? { sourceType: sourceTypeFilter } : undefined,
      limit: 50,
      mode,
    });

    const seenSources = new Set<string>();
    const items: SearchResultItemDto[] = [];

    for (const e of evidence) {
      const entityType = typeMap[e.sourceType] || SearchEntityType.DOCUMENT;
      countsByType[entityType]++;

      if (seenSources.has(e.sourceId)) continue;
      seenSources.add(e.sourceId);

      items.push({
        id: e.sourceId,
        type: entityType,
        key: e.locator,
        title: e.title,
        snippet: e.snippet,
        status: 'INDEXED',
        priority: null,
        updatedAt: new Date(),
        metadata: {
          score: e.score,
          locator: e.locator,
          revision: e.revision,
          chunkId: e.chunkId,
        },
      });
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const total = items.length;
    const paginated = items.slice((page - 1) * pageSize, page * pageSize);

    return {
      data: paginated,
      meta: {
        page,
        pageSize,
        total,
        countsByType,
      },
    };
  }
}
