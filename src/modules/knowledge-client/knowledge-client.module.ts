import { Module } from '@nestjs/common';
import { KnowledgeClientService } from './knowledge-client.service';

@Module({ providers: [KnowledgeClientService], exports: [KnowledgeClientService] })
export class KnowledgeClientModule {}
