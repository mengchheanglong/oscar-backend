import { LiveFoldersService } from './live-folders.service';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectMember } from '../projects/entities/project-member.entity';
import { LocalFoldersController } from './local-folders.controller';
import { LocalFoldersService } from './local-folders.service';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectMember])],
  controllers: [LocalFoldersController],
  exports: [LiveFoldersService],
  providers: [LocalFoldersService, LiveFoldersService],
})
export class LocalFoldersModule {}
