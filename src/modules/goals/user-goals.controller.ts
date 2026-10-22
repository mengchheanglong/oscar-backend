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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

@ApiTags('Goals')
@ApiCookieAuth()
@Controller('goals')
@UseGuards(SessionAuthGuard, CsrfGuard)
export class UserGoalsController {
  constructor(private readonly goalsService: GoalsService) {}

  @Get()
  @ApiOperation({ summary: 'List user-owned goals with filters and pagination' })
  @ApiOkResponse({ description: 'Goals returned' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  async listUserGoals(@CurrentUser() user: User, @Query() query: ListGoalsQueryDto) {
    const { data, total } = await this.goalsService.listUserGoals(user.id, query);
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
  @ApiOperation({ summary: 'Create a new user-owned goal' })
  @ApiHeader({ name: 'x-csrf-token', description: 'CSRF token', required: true })
  @ApiCreatedResponse({ description: 'Goal created' })
  async createGoal(@CurrentUser() user: User, @Body() dto: CreateGoalDto, @Req() req: Request) {
    const requestId = req.headers['x-request-id'] as string | undefined;
    const goal = await this.goalsService.createGoal(user.id, dto, undefined, user.id, requestId);
    return { data: goal };
  }

  @Get(':goalId')
  @ApiOperation({ summary: 'Get goal details by ID' })
  @ApiOkResponse({ description: 'Goal returned' })
  @ApiNotFoundResponse({ description: 'Goal not found' })
  async getGoal(@Param('goalId', ParseUUIDPipe) goalId: string, @CurrentUser() user: User) {
    const goal = await this.goalsService.getGoal(goalId, user.id);
    return { data: goal };
  }

  @Get(':goalId/summary')
  @ApiOperation({ summary: 'Get goal summary with measured progress, linked tasks and decisions' })
  @ApiOkResponse({ description: 'Goal summary returned' })
  @ApiNotFoundResponse({ description: 'Goal not found' })
  async getGoalSummary(@Param('goalId', ParseUUIDPipe) goalId: string, @CurrentUser() user: User) {
    const summary = await this.goalsService.getGoalSummary(goalId, user.id);
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
  @ApiOperation({ summary: 'Update a user-owned goal' })
  @ApiHeader({ name: 'x-csrf-token', description: 'CSRF token', required: true })
  @ApiOkResponse({ description: 'Goal updated' })
  async updateGoal(
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
      undefined,
      user.id,
      requestId,
    );
    return { data: goal };
  }

  @Delete(':goalId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a user-owned goal' })
  @ApiHeader({ name: 'x-csrf-token', description: 'CSRF token', required: true })
  @ApiNoContentResponse({ description: 'Goal deleted' })
  async deleteGoal(
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @CurrentUser() user: User,
    @Req() req: Request,
  ) {
    const requestId = req.headers['x-request-id'] as string | undefined;
    await this.goalsService.deleteGoal(goalId, user.id, undefined, user.id, requestId);
  }

  @Post(':goalId/metrics')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a metric to a user goal' })
  @ApiHeader({ name: 'x-csrf-token', description: 'CSRF token', required: true })
  @ApiCreatedResponse({ description: 'Metric created' })
  async addMetric(
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
      undefined,
      user.id,
      requestId,
    );
    return { data: metric };
  }

  @Patch(':goalId/metrics/:metricId')
  @ApiOperation({ summary: 'Update a user goal metric' })
  @ApiHeader({ name: 'x-csrf-token', description: 'CSRF token', required: true })
  @ApiOkResponse({ description: 'Metric updated' })
  async updateMetric(
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
      undefined,
      user.id,
      requestId,
    );
    return { data: metric };
  }

  @Delete(':goalId/metrics/:metricId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a user goal metric' })
  @ApiHeader({ name: 'x-csrf-token', description: 'CSRF token', required: true })
  @ApiNoContentResponse({ description: 'Metric deleted' })
  async deleteMetric(
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @Param('metricId', ParseUUIDPipe) metricId: string,
    @CurrentUser() user: User,
    @Req() req: Request,
  ) {
    const requestId = req.headers['x-request-id'] as string | undefined;
    await this.goalsService.deleteMetric(goalId, metricId, user.id, undefined, user.id, requestId);
  }

  @Get(':goalId/revisions')
  @ApiOperation({ summary: 'List revisions of a user goal' })
  @ApiOkResponse({ description: 'Revisions returned' })
  async listRevisions(@Param('goalId', ParseUUIDPipe) goalId: string, @CurrentUser() user: User) {
    const revisions = await this.goalsService.listRevisions(goalId, user.id);
    return { data: revisions };
  }
}
