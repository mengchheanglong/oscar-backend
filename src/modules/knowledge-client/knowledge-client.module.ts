import { Module } from '@nestjs/common';
import { KnowledgeClientService } from './knowledge-client.service';
import { KnowledgeLibraryController } from './knowledge-library.controller';

@Module({
  controllers: [KnowledgeLibraryController],
  providers: [KnowledgeClientService],
  exports: [KnowledgeClientService],
})
export class KnowledgeClientModule {}
