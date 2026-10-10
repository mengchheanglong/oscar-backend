import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectMember } from '../projects/entities/project-member.entity';
import { LocalFoldersController } from './local-folders.controller';
import { LocalFoldersService } from './local-folders.service';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectMember])],
  controllers: [LocalFoldersController],
  providers: [LocalFoldersService],
})
export class LocalFoldersModule {}
