import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { HumanReviewGuard } from '../../common/guards/human-review.guard';
import { User } from '../users/entities/user.entity';
import { ChiefService } from './chief.service';
import { ChiefPreferencesDto, ReviewExecutionDto } from './chief.dto';
import {
  ChiefBriefingResponseDto,
  ChiefPreferencesResponseDto,
  ExecutionReviewResponseDto,
  ExecutionReviewEnvelopeDto,
} from './chief-response.dto';
import { ExecutionReview } from './entities/execution-review.entity';

function publicReview(row: ExecutionReview | null): ExecutionReviewResponseDto | null {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.projectId,
    platform: row.platform,
    runId: row.runId,
    goalId: row.goalId,
    verdict: row.verdict,
    observation: row.observation,
    reportedCostUsd: row.reportedCostUsd,
    memoryId: row.memoryId,
    createdAt: row.createdAt,
  };
}

@ApiTags('Chief of staff')
@ApiCookieAuth()
@Controller('chief')
@UseGuards(SessionAuthGuard, CsrfGuard)
export class ChiefController {
  constructor(private readonly chief: ChiefService) {}
  @Get('briefing')
  @ApiOkResponse({ type: ChiefBriefingResponseDto })
  @ApiOperation({
    summary:
      'Current scoped goals, blockers, execution reviews and reported spending. Rebuilt with current permissions.',
  })
  @ApiQuery({ name: 'projectId', required: false, type: String, format: 'uuid' })
  briefing(
    @CurrentUser() user: User,
    @Query('projectId', new ParseUUIDPipe({ optional: true })) projectId?: string,
  ) {
    return this.chief.briefing(user.id, projectId);
  }
  @Get('preferences') @ApiOkResponse({ type: ChiefPreferencesResponseDto }) preferences(
    @CurrentUser() user: User,
  ) {
    return this.chief.preferences(user.id);
  }
  @Put('preferences')
  @ApiOkResponse({ type: ChiefPreferencesResponseDto })
  @UseGuards(HumanReviewGuard)
  preferencesUpdate(@CurrentUser() user: User, @Body() dto: ChiefPreferencesDto) {
    return this.chief.savePreferences(user.id, dto);
  }
  @Post('executions/:platform/:id/review')
  @ApiCreatedResponse({ type: ExecutionReviewResponseDto })
  @UseGuards(HumanReviewGuard)
  @ApiOperation({
    summary:
      'Review a terminal owned execution. Optional lessons create proposed memories, never approved memories or goal progress.',
  })
  async review(
    @CurrentUser() user: User,
    @Param('platform', new ParseEnumPipe({ hermes: 'hermes', t3: 't3', paperclip: 'paperclip' }))
    platform: 'hermes' | 't3' | 'paperclip',
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewExecutionDto,
  ) {
    return publicReview(await this.chief.review(user.id, platform, id, dto));
  }
  @Get('executions/:platform/:id/review')
  @ApiOkResponse({ type: ExecutionReviewEnvelopeDto })
  async getReview(
    @CurrentUser() user: User,
    @Param('platform', new ParseEnumPipe({ hermes: 'hermes', t3: 't3', paperclip: 'paperclip' }))
    platform: 'hermes' | 't3' | 'paperclip',
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: publicReview(await this.chief.getReview(user.id, platform, id)) };
  }
}
