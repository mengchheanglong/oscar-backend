import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EmbeddingProvider } from '../../ingestion/embedding/embedding-provider.interface';
import { KnowledgeSourceType } from '../../ingestion/entities';

export interface RetrieveParams {
  actorId: string;
  projectId?: string;
  projectIds?: string[];
  query: string;
  filters?: {
    sourceType?: KnowledgeSourceType;
  };
  limit?: number;
  mode?: 'hybrid' | 'semantic' | 'keyword';
}

export interface RetrievedEvidence {
  chunkId: string;
  sourceId: string;
  sourceType: KnowledgeSourceType;
  title: string;
  revision: number;
  locator: string;
  snippet: string;
  projectName?: string;
  projectKey?: string;
  /** Full permitted chunk for model context; snippets remain compact for search/citations. */
  text?: string;
  score: number;
}

interface RawChunkQueryResult {
  id: string;
  knowledge_source_id: string;
  text: string;
  metadata: Record<string, unknown> | null;
  token_count: number;
  chunk_index: number;
  source_type: KnowledgeSourceType;
  source_id: string;
  title: string;
  source_revision: number;
  project_name?: string;
  project_key?: string;
  score_signal?: number;
}

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);
  private embeddingProvider?: EmbeddingProvider;

  constructor(private readonly dataSource: DataSource) {}

  setEmbeddingProvider(provider: EmbeddingProvider): void {
    this.embeddingProvider = provider;
  }

  async retrieve(params: RetrieveParams): Promise<RetrievedEvidence[]> {
    const { projectId, projectIds, query, filters, limit = 8, mode = 'hybrid' } = params;

    if (!query || !query.trim()) {
      return [];
    }

    const targetProjectIds =
      projectIds && projectIds.length > 0 ? projectIds : projectId ? [projectId] : [];

    if (targetProjectIds.length === 0) {
      return [];
    }

    const trimmedQuery = query.trim();

    if (mode === 'keyword') {
      return this.retrieveKeyword(targetProjectIds, trimmedQuery, filters?.sourceType, limit);
    }

    if (mode === 'semantic') {
      return this.retrieveSemantic(targetProjectIds, trimmedQuery, filters?.sourceType, limit);
    }

    // Hybrid mode (Dense Vector + Sparse Keyword via Reciprocal Rank Fusion)
    return this.retrieveHybrid(targetProjectIds, trimmedQuery, filters?.sourceType, limit);
  }

  private async retrieveSemantic(
    projectIds: string[],
    query: string,
    sourceType?: KnowledgeSourceType,
    limit = 8,
  ): Promise<RetrievedEvidence[]> {
    if (!this.embeddingProvider) {
      throw new ServiceUnavailableException(
        'Semantic search requires a configured real embedding provider. Use keyword search instead.',
      );
    }

    const [queryVec] = await this.embeddingProvider.embed([query]);
    if (!queryVec) return [];

    const vectorParam = `[${queryVec.join(',')}]`;

    const raw = await this.dataSource.query<RawChunkQueryResult[]>(
      `
      SELECT 
        c.id,
        c.knowledge_source_id,
        c.text,
        c.metadata,
        c.token_count,
        c.chunk_index,
        s.source_type,
        s.source_id,
        s.title,
        s.source_revision,
        p.name AS project_name,
        p.key AS project_key,
        (1 - (c.embedding <=> $1::vector)) AS score_signal
      FROM knowledge_chunks c
      INNER JOIN knowledge_sources s ON s.id = c.knowledge_source_id
      LEFT JOIN projects p ON p.id = s.project_id
      WHERE s.project_id = ANY($2::uuid[])
        AND s.status = 'INDEXED'
        AND s.deleted_at IS NULL
        AND c.index_version = s.active_index_version
        AND c.embedding IS NOT NULL
        AND c.embedding_model = $5
        AND ($3::varchar IS NULL OR s.source_type = $3)
      ORDER BY c.embedding <=> $1::vector ASC
      LIMIT $4;
      `,
      [vectorParam, projectIds, sourceType ?? null, limit, this.embeddingProvider.modelName],
    );

    return raw.map((row) => this.mapToEvidence(row, row.score_signal ?? 0));
  }

  private analyzeQuery(query: string): {
    expandedTsQuery: string;
    typePreference?: KnowledgeSourceType;
    topicPatterns: string[];
  } {
    const lower = query.toLowerCase().trim();
    const stopWords = new Set([
      'how',
      'many',
      'we',
      'currently',
      'have',
      'do',
      'any',
      'i',
      'can',
      'on',
      'with',
      'about',
      'the',
      'a',
      'an',
      'is',
      'are',
      'what',
      'for',
      'there',
      'to',
      'in',
      'of',
      'and',
      'or',
      'our',
      'my',
      'work',
    ]);

    let typePreference: KnowledgeSourceType | undefined;
    if (/\b(doc|docs|document|documents)\b/i.test(lower))
      typePreference = KnowledgeSourceType.DOCUMENT;
    else if (/\b(task|tasks)\b/i.test(lower)) typePreference = KnowledgeSourceType.TASK;
    else if (/\b(requirement|requirements|req|reqs)\b/i.test(lower))
      typePreference = KnowledgeSourceType.REQUIREMENT;
    else if (/\b(decision|decisions|adr|adrs)\b/i.test(lower))
      typePreference = KnowledgeSourceType.DECISION;
    else if (/\b(meeting|meetings)\b/i.test(lower)) typePreference = KnowledgeSourceType.MEETING;

    const rawWords = lower
      .replace(/[^a-z0-9\s_-]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    const terms: string[] = [];
    const topicPatterns: string[] = [];

    for (const w of rawWords) {
      if (stopWords.has(w)) continue;
      if (w === 'datawarehouse' || w === 'data-warehouse') {
        terms.push('datawarehous', 'warehous', 'dwh');
        topicPatterns.push('%dwh%', '%warehouse%', '%datawarehouse%');
      } else if (w === 'dwh') {
        terms.push('dwh', 'warehous');
        topicPatterns.push('%dwh%', '%warehouse%');
      } else if (w === 'warehouse') {
        terms.push('warehous', 'dwh');
        topicPatterns.push('%warehouse%', '%dwh%');
      } else if (w === 'docs' || w === 'doc') {
        terms.push('document');
      } else {
        terms.push(w);
      }
    }

    const uniqueTerms = Array.from(new Set(terms));
    const expandedTsQuery = uniqueTerms.length > 0 ? uniqueTerms.join(' | ') : '';
    return {
      expandedTsQuery,
      typePreference,
      topicPatterns,
    };
  }

  private async retrieveKeyword(
    projectIds: string[],
    query: string,
    sourceType?: KnowledgeSourceType,
    limit = 8,
  ): Promise<RetrievedEvidence[]> {
    const analysis = this.analyzeQuery(query);
    const effectiveType = sourceType ?? analysis.typePreference;

    const raw = await this.dataSource.query<RawChunkQueryResult[]>(
      `
      WITH query_terms AS (
        SELECT 
          plainto_tsquery('english', $1) AS ptq,
          NULLIF(replace(plainto_tsquery('english', $1)::text, '&', '|'), '') AS otq_text,
          to_tsquery('english', NULLIF($6, '')) AS exp_tq
      )
      SELECT 
        c.id,
        c.knowledge_source_id,
        c.text,
        c.metadata,
        c.token_count,
        c.chunk_index,
        s.source_type,
        s.source_id,
        s.title,
        s.source_revision,
        p.name AS project_name,
        p.key AS project_key,
        (
          COALESCE(ts_rank_cd(to_tsvector('english', s.title || ' ' || c.text), q.ptq), 0) * 2.0
          + CASE 
              WHEN q.exp_tq IS NOT NULL THEN COALESCE(ts_rank_cd(to_tsvector('english', s.title || ' ' || c.text), q.exp_tq), 0) * 3.0
              ELSE 0.0 
            END
          + CASE 
              WHEN $7::text[] IS NOT NULL AND (s.title ILIKE ANY($7::text[]) OR c.text ILIKE ANY($7::text[])) THEN 15.0
              ELSE 0.0
            END
          + CASE 
              WHEN $3::varchar IS NOT NULL AND s.source_type = $3 THEN 8.0
              WHEN s.source_type IN ('TASK', 'REQUIREMENT', 'DECISION', 'MEETING', 'DOCUMENT') THEN 4.0 
              ELSE 0.1 
            END
          + CASE 
              WHEN s.title ILIKE $4 THEN 2.0 
              WHEN c.text ILIKE $4 THEN 1.0 
              ELSE 0.0 
            END
        ) AS score_signal
      FROM knowledge_chunks c
      INNER JOIN knowledge_sources s ON s.id = c.knowledge_source_id
      LEFT JOIN projects p ON p.id = s.project_id
      CROSS JOIN query_terms q
      WHERE s.project_id = ANY($2::uuid[])
        AND s.status = 'INDEXED'
        AND s.deleted_at IS NULL
        AND c.index_version = s.active_index_version
        AND (
          (q.ptq != ''::tsquery AND to_tsvector('english', s.title || ' ' || c.text) @@ q.ptq)
          OR (q.exp_tq IS NOT NULL AND to_tsvector('english', s.title || ' ' || c.text) @@ q.exp_tq)
          OR ($7::text[] IS NOT NULL AND (s.title ILIKE ANY($7::text[]) OR c.text ILIKE ANY($7::text[])))
          OR c.text ILIKE $4
          OR s.title ILIKE $4
          OR ($3::varchar IS NOT NULL AND s.source_type = $3)
        )
      ORDER BY score_signal DESC, c.id ASC
      LIMIT $5;
      `,
      [
        query,
        projectIds,
        effectiveType ?? null,
        `%${query}%`,
        limit,
        analysis.expandedTsQuery,
        analysis.topicPatterns.length > 0 ? analysis.topicPatterns : null,
      ],
    );

    if (raw.length === 0) {
      // Partitioned Fallback: when user query is conversational or keyword match is empty,
      // retrieve recent active tasks, requirements, decisions, meetings, and documents across all target workspaces.
      const fallbackRaw: RawChunkQueryResult[] = await this.dataSource.query(
        `
        SELECT 
          ranked.chunk_id AS id,
          ranked.knowledge_source_id,
          ranked.chunk_index,
          ranked.text,
          ranked.metadata,
          ranked.token_count,
          ranked.source_type,
          ranked.source_id,
          ranked.title,
          ranked.source_revision,
          p.name AS project_name,
          p.key AS project_key,
          1.0 AS score_signal
        FROM (
          SELECT c.id AS chunk_id, c.knowledge_source_id, c.chunk_index, c.text, c.metadata, c.token_count,
                 s.source_type, s.source_id, s.title, s.source_revision, s.project_id, s.updated_at,
                 ROW_NUMBER() OVER(PARTITION BY s.project_id ORDER BY 
                   CASE 
                     WHEN s.source_type = 'TASK' THEN 1
                     WHEN s.source_type = 'REQUIREMENT' THEN 2
                     WHEN s.source_type = 'DECISION' THEN 3
                     WHEN s.source_type = 'MEETING' THEN 4
                     WHEN s.source_type = 'DOCUMENT' THEN 5
                     ELSE 6
                   END ASC,
                   s.updated_at DESC
                 ) as rn
          FROM knowledge_chunks c
          INNER JOIN knowledge_sources s ON s.id = c.knowledge_source_id
          WHERE s.project_id = ANY($1::uuid[])
            AND s.status = 'INDEXED'
            AND s.deleted_at IS NULL
            AND c.index_version = s.active_index_version
            AND c.chunk_index = 0
            AND ($3::varchar IS NULL OR s.source_type = $3)
            AND s.source_type IN ('TASK', 'REQUIREMENT', 'DECISION', 'MEETING', 'DOCUMENT')
        ) ranked
        LEFT JOIN projects p ON p.id = ranked.project_id
        WHERE ranked.rn <= 4
        ORDER BY ranked.rn ASC, ranked.updated_at DESC
        LIMIT $2;
        `,
        [projectIds, limit, sourceType ?? null],
      );

      return fallbackRaw.map((row) => this.mapToEvidence(row, row.score_signal ?? 1.0));
    }

    return raw.map((row) => this.mapToEvidence(row, row.score_signal ?? 0));
  }

  private async retrieveHybrid(
    projectIds: string[],
    query: string,
    sourceType?: KnowledgeSourceType,
    limit = 8,
  ): Promise<RetrievedEvidence[]> {
    if (!this.embeddingProvider) return this.retrieveKeyword(projectIds, query, sourceType, limit);
    const candidateLimit = Math.max(limit * 2, 20);

    const [semanticCandidates, keywordCandidates] = await Promise.all([
      this.retrieveSemantic(projectIds, query, sourceType, candidateLimit),
      this.retrieveKeyword(projectIds, query, sourceType, candidateLimit),
    ]);

    // Reciprocal Rank Fusion (RRF) with k = 60
    const k = 60;
    const scoreMap = new Map<string, { evidence: RetrievedEvidence; rrfScore: number }>();

    semanticCandidates.forEach((item, index) => {
      const rank = index + 1;
      const score = 1 / (k + rank);
      scoreMap.set(item.chunkId, {
        evidence: item,
        rrfScore: score,
      });
    });

    keywordCandidates.forEach((item, index) => {
      const rank = index + 1;
      const score = 1 / (k + rank);
      const existing = scoreMap.get(item.chunkId);
      if (existing) {
        existing.rrfScore += score;
      } else {
        scoreMap.set(item.chunkId, {
          evidence: item,
          rrfScore: score,
        });
      }
    });

    const ranked = Array.from(scoreMap.values())
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, limit)
      .map(({ evidence, rrfScore }) => ({
        ...evidence,
        score: Number(rrfScore.toFixed(6)),
      }));

    return ranked;
  }

  private mapToEvidence(row: RawChunkQueryResult, score: number | string): RetrievedEvidence {
    const numScore = Number(score) || 0;
    let locator = `Chunk #${row.chunk_index + 1}`;
    if (row.metadata) {
      const meta = row.metadata;
      if (Array.isArray(meta.headingBreadcrumbs) && meta.headingBreadcrumbs.length > 0) {
        locator = meta.headingBreadcrumbs.join(' > ');
      } else if (typeof (meta.page ?? meta.pageNumber) === 'number') {
        locator = `Page ${meta.page ?? meta.pageNumber}`;
      } else if (typeof meta.sectionTitle === 'string' && meta.sectionTitle) {
        locator = meta.sectionTitle;
      } else if (typeof meta.section === 'string') {
        locator = meta.section;
      }
    }

    // Build snippet: first 250 characters of chunk
    const snippet = row.text.length > 250 ? `${row.text.substring(0, 247)}...` : row.text;

    return {
      chunkId: row.id,
      sourceId: row.source_id,
      sourceType: row.source_type,
      title: row.title,
      revision: row.source_revision,
      projectName: row.project_name,
      projectKey: row.project_key,
      locator,
      snippet,
      text: row.text,
      score: Number(numScore.toFixed(6)),
    };
  }
}
