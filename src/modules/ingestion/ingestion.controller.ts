import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireProjectRole } from '../../common/decorators/project-role.decorator';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { ProjectPolicyGuard } from '../../common/guards/project-policy.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { ProjectRole } from '../projects/entities/project-member.entity';
import { User } from '../users/entities/user.entity';
import { ListKnowledgeSourcesDto } from './dto/list-sources.dto';
import { IngestionService } from './ingestion.service';

@ApiTags('Ingestion')
@ApiCookieAuth()
@Controller('projects/:projectId/ingestion')
@UseGuards(SessionAuthGuard, CsrfGuard, ProjectPolicyGuard)
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Get('sources')
  @ApiOperation({ summary: 'List knowledge sources for a project' })
  @ApiOkResponse({ description: 'Knowledge sources returned' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  async listSources(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ListKnowledgeSourcesDto,
    @CurrentUser() user: User,
  ) {
    return this.ingestionService.listSources(projectId, query, user.id);
  }

  @Get('sources/:sourceId')
  @ApiOperation({ summary: 'Get details of a knowledge source including chunks' })
  @ApiOkResponse({ description: 'Knowledge source returned' })
  @ApiNotFoundResponse({ description: 'Knowledge source not found' })
  async getSource(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('sourceId', ParseUUIDPipe) sourceId: string,
    @CurrentUser() user: User,
  ) {
    return this.ingestionService.getSource(projectId, sourceId, user.id);
  }

  @Post('sources/:sourceId/reindex')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireProjectRole(ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.CONTRIBUTOR)
  @ApiOperation({ summary: 'Trigger manual re-indexing of a knowledge source' })
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOkResponse({ description: 'Reindexing job created' })
  async reindexSource(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('sourceId', ParseUUIDPipe) sourceId: string,
    @CurrentUser() user: User,
  ) {
    return this.ingestionService.reindexSource(projectId, sourceId, user.id);
  }

  @Get('jobs')
  @ApiOperation({ summary: 'List background ingestion and reindexing jobs' })
  @ApiOkResponse({ description: 'Jobs returned' })
  async listJobs(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.ingestionService.listJobs(projectId);
  }
}
