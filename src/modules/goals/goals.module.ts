import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Goal, GoalMetric, GoalRevision } from './entities';
import { GoalsService } from './goals.service';
import { GoalsController } from './goals.controller';
import { UserGoalsController } from './user-goals.controller';
import { Task } from '../tasks/entities/task.entity';
import { Decision } from '../decisions/entities/decision.entity';
import { Project } from '../projects/entities/project.entity';
import { ProjectMember } from '../projects/entities/project-member.entity';
import { User } from '../users/entities/user.entity';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Goal,
      GoalMetric,
      GoalRevision,
      Task,
      Decision,
      Project,
      ProjectMember,
      User,
    ]),
    AuditModule,
  ],
  controllers: [GoalsController, UserGoalsController],
  providers: [GoalsService],
  exports: [GoalsService],
})
export class GoalsModule {}
