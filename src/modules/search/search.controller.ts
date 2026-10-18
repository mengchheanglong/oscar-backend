import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SearchService } from './search.service';
import { SearchQueryDto, SearchResponseDto } from './dto/search.dto';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { ProjectPolicyGuard } from '../../common/guards/project-policy.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

@ApiTags('Search')
@ApiCookieAuth()
@Controller('projects/:projectId/search')
@UseGuards(SessionAuthGuard, CsrfGuard, ProjectPolicyGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({
    summary: 'Search project knowledge base across decisions, tasks, and documents',
  })
  @ApiOkResponse({
    description: 'Search results returned successfully',
    type: SearchResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiNotFoundResponse({ description: 'Project not found or inaccessible' })
  async search(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: SearchQueryDto,
    @CurrentUser() user: User,
  ): Promise<SearchResponseDto> {
    return this.searchService.search(projectId, query, user.id);
  }
}
