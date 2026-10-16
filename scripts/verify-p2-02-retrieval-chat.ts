import { ConversationContextService } from '../src/modules/ai/context/conversation-context.service';
import { ConversationHistoryRepository } from '../src/modules/ai/context/conversation-history.repository';
import { HistoryRecallService } from '../src/modules/ai/context/history-recall.service';
import { HistoryVectorRepository } from '../src/modules/ai/context/history-vector.repository';
import { ConfigService } from '@nestjs/config';
import 'reflect-metadata';
import 'dotenv/config';
import { mockVerificationDatabaseUrl } from './mock-verification-database';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../src/database/database-options';
import { Conversation, AiMode } from '../src/modules/ai/entities/conversation.entity';
import { ChatMessage } from '../src/modules/ai/entities/chat-message.entity';
import { RetrievalService } from '../src/modules/ai/retrieval/retrieval.service';
import { ContextAssembler } from '../src/modules/ai/context/context-assembler';
import { MockLlmProvider } from '../src/modules/ai/llm/mock-llm-provider';
import { AiService } from '../src/modules/ai/ai.service';
import { MockEmbeddingProvider } from '../src/modules/ingestion/embedding';
import { Project } from '../src/modules/projects/entities/project.entity';
import { ProjectMember } from '../src/modules/projects/entities/project-member.entity';
import { User, SystemRole } from '../src/modules/users/entities/user.entity';
import {
  KnowledgeSource,
  KnowledgeChunk,
  KnowledgeSourceType,
  KnowledgeSourceStatus,
} from '../src/modules/ingestion/entities';

async function main() {
  console.log('================================================================');
  console.log('  MILESTONE P2-02 VERIFICATION: Retrieval, Context & AI Chat');
  console.log('================================================================\n');

  const url = mockVerificationDatabaseUrl();

  const dataSource = new DataSource(databaseOptions(url));
  await dataSource.initialize();
  console.log('✓ Database connection established.');

  try {
    // 1. Verify Schema & Tables
    console.log('\n[Step 1] Verifying schema and database tables...');
    const tables = await dataSource.query<{ table_name: string }[]>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('ai_conversations', 'ai_messages');
    `);
    console.log(`Found ${tables.length}/2 AI tables:`, tables.map((t) => t.table_name).join(', '));
    if (tables.length < 2) {
      throw new Error('Missing ai_conversations or ai_messages table!');
    }

    const indexes = await dataSource.query<{ indexname: string }[]>(`
      SELECT indexname FROM pg_indexes 
      WHERE tablename IN ('ai_conversations', 'ai_messages');
    `);
    const indexNames = indexes.map((i) => i.indexname);
    console.log('Verified AI indexes:', indexNames.join(', '));

    // 2. Setup Services
    console.log('\n[Step 2] Initializing AI retrieval & generation services...');
    const mockEmbeddingProvider = new MockEmbeddingProvider(1536, 'mock-embedding-3-small');
    const retrievalService = new RetrievalService(dataSource);
    retrievalService.setEmbeddingProvider(mockEmbeddingProvider);

    const contextAssembler = new ContextAssembler();
    const mockLlmProvider = new MockLlmProvider();

    const mockIngestionService = {
      getEmbeddingProvider: () => mockEmbeddingProvider,
    } as unknown as import('../src/modules/ingestion/ingestion.service').IngestionService;

    const aiService = new AiService(
      dataSource.getRepository(Conversation),
      dataSource.getRepository(ChatMessage),
      dataSource.getRepository(Project),
      dataSource.getRepository(ProjectMember),
      dataSource.getRepository(User),
      retrievalService,
      contextAssembler,
      mockLlmProvider,
      mockIngestionService,
      {
        select: async () => [],
      } as unknown as import('../src/modules/ai/memory/private-memory.service').PrivateMemoryService,
      new ConversationContextService(
        dataSource,
        new ConfigService({ AI_CHAT_MODEL: 'deepseek-v4-pro' }),
        mockLlmProvider,
        new ConversationHistoryRepository(dataSource),
        new HistoryRecallService(
          new ConversationHistoryRepository(dataSource),
          new HistoryVectorRepository(dataSource),
          null,
        ),
      ),
    );

    // 3. Find or Create Test Project & User
    console.log('\n[Step 3] Finding test project and user...');
    const projectRepo = dataSource.getRepository(Project);
    const userRepo = dataSource.getRepository(User);

    let project = await projectRepo.findOne({ where: {} });
    let user = await userRepo.findOne({ where: {} });

    if (!user) {
      user = userRepo.create({
        email: 'p202-tester@example.com',
        passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyzABCDEF',
        displayName: 'P202 Tester',
        systemRole: SystemRole.USER,
      });
      user = await userRepo.save(user);
    }

    if (!project) {
      project = projectRepo.create({
        name: 'P2-02 Verification Workspace',
        key: 'P202',
        description: 'Workspace for verifying retrieval and AI chat',
        createdBy: user.id,
      });
      project = await projectRepo.save(project);
    }

    console.log(`Using Project: [${project.key}] ${project.name} (${project.id})`);
    console.log(`Using User: ${user.displayName} (${user.id})`);

    // 4. Seed Test Knowledge Source & Vector Chunks
    console.log('\n[Step 4] Seeding verified knowledge source and pgvector chunk...');
    const ksRepo = dataSource.getRepository(KnowledgeSource);
    const chunkRepo = dataSource.getRepository(KnowledgeChunk);

    let testKs = await ksRepo.findOne({
      where: { projectId: project.id, title: 'P2-02 Architecture Document' },
    });

    if (!testKs) {
      testKs = ksRepo.create({
        projectId: project.id,
        sourceType: KnowledgeSourceType.DOCUMENT,
        sourceId: 'd0c00000-0000-4000-8000-000000000001',
        title: 'P2-02 Architecture Document',
        sourceRevision: 1,
        status: KnowledgeSourceStatus.INDEXED,
        contentHash: 'hash-p202-arch-doc',
        activeIndexVersion: 1,
      });
      testKs = await ksRepo.save(testKs);
    }

    // Ensure pgvector chunk exists
    const [testEmbedding] = await mockEmbeddingProvider.embed([
      'PostgreSQL pgvector extension enables cosine similarity hybrid search with Reciprocal Rank Fusion.',
    ]);

    await chunkRepo.delete({ knowledgeSourceId: testKs.id });
    const chunk = chunkRepo.create({
      projectId: project.id,
      knowledgeSourceId: testKs.id,
      indexVersion: 1,
      chunkIndex: 0,
      tokenCount: 65,
      text: 'PostgreSQL pgvector extension enables cosine similarity hybrid search with Reciprocal Rank Fusion.',
      embedding: testEmbedding,
      metadata: { headingBreadcrumbs: ['Architecture', 'Vector Pipeline'] },
    });
    await chunkRepo.save(chunk);
    console.log(`✓ Seeded knowledge chunk (ID: ${chunk.id}) with vector embedding.`);

    // 5. Test Hybrid Retrieval
    console.log(
      '\n[Step 5] Testing hybrid retrieval engine (dense pgvector + sparse FTS + RRF)...',
    );
    const evidence = await retrievalService.retrieve({
      actorId: user.id,
      projectId: project.id,
      query: 'pgvector cosine similarity hybrid search',
      mode: 'hybrid',
      limit: 5,
    });

    console.log(`✓ Retrieved ${evidence.length} evidence items:`);
    evidence.forEach((e, idx) => {
      console.log(`   [${idx + 1}] "${e.title}" (${e.locator}) - Score: ${e.score}`);
    });
    if (evidence.length === 0) {
      throw new Error('Hybrid retrieval returned 0 results for indexed chunk!');
    }

    // 6. Test Context Assembler & Mode Instructions
    console.log('\n[Step 6] Testing context assembly & untrusted data framing...');
    const assembled = contextAssembler.assemble(project.name, AiMode.DEVELOPER, evidence);
    if (!assembled.systemPrompt.includes('Developer mode')) {
      throw new Error('ContextAssembler missing mode instruction');
    }
    if (!assembled.systemPrompt.includes('UNTRUSTED DATA BOUNDARY')) {
      throw new Error('ContextAssembler missing untrusted data boundary');
    }
    console.log('✓ System prompt constructed with untrusted data boundary and Developer mode.');

    // 7. Test AI Conversation Lifecycle & Chat Grounding
    console.log('\n[Step 7] Testing conversation lifecycle & grounded chat...');
    const conv = await aiService.createConversation(project.id, user.id, {
      title: 'Milestone P2-02 Q&A',
      defaultMode: AiMode.DEVELOPER,
    });
    console.log(`✓ Created conversation (ID: ${conv.id})`);

    // 7a. Grounded Question
    console.log('\n[Step 7a] Query with grounded question matching project records...');
    const groundResult = await aiService.postMessage(project.id, user.id, conv.id, {
      content: 'How does the hybrid search use pgvector?',
      mode: AiMode.DEVELOPER,
    });

    console.log('User Message:', groundResult.userMessage.content);
    console.log('Assistant Response:', groundResult.assistantMessage.content);
    console.log(`Grounded Citations Count: ${groundResult.assistantMessage.citations.length}`);
    if (groundResult.assistantMessage.citations.length === 0) {
      throw new Error('Expected citations for grounded query!');
    }
    console.log('✓ Validated citation:', groundResult.assistantMessage.citations[0]);

    // 7b. Unsupported Question (Honest Refusal Test)
    console.log('\n[Step 7b] Query with unsupported question (no project evidence)...');
    const refusalResult = await aiService.postMessage(project.id, user.id, conv.id, {
      content: 'What will be the weather in Antarctica on New Year eve?',
      mode: AiMode.DEVELOPER,
    });

    console.log('User Message:', refusalResult.userMessage.content);
    console.log('Assistant Response:', refusalResult.assistantMessage.content);
    console.log(`Refusal Citations Count: ${refusalResult.assistantMessage.citations.length}`);

    if (
      !refusalResult.assistantMessage.content.includes(
        'insufficient evidence to answer this question',
      )
    ) {
      throw new Error('Expected honest refusal on question with no project evidence!');
    }
    if (refusalResult.assistantMessage.citations.length !== 0) {
      throw new Error('Expected 0 citations on refused question!');
    }
    console.log('✓ Honest refusal verified without hallucinating citations.');

    // 8. Test Multi-Tenant Privacy & Project Isolation
    console.log('\n[Step 8] Testing multi-tenant access isolation...');
    const otherProject = projectRepo.create({
      name: 'Unrelated Foreign Project',
      key: 'FOR',
      createdBy: user.id,
    });
    await projectRepo.save(otherProject);

    let crossProjectBlocked = false;
    try {
      await aiService.getConversation(otherProject.id, user.id, conv.id);
    } catch {
      crossProjectBlocked = true;
    }

    if (!crossProjectBlocked) {
      throw new Error('Cross-project conversation leakage allowed!');
    }
    console.log('✓ Cross-project conversation access physically blocked at repository layer.');

    // Cleanup foreign project
    await projectRepo.delete({ id: otherProject.id });

    console.log('\n================================================================');
    console.log('  SUCCESS: Milestone P2-02 Verification Passed 100%');
    console.log('================================================================\n');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
