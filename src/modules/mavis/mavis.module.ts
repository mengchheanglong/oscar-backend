import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectMember } from '../projects/entities/project-member.entity';
import { Project } from '../projects/entities/project.entity';
import { User } from '../users/entities/user.entity';
import { Goal } from '../goals/entities/goal.entity';
import { Decision } from '../decisions/entities/decision.entity';
import { AgentRun } from '../assistant/entities/agent-run.entity';
import { ChatMessage } from '../assistant/entities/chat-message.entity';
import { RetrievalService } from './retrieval/retrieval.service';
import { MavisMemory } from './entities/mavis-memory.entity';
import { MavisMemoryVector } from './entities/mavis-memory-vector.entity';
import { MavisService } from './mavis.service';
import { MavisController } from './mavis.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MavisMemory,
      MavisMemoryVector,
      ProjectMember,
      Project,
      User,
      Goal,
      Decision,
      AgentRun,
      ChatMessage,
    ]),
  ],
  controllers: [MavisController],
  providers: [MavisService, RetrievalService],
  exports: [MavisService, RetrievalService],
})
export class MavisModule {}
