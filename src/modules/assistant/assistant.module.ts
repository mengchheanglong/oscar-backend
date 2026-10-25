import { SkillsModule } from '../skills/skills.module';
import { KnowledgeClientModule } from '../knowledge-client/knowledge-client.module';
import { PlatformsModule } from '../platforms/platforms.module';
import { PlatformHandoff } from './entities/platform-handoff.entity';
import { PlatformHandoffsService } from './platform-handoffs.service';
import { PlatformHandoffsController } from './platform-handoffs.controller';
import { MavisModule } from '../mavis/mavis.module';
import { LocalFoldersModule } from '../local-folders/local-folders.module';
import { Module } from '@nestjs/common';
import { HistoryIndexRepository } from './context/history-index.repository';
import { HistoryIndexWorker } from './context/history-index.worker';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectMember } from '../projects/entities/project-member.entity';
import { Project } from '../projects/entities/project.entity';
import { Task } from '../tasks/entities/task.entity';
import { Decision } from '../decisions/entities/decision.entity';
import { Goal } from '../goals/entities/goal.entity';
import { GoalsModule } from '../goals/goals.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { AssistantController } from './assistant.controller';
import { AgentRunsController } from './agent-runs.controller';
import { AgentRunsService } from './agent-runs.service';
import { AgentRun } from './entities/agent-run.entity';
import { HermesRuntime } from './runtime/hermes-runtime';
import { AssistantService } from './assistant.service';
import { SavedMemory } from './entities/saved-memory.entity';
import { SavedMemoryService } from './saved-memory.service';
import { SavedMemoryController } from './saved-memory.controller';
import { ContextAssembler } from './context/context-assembler';
import { ChatMessage } from './entities/chat-message.entity';
import { Conversation } from './entities/conversation.entity';
import { AssistantProposal } from './entities/proposal.entity';
import { ProposalCommit } from './entities/proposal-commit.entity';
import { DeepSeekLlmProvider, MockLlmProvider } from './llm';
import { UnavailableLlmProvider } from './llm/unavailable-llm-provider';
import { User } from '../users/entities/user.entity';
import { ProposalsController } from './proposals.controller';
import { ProposalsService } from './proposals.service';
import { PrivateMemoryRepository } from './memory/private-memory.repository';
import { PrivateMemoryService, MEMORY_EMBEDDER } from './memory/private-memory.service';
import { memoryEmbedder } from './memory/private-memory.provider';
import { ConversationContextService } from './context/conversation-context.service';
import { ConversationHistoryRepository } from './context/conversation-history.repository';
import { HistoryRecallService } from './context/history-recall.service';
import { HistoryVectorRepository } from './context/history-vector.repository';
import {
  HISTORY_MAX_DISTANCE,
  DEFAULT_HISTORY_MAX_DISTANCE,
} from './context/history-retrieval.contract';

@Module({
  imports: [
    KnowledgeClientModule,
    SkillsModule,
    TypeOrmModule.forFeature([
      Conversation,
      PlatformHandoff,
      AgentRun,
      SavedMemory,
      ChatMessage,
      AssistantProposal,
      ProposalCommit,
      Project,
      ProjectMember,
      Task,
      Decision,
      Goal,
      User,
    ]),
    IngestionModule,
    LocalFoldersModule,
    GoalsModule,
    MavisModule,
    PlatformsModule,
  ],
  controllers: [
    AssistantController,
    ProposalsController,
    SavedMemoryController,
    AgentRunsController,
    PlatformHandoffsController,
  ],
  providers: [
    HistoryIndexRepository,
    HistoryIndexWorker,
    HistoryRecallService,
    HistoryVectorRepository,
    {
      provide: HISTORY_MAX_DISTANCE,
      useFactory: (config: ConfigService) =>
        config.get<number>('AI_HISTORY_MAX_COSINE_DISTANCE', DEFAULT_HISTORY_MAX_DISTANCE),
      inject: [ConfigService],
    },
    ConversationHistoryRepository,
    ConversationContextService,
    PrivateMemoryRepository,
    PrivateMemoryService,
    { provide: MEMORY_EMBEDDER, useFactory: memoryEmbedder, inject: [ConfigService] },
    ContextAssembler,
    AssistantService,
    AgentRunsService,
    PlatformHandoffsService,
    { provide: 'AGENT_RUNTIME', useClass: HermesRuntime },
    SavedMemoryService,
    ProposalsService,
    {
      provide: 'LLM_PROVIDER',
      useFactory: (configService: ConfigService) => {
        const aiEnabled = configService.get<boolean>('AI_ENABLED');
        const apiKey = configService.get<string>('DEEPSEEK_API_KEY');
        const baseUrl =
          configService.get<string>('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com';
        const model = configService.get<string>('AI_CHAT_MODEL') || 'deepseek-flash';

        if (aiEnabled && apiKey) {
          return new DeepSeekLlmProvider(apiKey, baseUrl, model);
        }
        return process.env.NODE_ENV === 'test'
          ? new MockLlmProvider()
          : new UnavailableLlmProvider();
      },
      inject: [ConfigService],
    },
  ],
  exports: [AssistantService, ProposalsService, MavisModule, ContextAssembler, 'LLM_PROVIDER'],
})
export class AssistantModule {}
