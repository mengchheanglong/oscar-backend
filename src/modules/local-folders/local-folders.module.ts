import { UploadedFolderWorker } from './uploaded-folder-worker';
import { StorageModule } from '../storage/storage.module';
import { UploadedFoldersService } from './uploaded-folders.service';
import { UploadedFoldersController } from './uploaded-folders.controller';
import { LiveFoldersService } from './live-folders.service';
import { NativeFolderPickerService } from './native-folder-picker.service';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectMember } from '../projects/entities/project-member.entity';
import { LocalFoldersController } from './local-folders.controller';
import { LocalFoldersService } from './local-folders.service';

@Module({
  imports: [StorageModule, TypeOrmModule.forFeature([ProjectMember])],
  controllers: [LocalFoldersController, UploadedFoldersController],
  exports: [LiveFoldersService, UploadedFoldersService],
  providers: [
    UploadedFolderWorker,
    UploadedFoldersService,
    LocalFoldersService,
    LiveFoldersService,
    NativeFolderPickerService,
  ],
})
export class LocalFoldersModule {}
