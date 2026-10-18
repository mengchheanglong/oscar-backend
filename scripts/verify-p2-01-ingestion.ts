import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../src/database/database-options';
import { mockVerificationDatabaseUrl } from './mock-verification-database';
import { Project } from '../src/modules/projects/entities/project.entity';
import { OutboxEvent } from '../src/modules/ingestion/entities/outbox-event.entity';
import {
  KnowledgeSource,
  KnowledgeSourceStatus,
} from '../src/modules/ingestion/entities/knowledge-source.entity';
import { KnowledgeChunk } from '../src/modules/ingestion/entities/knowledge-chunk.entity';
import { ProcessingJob } from '../src/modules/ingestion/entities/processing-job.entity';
import { OutboxService } from '../src/modules/ingestion/outbox.service';
import { IngestionService } from '../src/modules/ingestion/ingestion.service';
import { LocalStorageService } from '../src/modules/storage/local-storage.service';
import { MockEmbeddingProvider } from '../src/modules/ingestion/embedding/mock-embedding-provider';
import { ConfigService } from '@nestjs/config';

async function verify() {
  const AppDataSource = new DataSource(databaseOptions(mockVerificationDatabaseUrl()));
  console.log('=== P2-01 Ingestion & Vector Pipeline End-to-End Verification ===');
  console.log('Connecting to database...');
  await AppDataSource.initialize();

  try {
    const projectRepo = AppDataSource.getRepository(Project);
    const outboxRepo = AppDataSource.getRepository(OutboxEvent);
    const sourceRepo = AppDataSource.getRepository(KnowledgeSource);
    const chunkRepo = AppDataSource.getRepository(KnowledgeChunk);
    const jobRepo = AppDataSource.getRepository(ProcessingJob);

    // 1. Verify schema tables exist
    console.log('[Step 1] Verifying database schema & tables...');
    const tablesCheck = await AppDataSource.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('knowledge_sources', 'knowledge_chunks', 'outbox_events', 'processing_jobs');
    `);
    console.log(
      `Found ${tablesCheck.length}/4 ingestion tables:`,
      tablesCheck.map((t: { table_name: string }) => t.table_name).join(', '),
    );
    if (tablesCheck.length < 4) {
      throw new Error('Not all ingestion tables exist in the database!');
    }

    // 2. Verify pgvector extension and vector column dimension
    console.log('[Step 2] Verifying pgvector extension & vector column...');
    const vectorColCheck = await AppDataSource.query(`
      SELECT column_name, udt_name FROM information_schema.columns
      WHERE table_name = 'knowledge_chunks' AND column_name = 'embedding';
    `);
    console.log('Vector column check:', vectorColCheck);

    // 3. Find a test project
    let project = await projectRepo.findOne({ where: {} });
    if (!project) {
      console.log('No project found. Creating a test project...');
      project = projectRepo.create({
        name: 'Ingestion Verification Workspace',
        key: 'INGEST',
        description: 'Test project for P2-01 verification',
      });
      project = await projectRepo.save(project);
    }
    console.log(`[Step 3] Using Project: ${project.name} (${project.id})`);

    // 4. Instantiate OutboxService & IngestionService
    console.log('[Step 4] Wiring IngestionService with MockEmbeddingProvider...');
    const configService = new ConfigService({
      EMBEDDING_PROVIDER: 'mock',
      STORAGE_LOCAL_ROOT: './storage',
    });
    const storageService = new LocalStorageService(configService);
    const outboxService = new OutboxService(outboxRepo);
    const ingestionService = new IngestionService(
      sourceRepo,
      chunkRepo,
      jobRepo,
      storageService,
      outboxService,
      configService,
      AppDataSource,
    );
    ingestionService.setEmbeddingProvider(new MockEmbeddingProvider(1536));
    ingestionService.onModuleInit();

    // 5. Emit a task updated outbox event
    const testEntityId = '00000000-0000-0000-0000-' + Date.now().toString(16).padStart(12, '0');
    console.log(`[Step 5] Emitting TASK_UPDATED outbox event for entity ${testEntityId}...`);
    await outboxService.emit({
      projectId: project.id,
      eventType: 'TASK_UPDATED',
      payload: {
        taskId: testEntityId,
        revision: 1,
        title: 'Realtime Bi-directional Synchronization',
        type: 'FUNCTIONAL',
        priority: 'CRITICAL',
        status: 'APPROVED',
        description:
          'The platform must ensure all domain entity updates trigger transactional outbox events that sync into pgvector within 5 seconds under standard load.',
        acceptanceCriteria:
          'Given an updated task, when saved, then pgvector chunks are indexed and searchable via cosine distance.',
        rationale: 'Required for contextual semantic retrieval in AI copilots.',
      },
      dedupeKey: `req:${testEntityId}:1:test`,
    });

    // 6. Process pending outbox events
    console.log('[Step 6] Dispatching outbox event queue...');
    const processed = await outboxService.processPending(10);
    console.log(`Dispatched ${processed} outbox event(s).`);

    // 7. Verify KnowledgeSource created and indexed
    console.log('[Step 7] Verifying KnowledgeSource record...');
    const source = await sourceRepo.findOne({
      where: { projectId: project.id, sourceId: testEntityId },
    });
    if (!source) {
      throw new Error(`KnowledgeSource not created for entity ${testEntityId}!`);
    }
    console.log(
      `KnowledgeSource found: status=${source.status}, type=${source.sourceType}, activeIndexVersion=${source.activeIndexVersion}`,
    );
    if (source.status !== KnowledgeSourceStatus.INDEXED) {
      throw new Error(`Expected KnowledgeSource status to be INDEXED, got ${source.status}`);
    }

    // 8. Verify KnowledgeChunks with 1536-dim vectors
    console.log('[Step 8] Verifying KnowledgeChunk records in pgvector...');
    const chunks = await chunkRepo.find({
      where: { knowledgeSourceId: source.id, indexVersion: source.activeIndexVersion },
    });
    console.log(`Found ${chunks.length} chunks stored.`);
    if (chunks.length === 0 || !chunks[0]) {
      throw new Error('Expected at least 1 chunk to be generated and stored!');
    }
    const sampleChunk = chunks[0];
    if (!sampleChunk.embedding) throw new Error('Expected explicit test embeddings.');
    console.log(
      `Sample chunk ${sampleChunk.id}: index=${sampleChunk.chunkIndex}, tokenCount=${sampleChunk.tokenCount}`,
    );
    console.log(`Embedding dimension: ${sampleChunk.embedding.length}`);
    if (sampleChunk.embedding.length !== 1536) {
      throw new Error(`Expected embedding length 1536, got ${sampleChunk.embedding.length}`);
    }

    // 9. Execute pgvector cosine similarity search test
    console.log('[Step 9] Testing pgvector cosine similarity search (<=> operator)...');
    const mockProvider = new MockEmbeddingProvider(1536);
    const [queryEmbedding] = await mockProvider.embed(['realtime synchronization vector search']);
    const vectorString = `[${queryEmbedding!.join(',')}]`;

    const searchResults = await AppDataSource.query(
      `
      SELECT id, chunk_index, token_count, 1 - (embedding <=> $1::vector) AS cosine_similarity
      FROM knowledge_chunks
      WHERE knowledge_source_id = $2
      ORDER BY embedding <=> $1::vector ASC
      LIMIT 5;
    `,
      [vectorString, source.id],
    );

    console.log('Top similarity search results:', searchResults);
    if (searchResults.length === 0 || searchResults[0].cosine_similarity === null) {
      throw new Error('pgvector similarity search failed to return scored results!');
    }

    // Clean up test data
    console.log('[Step 10] Cleaning up verification artifacts...');
    await chunkRepo.delete({ knowledgeSourceId: source.id });
    await sourceRepo.delete({ id: source.id });
    await outboxRepo.delete({ dedupeKey: `req:${testEntityId}:1:test` });

    console.log(
      '\n>>> SUCCESS: All Milestone P2-01 Ingestion & Vector Pipeline checks passed! <<<',
    );
  } finally {
    await AppDataSource.destroy();
  }
}

verify().catch((err) => {
  console.error('\nVerification failed:', err);
  process.exit(1);
});
