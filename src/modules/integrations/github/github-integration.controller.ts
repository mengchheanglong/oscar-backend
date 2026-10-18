import { SyncGitHubDto } from './dto/sync-github.dto';
import { SyncCodebaseDto } from './dto/sync-codebase.dto';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireProjectRole } from '../../../common/decorators/project-role.decorator';
import { ProjectPolicyGuard } from '../../../common/guards/project-policy.guard';
import { SessionAuthGuard } from '../../../common/guards/session-auth.guard';
import { CsrfGuard } from '../../../common/guards/csrf.guard';
import { ProjectRole } from '../../projects/entities/project-member.entity';
import { ConnectGitHubDto } from './dto/connect-github.dto';
import {
  GitHubConnectionResponseDto,
  GitHubIssueResponseDto,
  GitHubPullRequestResponseDto,
  GitHubRepoFileResponseDto,
  SyncCodebaseResponseDto,
  SyncGitHubResponseDto,
} from './dto/github-responses.dto';
import { ListGitHubIssuesQueryDto } from './dto/list-github-issues-query.dto';
import { ListGitHubPullRequestsQueryDto } from './dto/list-github-prs-query.dto';
import { ListGitHubFilesQueryDto } from './dto/list-github-files-query.dto';
import { GitHubIntegrationService } from './github-integration.service';

@ApiTags('GitHub Integration')
@ApiCookieAuth()
@Controller('projects/:projectId/integrations/github')
@UseGuards(SessionAuthGuard, CsrfGuard, ProjectPolicyGuard)
export class GitHubIntegrationController {
  constructor(private readonly githubService: GitHubIntegrationService) {}

  @Get()
  @RequireProjectRole(
    ProjectRole.OWNER,
    ProjectRole.MANAGER,
    ProjectRole.CONTRIBUTOR,
    ProjectRole.VIEWER,
  )
  @ApiOperation({ summary: 'Get current GitHub connection for project' })
  @ApiResponse({ status: 200, type: GitHubConnectionResponseDto })
  async getConnection(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('connectionId', new ParseUUIDPipe({ optional: true })) connectionId?: string,
  ): Promise<GitHubConnectionResponseDto | null> {
    return this.githubService.getConnection(projectId, connectionId);
  }

  @Get('connections')
  @RequireProjectRole(
    ProjectRole.OWNER,
    ProjectRole.MANAGER,
    ProjectRole.CONTRIBUTOR,
    ProjectRole.VIEWER,
  )
  @ApiOperation({ summary: 'List all connected repositories for project' })
  @ApiResponse({ status: 200, type: [GitHubConnectionResponseDto] })
  async listConnections(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<GitHubConnectionResponseDto[]> {
    return this.githubService.listConnections(projectId);
  }

  @Get('connections/:connectionId')
  @RequireProjectRole(
    ProjectRole.OWNER,
    ProjectRole.MANAGER,
    ProjectRole.CONTRIBUTOR,
    ProjectRole.VIEWER,
  )
  @ApiOperation({ summary: 'Get specific connected repository by ID' })
  @ApiResponse({ status: 200, type: GitHubConnectionResponseDto })
  async getConnectionById(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
  ): Promise<GitHubConnectionResponseDto | null> {
    return this.githubService.getConnection(projectId, connectionId);
  }

  @Post('connect')
  @RequireProjectRole(ProjectRole.OWNER, ProjectRole.MANAGER)
  @ApiOperation({ summary: 'Connect repository and trigger initial sync' })
  @ApiResponse({ status: 200, type: GitHubConnectionResponseDto })
  async connect(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser('id') actorId: string,
    @Body() dto: ConnectGitHubDto,
  ): Promise<GitHubConnectionResponseDto> {
    return this.githubService.connectRepository(projectId, actorId, dto);
  }

  @Post('sync')
  @RequireProjectRole(ProjectRole.OWNER, ProjectRole.MANAGER)
  @ApiOperation({ summary: 'Manually trigger issues and pull requests sync from GitHub' })
  @ApiResponse({ status: 200, type: SyncGitHubResponseDto })
  async sync(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser('id') actorId: string,
    @Body() dto: SyncGitHubDto,
  ): Promise<SyncGitHubResponseDto> {
    return this.githubService.syncRepository(projectId, actorId, dto.connectionId, dto.accessToken);
  }

  @Post('connections/:connectionId/sync')
  @RequireProjectRole(ProjectRole.OWNER, ProjectRole.MANAGER)
  @ApiOperation({ summary: 'Manually trigger sync for a specific connected repository' })
  @ApiResponse({ status: 200, type: SyncGitHubResponseDto })
  async syncSpecificConnection(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @CurrentUser('id') actorId: string,
    @Body() dto: SyncGitHubDto,
  ): Promise<SyncGitHubResponseDto> {
    return this.githubService.syncRepository(projectId, actorId, connectionId, dto.accessToken);
  }

  @Post('sync-code')
  @RequireProjectRole(ProjectRole.OWNER, ProjectRole.MANAGER)
  @ApiOperation({ summary: 'Index repository source code and docs into vector memory' })
  @ApiResponse({ status: 200, type: SyncCodebaseResponseDto })
  async syncCode(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser('id') actorId: string,
    @Body() dto: SyncCodebaseDto,
  ): Promise<SyncCodebaseResponseDto> {
    return this.githubService.syncCodebase(
      projectId,
      actorId,
      dto.connectionId,
      dto.accessToken,
      dto,
    );
  }

  @Post('connections/:connectionId/sync-code')
  @RequireProjectRole(ProjectRole.OWNER, ProjectRole.MANAGER)
  @ApiOperation({ summary: 'Index source code and docs for specific repository' })
  @ApiResponse({ status: 200, type: SyncCodebaseResponseDto })
  async syncCodeForConnection(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @CurrentUser('id') actorId: string,
    @Body() dto: SyncCodebaseDto,
  ): Promise<SyncCodebaseResponseDto> {
    return this.githubService.syncCodebase(projectId, actorId, connectionId, dto.accessToken, dto);
  }

  @Delete('connections/:connectionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireProjectRole(ProjectRole.OWNER, ProjectRole.MANAGER)
  @ApiOperation({ summary: 'Disconnect specific repository' })
  @ApiResponse({ status: 204, description: 'Disconnected successfully' })
  async disconnectConnection(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @CurrentUser('id') actorId: string,
  ): Promise<void> {
    await this.githubService.disconnect(projectId, actorId, connectionId);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireProjectRole(ProjectRole.OWNER, ProjectRole.MANAGER)
  @ApiOperation({ summary: 'Disconnect primary repository' })
  @ApiResponse({ status: 204, description: 'Disconnected successfully' })
  async disconnect(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser('id') actorId: string,
    @Query('connectionId', new ParseUUIDPipe({ optional: true })) connectionId?: string,
  ): Promise<void> {
    await this.githubService.disconnect(projectId, actorId, connectionId);
  }

  @Get('issues')
  @RequireProjectRole(
    ProjectRole.OWNER,
    ProjectRole.MANAGER,
    ProjectRole.CONTRIBUTOR,
    ProjectRole.VIEWER,
  )
  @ApiOperation({ summary: 'List synced GitHub issues for project' })
  @ApiResponse({ status: 200, type: [GitHubIssueResponseDto] })
  async listIssues(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ListGitHubIssuesQueryDto,
  ): Promise<{ items: GitHubIssueResponseDto[]; total: number; page: number; limit: number }> {
    return this.githubService.listIssues(projectId, query);
  }

  @Get('pull-requests')
  @RequireProjectRole(
    ProjectRole.OWNER,
    ProjectRole.MANAGER,
    ProjectRole.CONTRIBUTOR,
    ProjectRole.VIEWER,
  )
  @ApiOperation({ summary: 'List synced GitHub pull requests for project' })
  @ApiResponse({ status: 200, type: [GitHubPullRequestResponseDto] })
  async listPullRequests(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ListGitHubPullRequestsQueryDto,
  ): Promise<{
    items: GitHubPullRequestResponseDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    return this.githubService.listPullRequests(projectId, query);
  }

  @Get('files')
  @RequireProjectRole(
    ProjectRole.OWNER,
    ProjectRole.MANAGER,
    ProjectRole.CONTRIBUTOR,
    ProjectRole.VIEWER,
  )
  @ApiOperation({ summary: 'List indexed GitHub codebase files for project' })
  @ApiResponse({ status: 200, type: [GitHubRepoFileResponseDto] })
  async listFiles(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ListGitHubFilesQueryDto,
  ): Promise<{ items: GitHubRepoFileResponseDto[]; total: number; page: number; limit: number }> {
    return this.githubService.listFiles(projectId, query);
  }
}
