import 'reflect-metadata';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { parse } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../../src/database/database-options';
import { AssistantService } from '../../src/modules/assistant/assistant.service';
import { ContextAssembler } from '../../src/modules/assistant/context/context-assembler';
import { ConversationContextService } from '../../src/modules/assistant/context/conversation-context.service';
import { ConversationHistoryRepository } from '../../src/modules/assistant/context/conversation-history.repository';
import { HistoryRecallService } from '../../src/modules/assistant/context/history-recall.service';
import { HistoryVectorRepository } from '../../src/modules/assistant/context/history-vector.repository';
import { Conversation } from '../../src/modules/assistant/entities/conversation.entity';
import { ChatMessage } from '../../src/modules/assistant/entities/chat-message.entity';
import { DeepSeekLlmProvider } from '../../src/modules/assistant/llm/deepseek-llm-provider';
import { PrivateMemoryService } from '../../src/modules/assistant/memory/private-memory.service';
import { PrivateMemoryRepository } from '../../src/modules/assistant/memory/private-memory.repository';
import { KnowledgeClientService } from '../../src/modules/knowledge-client/knowledge-client.service';
import { IngestionService } from '../../src/modules/ingestion/ingestion.service';
import { RetrievalService } from '../../src/modules/mavis/retrieval/retrieval.service';
import { Project } from '../../src/modules/projects/entities/project.entity';
import {
  ProjectMember,
  ProjectRole,
} from '../../src/modules/projects/entities/project-member.entity';
import { User } from '../../src/modules/users/entities/user.entity';

// Explicit opt-in: requires the sibling service running with synthetic fixtures.
const smoke = process.env.OSCAR_KNOWLEDGE_SMOKE === 'true' ? describe : describe.skip;
smoke('Independent knowledge HTTP → OSCAR persisted answer (scripted generation)', () => {
  it('retrieves a real fixture, preserves its citation, replays safely and survives an outage', async () => {
    const url = process.env.DATABASE_URL;
    if (process.env.NODE_ENV !== 'test' || !url || !new URL(url).pathname.endsWith('_test'))
      throw new Error('Dedicated test database required');
    const db = await new DataSource(databaseOptions(url)).initialize();
    let smokeProjectId: string | undefined;
    let smokeUserId: string | undefined;
    try {
      await db.runMigrations({ transaction: 'all' });
      const user = await db.getRepository(User).save({
        email: `${randomUUID()}@knowledge.test`,
        displayName: 'Knowledge smoke',
        passwordHash: 'synthetic-only',
      });
      smokeUserId = user.id;
      const project = await db.getRepository(Project).save({
        key: `K${randomUUID().slice(0, 7).toUpperCase()}`,
        name: 'Synthetic Rentify demo',
        createdBy: user.id,
      });
      smokeProjectId = project.id;
      await db
        .getRepository(ProjectMember)
        .save({ projectId: project.id, userId: user.id, accessRole: ProjectRole.OWNER });
      const conv = await db
        .getRepository(Conversation)
        .save({ projectId: project.id, userId: user.id, title: 'Knowledge smoke' });
      const knowledgeEnv = parse(readFileSync('../oscar-knowledge/.env'));
      const config = new ConfigService({
        OSCAR_KNOWLEDGE_ENABLED: true,
        OSCAR_KNOWLEDGE_SERVICE_TOKEN: knowledgeEnv.KNOWLEDGE_SERVICE_TOKEN,
        OSCAR_KNOWLEDGE_BASE_URL: 'http://127.0.0.1:8010',
        OSCAR_KNOWLEDGE_COLLECTION: 'mba-business',
        // This explicit real-service test can run alongside GPU/CPU validation.
        // Production timeout behavior is covered by unit and live outage checks.
        OSCAR_KNOWLEDGE_TIMEOUT_MS: 10000,
      });
      const realFetch = global.fetch;
      let generationCalls = 0;
      jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
        if (String(input) === 'http://127.0.0.1:8010/internal/v1/retrieve')
          return realFetch(input, init);
        if (String(input) !== 'https://api.deepseek.com/chat/completions')
          throw new Error('Unexpected network destination');
        generationCalls++;
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content:
                    'Scripted demo: test basic and premium subscriptions, then measure conversion and retention [Evidence #1]. Invalid source [Evidence #99].',
                },
              },
            ],
          }),
        );
      });
      const provider = new DeepSeekLlmProvider('synthetic-never-sent-to-provider');
      const history = new ConversationHistoryRepository(db);
      const context = new ConversationContextService(
        db,
        new ConfigService(),
        provider,
        history,
        new HistoryRecallService(history, new HistoryVectorRepository(db), null),
      );
      const chat = new AssistantService(
        db.getRepository(Conversation),
        db.getRepository(ChatMessage),
        db.getRepository(Project),
        db.getRepository(ProjectMember),
        db.getRepository(User),
        new RetrievalService(db),
        new ContextAssembler(),
        provider,
        {} as IngestionService,
        new PrivateMemoryService(new PrivateMemoryRepository(db), null),
        context,
        undefined,
        undefined,
        undefined,
        undefined,
        new KnowledgeClientService(config),
      );
      const dto = {
        content: 'subscription pricing',
        includeKnowledge: true,
        clientRequestId: randomUUID(),
      };
      const answer = await chat.postMessage(project.id, user.id, conv.id, dto);
      const saved = await db
        .getRepository(ChatMessage)
        .findOneByOrFail({ id: answer.assistantMessage.id });
      expect(saved.citations).toHaveLength(1);
      expect(saved.citations[0]).toMatchObject({
        sourceType: 'EXTERNAL_KNOWLEDGE',
        courseCode: 'DEMO-PRICING',
        locator: 'Pricing experiments',
        sourceUrl: 'https://example.org/oscar-demo/pricing',
      });
      expect((await chat.postMessage(project.id, user.id, conv.id, dto)).assistantMessage.id).toBe(
        saved.id,
      );
      expect(generationCalls).toBe(1);
      // Read-only smoke artifact: explicitly identifies the mocked generation transport.
      mkdirSync('var/knowledge-integration', { recursive: true });
      writeFileSync(
        'var/knowledge-integration/scripted-smoke.json',
        JSON.stringify(
          {
            verification:
              'Real knowledge HTTP and OSCAR PostgreSQL persistence; scripted DeepSeek transport, no live model call',
            question: dto.content,
            answer: saved.content,
            citations: saved.citations,
          },
          null,
          2,
        ),
      );
      jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
        if (String(input).startsWith('http://127.0.0.1:8010/')) throw new Error('simulated outage');
        return new Response(
          JSON.stringify({
            choices: [
              { finish_reason: 'stop', message: { content: 'Workspace-only scripted answer.' } },
            ],
          }),
        );
      });
      const outage = await chat.postMessage(project.id, user.id, conv.id, {
        content: 'pricing',
        includeKnowledge: true,
      });
      expect(outage.assistantMessage.content).toContain(
        'Supplementary knowledge sources were unavailable',
      );
    } finally {
      jest.restoreAllMocks();
      try {
        // Remove only this test's generated fixture so global history workers in
        // later suites cannot claim its messages.
        if (smokeProjectId) await db.getRepository(Project).delete(smokeProjectId);
        if (smokeUserId) await db.getRepository(User).delete(smokeUserId);
      } finally {
        await db.destroy();
      }
    }
  }, 30000);
});
