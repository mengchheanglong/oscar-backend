import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Project } from '../projects/entities/project.entity';
import { Decision } from '../decisions/entities/decision.entity';
import { Task } from '../tasks/entities/task.entity';
import { Document } from '../documents/entities/document.entity';
import { Goal } from '../goals/entities/goal.entity';
import {
  SearchEntityType,
  SearchQueryDto,
  SearchResultItemDto,
  SearchMetaCountsDto,
  SearchResponseDto,
} from './dto/search.dto';
import { RetrievalService, RetrievedEvidence } from '../mavis/retrieval/retrieval.service';
import { KnowledgeSourceType } from '../ingestion/entities';

@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(Decision)
    private readonly decisionRepository: Repository<Decision>,
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    private readonly retrievalService: RetrievalService,
    private readonly dataSource: DataSource,
    @Optional()
    @InjectRepository(Goal)
    private readonly goalRepository?: Repository<Goal>,
  ) {}

  async search(
    projectId: string,
    query: SearchQueryDto,
    actorId: string,
  ): Promise<SearchResponseDto> {
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
      return this.searchViaRetrieval(projectId, q, searchMode, query, actorId);
    }

    const countsByType: SearchMetaCountsDto = {
      DECISION: 0,
      TASK: 0,
      DOCUMENT: 0,
      GITHUB_ISSUE: 0,
      GITHUB_PR: 0,
      GITHUB_CODE: 0,
      GOAL: 0,
    };

    const searchPromises: Promise<SearchResultItemDto[]>[] = [];
    searchPromises.push(this.searchIndexedSources(projectId, actorId, query));

    // 2. Decisions
    if (!query.assigneeId && (!selectedType || selectedType === SearchEntityType.DECISION)) {
      searchPromises.push(this.searchDecisions(projectId, projectKey, q, term, query));
    }

    // 3. Tasks
    if (!selectedType || selectedType === SearchEntityType.TASK) {
      searchPromises.push(this.searchTasks(projectId, projectKey, q, term, query));
    }

    // 5. Documents
    if (!query.assigneeId && (!selectedType || selectedType === SearchEntityType.DOCUMENT)) {
      searchPromises.push(this.searchDocuments(projectId, projectKey, q, term, query));
    }

    // 6. Goals
    if (
      !query.assigneeId &&
      this.goalRepository &&
      (!selectedType || selectedType === SearchEntityType.GOAL)
    ) {
      searchPromises.push(this.searchGoals(projectId, projectKey, q, term, query, actorId));
    }

    const resultsArrays = await Promise.all(searchPromises);
    // An indexed body match enriches the live entity result instead of adding one result per chunk.
    const unique = new Map<string, SearchResultItemDto>();
    for (const item of resultsArrays.flat().reverse()) {
      const key = `${item.type}:${item.id}`;
      const previous = unique.get(key);
      unique.set(key, {
        ...previous,
        ...item,
        metadata: { ...previous?.metadata, ...item.metadata },
      });
    }
    const allResults = [...unique.values()];

    // Populate countsByType
    for (const item of allResults) {
      if (countsByType[item.type] !== undefined) {
        countsByType[item.type]++;
      }
    }

    // Sort combined results by updatedAt DESC
    allResults.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime() ||
        a.id.localeCompare(b.id),
    );

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

  /** Search active index versions only; chat's conversational fallback is deliberately not used. */
  private async searchIndexedSources(
    projectId: string,
    actorId: string,
    query: SearchQueryDto,
    evidence?: RetrievedEvidence[],
  ): Promise<SearchResultItemDto[]> {
    if (evidence && !evidence.length) return [];
    const rows = await this.dataSource.query<
      Array<{
        source_id: string;
        source_type: KnowledgeSourceType;
        title: string;
        source_revision: number;
        text: string;
        chunk_id: string;
        metadata: Record<string, unknown> | null;
        local_folder_id: string | null;
        updated_at: Date;
        status: string;
        priority: string | null;
        number: number | null;
        project_key: string;
        html_url: string | null;
      }>
    >(
      `SELECT DISTINCT ON (s.source_type, s.source_id)
        s.source_id, s.source_type, s.title, s.source_revision, s.local_folder_id,
        c.text, c.id AS chunk_id, c.metadata, p.key AS project_key,
        COALESCE(d.updated_at, t.updated_at, dec.updated_at, s.updated_at) AS updated_at,
        COALESCE(d.processing_status, t.status, dec.status, gi.state, gp.state, 'INDEXED') AS status,
        t.priority, COALESCE(t.number, dec.number) AS number,
        COALESCE(gi.html_url, gp.html_url, gc.html_url) AS html_url
      FROM knowledge_sources s
      JOIN knowledge_chunks c ON c.knowledge_source_id = s.id AND c.index_version = s.active_index_version
      JOIN projects p ON p.id = s.project_id
      LEFT JOIN documents d ON s.source_type = 'DOCUMENT' AND d.id = s.source_id AND d.project_id = s.project_id AND d.deleted_at IS NULL
      LEFT JOIN tasks t ON s.source_type = 'TASK' AND t.id = s.source_id AND t.project_id = s.project_id AND t.deleted_at IS NULL
      LEFT JOIN decisions dec ON s.source_type = 'DECISION' AND dec.id = s.source_id AND dec.project_id = s.project_id AND dec.deleted_at IS NULL
      LEFT JOIN github_issues gi ON s.source_type = 'GITHUB_ISSUE' AND gi.id = s.source_id AND gi.project_id = s.project_id
      LEFT JOIN github_pull_requests gp ON s.source_type = 'GITHUB_PR' AND gp.id = s.source_id AND gp.project_id = s.project_id
      LEFT JOIN github_repo_files gc ON s.source_type = 'GITHUB_CODE' AND gc.id = s.source_id AND gc.project_id = s.project_id
      WHERE s.project_id = $1 AND s.status = 'INDEXED' AND s.deleted_at IS NULL
        AND s.source_type IN ('DOCUMENT', 'LOCAL_FILE', 'TASK', 'DECISION', 'GITHUB_ISSUE', 'GITHUB_PR', 'GITHUB_CODE')
        AND (s.source_type != 'DOCUMENT' OR d.id IS NOT NULL)
        AND (s.source_type != 'TASK' OR t.id IS NOT NULL)
        AND (s.source_type != 'DECISION' OR dec.id IS NOT NULL)
        AND (s.source_type != 'GITHUB_ISSUE' OR gi.id IS NOT NULL)
        AND (s.source_type != 'GITHUB_PR' OR gp.id IS NOT NULL)
        AND (s.source_type != 'GITHUB_CODE' OR gc.id IS NOT NULL)
        AND (s.owner_id IS NULL OR (s.owner_id = $2::uuid AND EXISTS (
          SELECT 1 FROM project_members pm JOIN users u ON u.id = pm.user_id
          WHERE pm.project_id = s.project_id AND pm.user_id = s.owner_id AND pm.removed_at IS NULL AND u.is_active = true)))
        AND ($3::varchar IS NULL OR s.source_type = $3 OR ($3 = 'DOCUMENT' AND s.source_type = 'LOCAL_FILE'))
        AND ($6::varchar IS NULL OR COALESCE(d.processing_status, t.status, dec.status, gi.state, gp.state, 'INDEXED') = $6)
        AND ($7::uuid IS NULL OR t.assignee_id = $7)
        AND ($8::timestamptz IS NULL OR COALESCE(d.updated_at, t.updated_at, dec.updated_at, s.updated_at) >= $8)
        AND ($9::timestamptz IS NULL OR COALESCE(d.updated_at, t.updated_at, dec.updated_at, s.updated_at) <= $9)
        AND (CASE WHEN $10::uuid[] IS NOT NULL THEN s.source_id = ANY($10::uuid[])
          ELSE (to_tsvector('english', s.title) || c.search_vector) @@ plainto_tsquery('english', $4)
            OR s.title ILIKE $5 OR c.text ILIKE $5 END)
      ORDER BY s.source_type, s.source_id, c.chunk_index, c.id`,
      [
        projectId,
        actorId,
        query.type ?? null,
        query.q.trim(),
        `%${query.q.trim().replace(/[\\%_]/g, (value) => `\\${value}`)}%`,
        query.status ?? null,
        query.assigneeId ?? null,
        query.startDate ?? null,
        query.endDate ?? null,
        evidence ? evidence.map((item) => item.sourceId) : null,
      ],
    );
    const ranked = new Map(
      evidence?.map((item, index) => [`${item.sourceType}:${item.sourceId}`, { item, index }]),
    );
    const items = rows.map((row): SearchResultItemDto => {
      const match = ranked.get(`${row.source_type}:${row.source_id}`)?.item;
      const type =
        row.source_type === KnowledgeSourceType.LOCAL_FILE
          ? SearchEntityType.DOCUMENT
          : (row.source_type as unknown as SearchEntityType);
      const relativePath =
        typeof row.metadata?.relativePath === 'string' ? row.metadata.relativePath : null;
      return {
        id: row.source_id,
        type,
        key: row.number
          ? `${row.project_key}-${type === SearchEntityType.TASK ? 'TSK' : 'DEC'}-${row.number}`
          : null,
        title: row.title,
        snippet: match?.snippet ?? this.createSnippet(row.text),
        status: row.status,
        priority: row.priority,
        updatedAt: row.updated_at,
        metadata: {
          sourceType: row.source_type,
          revision: row.source_revision,
          chunkId: match?.chunkId ?? row.chunk_id,
          folderId: row.local_folder_id,
          relativePath,
          htmlUrl: row.html_url,
          ...(match ? { score: match.score, locator: match.locator } : {}),
        },
      };
    });
    if (evidence)
      items.sort(
        (a, b) =>
          (ranked.get(`${a.metadata?.sourceType}:${a.id}`)?.index ?? 0) -
          (ranked.get(`${b.metadata?.sourceType}:${b.id}`)?.index ?? 0),
      );
    return items;
  }

  private async searchViaRetrieval(
    projectId: string,
    q: string,
    mode: 'semantic' | 'hybrid',
    query: SearchQueryDto,
    actorId: string,
  ): Promise<SearchResponseDto> {
    const countsByType: SearchMetaCountsDto = {
      DECISION: 0,
      TASK: 0,
      DOCUMENT: 0,
      GITHUB_ISSUE: 0,
      GITHUB_PR: 0,
      GITHUB_CODE: 0,
    };
    const evidence = await this.retrievalService.retrieve({
      actorId,
      projectId,
      query: q,
      filters: query.type
        ? { sourceType: query.type as unknown as KnowledgeSourceType }
        : undefined,
      limit: 200,
      mode,
      // Global Search must only return matches; chat retrieval keeps the broad fallback.
      allowWorkspaceFallback: false,
      // Suppress weak nearest neighbors while keeping direct keyword hits in hybrid results.
      minSemanticScore: 0.5,
    });
    // Hydrate real entity dates/status/links and apply the same filters used by keyword search.
    // This also counts sources once even when several chunks match.
    const items = await this.searchIndexedSources(projectId, actorId, query, evidence);
    for (const item of items) countsByType[item.type] = (countsByType[item.type] ?? 0) + 1;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    return {
      data: items.slice((page - 1) * pageSize, page * pageSize),
      meta: { page, pageSize, total: items.length, countsByType },
    };
  }

  private async searchGoals(
    projectId: string,
    projectKey: string,
    _q: string,
    term: string,
    query: SearchQueryDto,
    actorId: string,
  ): Promise<SearchResultItemDto[]> {
    if (!this.goalRepository) return [];
    const qb = this.goalRepository
      .createQueryBuilder('goal')
      .where(
        '(goal.projectId = :projectId OR (goal.projectId IS NULL AND goal.userId = :actorId))',
        { projectId, actorId },
      )
      .andWhere('goal.deletedAt IS NULL')
      .andWhere(
        '(goal.title ILIKE :term OR goal.description ILIKE :term OR goal.motivation ILIKE :term OR goal.target ILIKE :term)',
        { term },
      );

    if (query.status) {
      qb.andWhere('goal.status = :status', { status: query.status });
    }

    const items = await qb.getMany();
    return items.map((item) => ({
      id: item.id,
      type: SearchEntityType.GOAL,
      key: `${projectKey}-GOAL`,
      title: item.title,
      snippet: this.createSnippet(item.description || item.motivation),
      status: item.status,
      priority: null,
      updatedAt: item.updatedAt,
      metadata: {
        category: item.category,
        progress: item.progress,
        target: item.target,
      },
    }));
  }
}
