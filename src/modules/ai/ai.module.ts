import { LocalFoldersModule } from '../local-folders/local-folders.module';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectMember } from '../projects/entities/project-member.entity';
import { Project } from '../projects/entities/project.entity';
import { Requirement } from '../requirements/entities/requirement.entity';
import { Meeting } from '../meetings/entities/meeting.entity';
import { Task } from '../tasks/entities/task.entity';
import { Decision } from '../decisions/entities/decision.entity';
import { IngestionModule } from '../ingestion/ingestion.module';
import { AiController } from './ai.controller';
import { AgentRunsController } from './agent-runs.controller';
import { AgentRunsService } from './agent-runs.service';
import { AgentRun } from './entities/agent-run.entity';
import { HermesRuntime } from './runtime/hermes-runtime';
import { AiService } from './ai.service';
import { CopilotMemory } from './entities/copilot-memory.entity';
import { CopilotMemoryService } from './copilot-memory.service';
import { CopilotMemoryController } from './copilot-memory.controller';
import { ContextAssembler } from './context/context-assembler';
import { ChatMessage } from './entities/chat-message.entity';
import { Conversation } from './entities/conversation.entity';
import { AIProposal } from './entities/proposal.entity';
import { ProposalCommit } from './entities/proposal-commit.entity';
import { DeepSeekLlmProvider, MockLlmProvider } from './llm';
import { UnavailableLlmProvider } from './llm/unavailable-llm-provider';
import { User } from '../users/entities/user.entity';
import { ProposalsController } from './proposals.controller';
import { ProposalsService } from './proposals.service';
import { RetrievalService } from './retrieval/retrieval.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Conversation,
      AgentRun,
      CopilotMemory,
      ChatMessage,
      AIProposal,
      ProposalCommit,
      Project,
      ProjectMember,
      Requirement,
      Meeting,
      Task,
      Decision,
      User,
    ]),
    IngestionModule,
    LocalFoldersModule,
  ],
  controllers: [AiController, ProposalsController, CopilotMemoryController, AgentRunsController],
  providers: [
    RetrievalService,
    ContextAssembler,
    AiService,
    AgentRunsService,
    { provide: 'AGENT_RUNTIME', useClass: HermesRuntime },
    CopilotMemoryService,
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
  exports: [AiService, ProposalsService, RetrievalService, ContextAssembler, 'LLM_PROVIDER'],
})
export class AiModule {}
