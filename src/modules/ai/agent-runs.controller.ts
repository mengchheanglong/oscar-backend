import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AllowArchived } from '../../common/decorators/project-role.decorator';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { ProjectPolicyGuard } from '../../common/guards/project-policy.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { User } from '../users/entities/user.entity';
import { AgentRunsService } from './agent-runs.service';
import { AgentRunResponseDto, CreateAgentRunDto, RuntimeStatusDto } from './dto/agent-run.dto';

@ApiTags('Agent Runs')
@ApiCookieAuth()
@Controller('projects/:projectId/ai/runs')
@UseGuards(SessionAuthGuard, CsrfGuard, ProjectPolicyGuard)
export class AgentRunsController {
  constructor(private readonly runs: AgentRunsService) {}
  @Get('runtime')
  @ApiOkResponse({ type: RuntimeStatusDto })
  status() {
    return this.runs.status();
  }
  @Get()
  @ApiOkResponse({ type: [AgentRunResponseDto] })
  async list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: User,
    @Query('conversationId', new ParseUUIDPipe({ optional: true })) conversationId?: string,
  ) {
    return (await this.runs.list(projectId, user.id, conversationId)).map(
      AgentRunResponseDto.fromEntity,
    );
  }
  @Get(':id')
  @ApiOkResponse({ type: AgentRunResponseDto })
  async get(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return AgentRunResponseDto.fromEntity(await this.runs.get(projectId, user.id, id));
  }
  @Post()
  @ApiCreatedResponse({ type: AgentRunResponseDto })
  async create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateAgentRunDto,
  ) {
    return AgentRunResponseDto.fromEntity(await this.runs.create(projectId, user.id, dto));
  }
  @Post(':id/cancel')
  @AllowArchived()
  @ApiOkResponse({ type: AgentRunResponseDto })
  async cancel(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return AgentRunResponseDto.fromEntity(await this.runs.cancel(projectId, user.id, id));
  }
}
