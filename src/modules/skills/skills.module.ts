import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectMember } from '../projects/entities/project-member.entity';
import { Module } from '@nestjs/common';
import { SkillsService } from './skills.service';
import { SkillsController, ConversationSkillsController } from './skills.controller';
@Module({
  imports: [TypeOrmModule.forFeature([ProjectMember])],
  controllers: [SkillsController, ConversationSkillsController],
  providers: [SkillsService],
  exports: [SkillsService],
})
export class SkillsModule {}
