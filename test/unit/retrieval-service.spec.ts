import { DataSource } from 'typeorm';
import { RetrievalService } from '../../src/modules/ai/retrieval/retrieval.service';
import { KnowledgeSourceType } from '../../src/modules/ingestion/entities';
import { EmbeddingProvider } from '../../src/modules/ingestion/embedding/embedding-provider.interface';

describe('RetrievalService', () => {
  let service: RetrievalService;
  let mockDataSource: { query: jest.Mock };
  let mockEmbeddingProvider: EmbeddingProvider;

  beforeEach(() => {
    mockDataSource = {
      query: jest.fn(),
    };

    mockEmbeddingProvider = {
      embed: jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
      dimensions: 1536,
      modelName: 'mock-embed',
    };

    service = new RetrievalService(mockDataSource as unknown as DataSource);
    service.setEmbeddingProvider(mockEmbeddingProvider);
  });

  it('returns empty array when query is empty or whitespace', async () => {
    const result = await service.retrieve({
      actorId: 'user-1',
      projectId: 'proj-1',
      query: '   ',
    });

    expect(result).toEqual([]);
    expect(mockDataSource.query).not.toHaveBeenCalled();
  });

  it('performs keyword retrieval using PostgreSQL full-text search', async () => {
    mockDataSource.query.mockResolvedValue([
      {
        id: 'chunk-1',
        knowledge_source_id: 'ks-1',
        text: 'Authentication architecture documentation',
        metadata: { headingBreadcrumbs: ['Architecture', 'Security'] },
        token_count: 50,
        chunk_index: 0,
        source_type: KnowledgeSourceType.DOCUMENT,
        source_id: 'doc-1',
        title: 'Architecture Doc',
        source_revision: 1,
        score_signal: 0.85,
      },
    ]);

    const result = await service.retrieve({
      actorId: 'user-1',
      projectId: 'proj-1',
      query: 'Authentication architecture',
      mode: 'keyword',
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      chunkId: 'chunk-1',
      sourceId: 'doc-1',
      sourceType: KnowledgeSourceType.DOCUMENT,
      title: 'Architecture Doc',
      revision: 1,
      locator: 'Architecture > Security',
      snippet: 'Authentication architecture documentation',
      text: 'Authentication architecture documentation',
      score: 0.85,
    });
  });

  it('performs semantic retrieval using pgvector cosine distance', async () => {
    mockDataSource.query.mockResolvedValue([
      {
        id: 'chunk-2',
        knowledge_source_id: 'ks-2',
        text: 'Bi-directional synchronization details',
        metadata: { page: 4 },
        token_count: 80,
        chunk_index: 2,
        source_type: KnowledgeSourceType.REQUIREMENT,
        source_id: 'req-1',
        title: 'Requirement 1',
        source_revision: 2,
        score_signal: 0.92,
      },
    ]);

    const result = await service.retrieve({
      actorId: 'user-1',
      projectId: 'proj-1',
      query: 'How does synchronization work?',
      mode: 'semantic',
    });

    expect(mockEmbeddingProvider.embed).toHaveBeenCalledWith(['How does synchronization work?']);
    expect(result).toHaveLength(1);
    expect(result[0]!.locator).toBe('Page 4');
    expect(result[0]!.score).toBe(0.92);
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('c.embedding_model = $5'),
      expect.arrayContaining(['mock-embed']),
    );
  });

  it('uses real keyword retrieval without embeddings and reports semantic search unavailable', async () => {
    const keywordOnly = new RetrievalService(mockDataSource as unknown as DataSource);
    mockDataSource.query.mockResolvedValueOnce([
      {
        id: 'chunk-1',
        knowledge_source_id: 'src-1',
        text: 'Requirements document text',
        metadata: {},
        token_count: 5,
        chunk_index: 0,
        source_type: KnowledgeSourceType.REQUIREMENT,
        source_id: 'req-1',
        title: 'Auth Requirements',
        source_revision: 1,
        score_signal: 1.5,
      },
    ]);
    const res = await keywordOnly.retrieve({
      actorId: 'user-1',
      projectId: 'proj-1',
      query: 'requirements',
      mode: 'hybrid',
    });
    expect(res).toHaveLength(1);
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('plainto_tsquery'),
      expect.anything(),
    );
    await expect(
      keywordOnly.retrieve({
        actorId: 'user-1',
        projectId: 'proj-1',
        query: 'requirements',
        mode: 'semantic',
      }),
    ).rejects.toThrow('Semantic search requires');
  });

  it('triggers active workspace fallback when keyword search returns no matches', async () => {
    const fallbackService = new RetrievalService(mockDataSource as unknown as DataSource);
    mockDataSource.query
      .mockResolvedValueOnce([]) // keyword query returns empty
      .mockResolvedValueOnce([
        {
          id: 'chunk-fallback-1',
          knowledge_source_id: 'src-f',
          text: 'Recent active task text',
          metadata: {},
          token_count: 5,
          chunk_index: 0,
          source_type: KnowledgeSourceType.TASK,
          source_id: 'task-1',
          title: 'Implement Kanban Board',
          source_revision: 1,
          score_signal: '1.0' as unknown as number, // test string numeric coercion from pg driver
        },
      ]);

    const result = await fallbackService.retrieve({
      actorId: 'user-1',
      projectId: 'proj-1',
      query: 'what i do',
      mode: 'keyword',
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe('Implement Kanban Board');
    expect(mockDataSource.query).toHaveBeenCalledTimes(2);
  });

  it('performs hybrid retrieval with Reciprocal Rank Fusion (RRF)', async () => {
    // Semantic returns chunk-A (rank 1), chunk-B (rank 2)
    // Keyword returns chunk-B (rank 1), chunk-C (rank 2)
    mockDataSource.query
      .mockResolvedValueOnce([
        {
          id: 'chunk-A',
          knowledge_source_id: 'ks-1',
          text: 'Chunk A text',
          metadata: null,
          token_count: 40,
          chunk_index: 0,
          source_type: KnowledgeSourceType.DOCUMENT,
          source_id: 'doc-1',
          title: 'Doc A',
          source_revision: 1,
          score_signal: 0.95,
        },
        {
          id: 'chunk-B',
          knowledge_source_id: 'ks-2',
          text: 'Chunk B text',
          metadata: null,
          token_count: 40,
          chunk_index: 1,
          source_type: KnowledgeSourceType.DOCUMENT,
          source_id: 'doc-2',
          title: 'Doc B',
          source_revision: 1,
          score_signal: 0.85,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'chunk-B',
          knowledge_source_id: 'ks-2',
          text: 'Chunk B text',
          metadata: null,
          token_count: 40,
          chunk_index: 1,
          source_type: KnowledgeSourceType.DOCUMENT,
          source_id: 'doc-2',
          title: 'Doc B',
          source_revision: 1,
          score_signal: 0.9,
        },
        {
          id: 'chunk-C',
          knowledge_source_id: 'ks-3',
          text: 'Chunk C text',
          metadata: null,
          token_count: 40,
          chunk_index: 0,
          source_type: KnowledgeSourceType.TASK,
          source_id: 'task-1',
          title: 'Task C',
          source_revision: 1,
          score_signal: 0.7,
        },
      ]);

    const result = await service.retrieve({
      actorId: 'user-1',
      projectId: 'proj-1',
      query: 'System overview',
      mode: 'hybrid',
      limit: 3,
    });

    // Chunk B appeared in both semantic (rank 2 => 1/62) and keyword (rank 1 => 1/61)
    // Total RRF score for B: 1/62 + 1/61 = 0.016129 + 0.016393 = ~0.0325
    // Chunk A: rank 1 semantic => 1/61 = ~0.016393
    // Chunk C: rank 2 keyword => 1/62 = ~0.016129
    // Therefore Chunk B should be ranked #1
    expect(result).toHaveLength(3);
    expect(result[0]!.chunkId).toBe('chunk-B');
    expect(result[1]!.chunkId).toBe('chunk-A');
    expect(result[2]!.chunkId).toBe('chunk-C');
    expect(result[0]!.score).toBeGreaterThan(result[1]!.score);
  });
});
