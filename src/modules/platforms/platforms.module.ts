import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformConnection } from './entities/platform-connection.entity';
import { ExternalLink } from './entities/external-link.entity';
import { ProjectMember } from '../projects/entities/project-member.entity';
import { Project } from '../projects/entities/project.entity';
import { Goal } from '../goals/entities/goal.entity';
import { PaperclipAdapter } from './adapters/paperclip.adapter';
import { T3Adapter } from './adapters/t3.adapter';
import { PlatformsService } from './platforms.service';
import { PlatformsController } from './platforms.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([PlatformConnection, ExternalLink, ProjectMember, Project, Goal]),
  ],
  controllers: [PlatformsController],
  providers: [PlatformsService, PaperclipAdapter, T3Adapter],
  exports: [PlatformsService, PaperclipAdapter, T3Adapter],
})
export class PlatformsModule {}
