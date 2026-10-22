import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from './entities/task.entity';
import { Project } from '../projects/entities/project.entity';
import { ProjectMember } from '../projects/entities/project-member.entity';
import { Goal } from '../goals/entities/goal.entity';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { UserTasksController } from './user-tasks.controller';
import { ProjectPolicyGuard } from '../../common/guards/project-policy.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Task, Project, ProjectMember, Goal])],
  controllers: [TasksController, UserTasksController],
  providers: [TasksService, ProjectPolicyGuard],
  exports: [TasksService, TypeOrmModule],
})
export class TasksModule {}
