import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { GoalsService } from './goals.service';
import {
  CreateGoalDto,
  CreateGoalMetricDto,
  ListGoalsQueryDto,
  UpdateGoalDto,
  UpdateGoalMetricDto,
} from './dto';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { ProjectPolicyGuard } from '../../common/guards/project-policy.guard';
import { RequireProjectRole } from '../../common/decorators/project-role.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { ProjectRole } from '../projects/entities/project-member.entity';

@ApiTags('Goals')
@ApiCookieAuth()
@Controller('projects/:projectId/goals')
@UseGuards(SessionAuthGuard, CsrfGuard, ProjectPolicyGuard)
export class GoalsController {
  constructor(private readonly goalsService: GoalsService) {}

  @Get()
  @ApiOperation({ summary: 'List project goals with filters and pagination' })
  @ApiOkResponse({ description: 'Goals returned' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiNotFoundResponse({ description: 'Project not found' })
  async list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ListGoalsQueryDto,
  ) {
    const { data, total } = await this.goalsService.listProjectGoals(projectId, query);
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    return {
      data: data.map((goal) => ({
        ...goal,
        ...this.goalsService.calculateMeasuredProgress(goal, goal.metrics || []),
      })),
      meta: { page, limit, total },
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireProjectRole(ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.CONTRIBUTOR)
  @ApiOperation({ summary: 'Create a new project goal' })
  @ApiHeader({ name: 'x-csrf-token', description: 'CSRF token', required: true })
  @ApiCreatedResponse({ description: 'Goal created' })
  async create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateGoalDto,
    @Req() req: Request,
  ) {
    const requestId = req.headers['x-request-id'] as string | undefined;
    const goal = await this.goalsService.createGoal(user.id, dto, projectId, user.id, requestId);
    return { data: goal };
  }

  @Get(':goalId')
  @ApiOperation({ summary: 'Get goal details' })
  @ApiOkResponse({ description: 'Goal returned' })
  @ApiNotFoundResponse({ description: 'Goal not found' })
  async getById(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @CurrentUser() user: User,
  ) {
    const goal = await this.goalsService.getGoal(goalId, user.id, projectId);
    return { data: goal };
  }

  @Get(':goalId/summary')
  @ApiOperation({ summary: 'Get goal summary with measured progress, linked tasks and decisions' })
  @ApiOkResponse({ description: 'Goal summary returned' })
  @ApiNotFoundResponse({ description: 'Goal not found' })
  async getSummary(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @CurrentUser() user: User,
  ) {
    const summary = await this.goalsService.getGoalSummary(goalId, user.id, projectId);
    return {
      data: {
        ...summary.goal,
        ...summary.breakdown,
        linkedTasks: summary.linkedTasks,
        linkedDecisions: summary.linkedDecisions,
      },
    };
  }

  @Patch(':goalId')
  @RequireProjectRole(ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.CONTRIBUTOR)
  @ApiOperation({ summary: 'Update a goal' })
  @ApiHeader({ name: 'x-csrf-token', description: 'CSRF token', required: true })
  @ApiOkResponse({ description: 'Goal updated' })
  async update(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateGoalDto,
    @Req() req: Request,
  ) {
    const requestId = req.headers['x-request-id'] as string | undefined;
    const goal = await this.goalsService.updateGoal(
      goalId,
      user.id,
      dto,
      projectId,
      user.id,
      requestId,
    );
    return { data: goal };
  }

  @Delete(':goalId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireProjectRole(ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.CONTRIBUTOR)
  @ApiOperation({ summary: 'Soft-delete a goal' })
  @ApiHeader({ name: 'x-csrf-token', description: 'CSRF token', required: true })
  @ApiNoContentResponse({ description: 'Goal deleted' })
  async delete(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @CurrentUser() user: User,
    @Req() req: Request,
  ) {
    const requestId = req.headers['x-request-id'] as string | undefined;
    await this.goalsService.deleteGoal(goalId, user.id, projectId, user.id, requestId);
  }

  @Post(':goalId/metrics')
  @HttpCode(HttpStatus.CREATED)
  @RequireProjectRole(ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.CONTRIBUTOR)
  @ApiOperation({ summary: 'Add a metric to a goal' })
  @ApiHeader({ name: 'x-csrf-token', description: 'CSRF token', required: true })
  @ApiCreatedResponse({ description: 'Metric created' })
  async addMetric(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateGoalMetricDto,
    @Req() req: Request,
  ) {
    const requestId = req.headers['x-request-id'] as string | undefined;
    const metric = await this.goalsService.addMetric(
      goalId,
      user.id,
      dto,
      projectId,
      user.id,
      requestId,
    );
    return { data: metric };
  }

  @Patch(':goalId/metrics/:metricId')
  @RequireProjectRole(ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.CONTRIBUTOR)
  @ApiOperation({ summary: 'Update a goal metric' })
  @ApiHeader({ name: 'x-csrf-token', description: 'CSRF token', required: true })
  @ApiOkResponse({ description: 'Metric updated' })
  async updateMetric(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @Param('metricId', ParseUUIDPipe) metricId: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateGoalMetricDto,
    @Req() req: Request,
  ) {
    const requestId = req.headers['x-request-id'] as string | undefined;
    const metric = await this.goalsService.updateMetric(
      goalId,
      metricId,
      user.id,
      dto,
      projectId,
      user.id,
      requestId,
    );
    return { data: metric };
  }

  @Delete(':goalId/metrics/:metricId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireProjectRole(ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.CONTRIBUTOR)
  @ApiOperation({ summary: 'Delete a goal metric' })
  @ApiHeader({ name: 'x-csrf-token', description: 'CSRF token', required: true })
  @ApiNoContentResponse({ description: 'Metric deleted' })
  async deleteMetric(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @Param('metricId', ParseUUIDPipe) metricId: string,
    @CurrentUser() user: User,
    @Req() req: Request,
  ) {
    const requestId = req.headers['x-request-id'] as string | undefined;
    await this.goalsService.deleteMetric(goalId, metricId, user.id, projectId, user.id, requestId);
  }

  @Get(':goalId/revisions')
  @ApiOperation({ summary: 'List goal revisions' })
  @ApiOkResponse({ description: 'Revisions returned' })
  @ApiNotFoundResponse({ description: 'Goal not found' })
  async listRevisions(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @CurrentUser() user: User,
  ) {
    const revisions = await this.goalsService.listRevisions(goalId, user.id, projectId);
    return { data: revisions };
  }
}
