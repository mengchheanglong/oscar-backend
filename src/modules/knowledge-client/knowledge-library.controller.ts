import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { User } from '../users/entities/user.entity';
import { KnowledgeClientService } from './knowledge-client.service';

class PrivateCollectionStatusDto {
  @ApiProperty({ enum: ['personal-library', 'social-systems'] })
  id!: 'personal-library' | 'social-systems';
  @ApiProperty({ minimum: 0 })
  indexed_books!: number;
}

class KnowledgePolicyDto {
  @ApiProperty() enabled!: boolean;
  @ApiProperty() required!: boolean;
}

@ApiTags('Reference Knowledge')
@ApiCookieAuth()
@UseGuards(SessionAuthGuard)
@Controller('knowledge')
export class KnowledgeLibraryController {
  constructor(private readonly knowledge: KnowledgeClientService) {}
  @Get('collections')
  @ApiOkResponse({ type: [PrivateCollectionStatusDto] })
  collections(@CurrentUser() user: User): Promise<PrivateCollectionStatusDto[]> {
    return this.knowledge.collections(user.id);
  }
  @Get('policy')
  @ApiOkResponse({ type: KnowledgePolicyDto })
  policy(): KnowledgePolicyDto {
    return this.knowledge.policy();
  }
}
