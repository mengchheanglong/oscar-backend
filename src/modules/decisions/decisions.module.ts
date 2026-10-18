import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Decision } from './entities/decision.entity';
import { DecisionRevision } from './entities/decision-revision.entity';
import { Project } from '../projects/entities/project.entity';
import { ProjectMember } from '../projects/entities/project-member.entity';
import { DecisionsService } from './decisions.service';
import { DecisionsController } from './decisions.controller';
import { ProjectPolicyGuard } from '../../common/guards/project-policy.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Decision, DecisionRevision, Project, ProjectMember])],
  controllers: [DecisionsController],
  providers: [DecisionsService, ProjectPolicyGuard],
  exports: [DecisionsService, TypeOrmModule],
})
export class DecisionsModule {}
