import { HumanReviewGuard } from '../../common/guards/human-review.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { User } from '../users/entities/user.entity';
import { MavisService } from './mavis.service';
import { CreateCandidateMemoryDto } from './dto/create-candidate-memory.dto';
import {
  ReviewMemoryDto,
  MavisReviewAction,
  MemoryVersionDto,
  RejectMemoryDto,
  CorrectMemoryDto,
  RunMemoryCandidateDto,
} from './dto/review-memory.dto';
import { QueryMemoriesDto } from './dto/query-memories.dto';
import { RetrieveContextDto } from './dto/retrieve-context.dto';
import { MavisMemory } from './entities/mavis-memory.entity';
import { MavisContextPack } from './mavis.contract';

@ApiTags('mavis')
@ApiCookieAuth()
@UseGuards(SessionAuthGuard, CsrfGuard)
@Controller('mavis')
export class MavisController {
  constructor(private readonly mavisService: MavisService) {}

  @Post('context/retrieve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retrieve permissioned MAVIS context pack for an agent session or copilot turn',
  })
  @ApiResponse({
    status: 200,
    description: 'Context pack with approved memories, sources, and execution results',
  })
  async retrieveContext(
    @CurrentUser() user: User,
    @Body() dto: RetrieveContextDto,
  ): Promise<{ data: MavisContextPack }> {
    const pack = await this.mavisService.retrieveContext({
      actorId: user.id,
      query: dto.query,
      projectId: dto.projectId,
      goalId: dto.goalId,
      includeApprovedMemories: dto.includeApprovedMemories,
      includeHistoricalConversations: dto.includeHistoricalConversations,
      includeProjectSources: dto.includeProjectSources,
      includeExecutionResults: dto.includeExecutionResults,
      limit: dto.limit,
    });
    return { data: pack };
  }

  @Get('memories')
  @ApiOperation({ summary: 'List MAVIS memories with scope, status, and type filtering' })
  @ApiResponse({ status: 200, description: 'List of memories' })
  async listMemories(
    @CurrentUser() user: User,
    @Query() query: QueryMemoriesDto,
  ): Promise<{ data: { items: MavisMemory[]; total: number } }> {
    const result = await this.mavisService.listMemories(user.id, query);
    return { data: result };
  }

  @Get('memories/:id')
  @ApiOperation({ summary: 'Get a specific memory by ID with full provenance' })
  @ApiResponse({ status: 200, description: 'Memory record with provenance' })
  async getMemory(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ data: MavisMemory }> {
    const memory = await this.mavisService.getById(user.id, id);
    return { data: memory };
  }

  @Post('memories/candidate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Propose a candidate memory for human review' })
  @ApiResponse({ status: 201, description: 'Candidate memory created with PROPOSED status' })
  async proposeCandidate(
    @CurrentUser() user: User,
    @Body() dto: CreateCandidateMemoryDto,
  ): Promise<{ data: MavisMemory }> {
    const memory = await this.mavisService.proposeCandidate(user.id, dto);
    return { data: memory };
  }

  @Post('memories/from-run/:runId')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a candidate memory from a completed agent run' })
  @ApiResponse({ status: 201, description: 'Candidate memory created with PROPOSED status' })
  async createFromRun(
    @CurrentUser() user: User,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Query('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: RunMemoryCandidateDto,
  ): Promise<{ data: MavisMemory }> {
    const memory = await this.mavisService.createCandidateFromAgentRun(
      user.id,
      projectId,
      runId,
      dto.statement,
    );
    return { data: memory };
  }

  @Post('memories/from-decision/:decisionId')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a candidate memory from a project decision' })
  @ApiResponse({ status: 201, description: 'Candidate memory created with PROPOSED status' })
  async createFromDecision(
    @CurrentUser() user: User,
    @Param('decisionId', ParseUUIDPipe) decisionId: string,
    @Query('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<{ data: MavisMemory }> {
    const memory = await this.mavisService.createCandidateFromDecision(
      user.id,
      projectId,
      decisionId,
    );
    return { data: memory };
  }

  @Post('memories/:id/review')
  @UseGuards(HumanReviewGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Execute human review on a candidate or active memory' })
  @ApiResponse({ status: 200, description: 'Reviewed memory' })
  async reviewMemory(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewMemoryDto,
  ): Promise<{ data: MavisMemory | { superseded: MavisMemory; replacement: MavisMemory } }> {
    if (dto.action === MavisReviewAction.APPROVE) {
      const res = await this.mavisService.approve(user.id, id, dto.expectedVersion);
      return { data: res };
    }
    if (dto.action === MavisReviewAction.REJECT) {
      const res = await this.mavisService.reject(user.id, id, dto.reason, dto.expectedVersion);
      return { data: res };
    }
    if (dto.action === MavisReviewAction.SUPERSEDE) {
      const res = await this.mavisService.supersede(
        user.id,
        id,
        dto.supersedingStatement ?? '',
        dto.expectedVersion,
      );
      return { data: res };
    }
    throw new Error('Unsupported review action');
  }

  @Post('memories/:id/approve')
  @UseGuards(HumanReviewGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a candidate memory' })
  @ApiResponse({ status: 200, description: 'Memory marked APPROVED' })
  async approveMemory(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MemoryVersionDto,
  ): Promise<{ data: MavisMemory }> {
    const memory = await this.mavisService.approve(user.id, id, dto.expectedVersion);
    return { data: memory };
  }

  @Post('memories/:id/reject')
  @UseGuards(HumanReviewGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a candidate memory' })
  @ApiResponse({ status: 200, description: 'Memory marked REJECTED' })
  async rejectMemory(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectMemoryDto,
  ): Promise<{ data: MavisMemory }> {
    const memory = await this.mavisService.reject(user.id, id, dto.reason, dto.expectedVersion);
    return { data: memory };
  }

  @Post('memories/:id/supersede')
  @UseGuards(HumanReviewGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Supersede an approved memory with an updated correction' })
  @ApiResponse({ status: 200, description: 'Superseded old memory and active new replacement' })
  async supersedeMemory(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorrectMemoryDto,
  ): Promise<{ data: { superseded: MavisMemory; replacement: MavisMemory } }> {
    const res = await this.mavisService.supersede(
      user.id,
      id,
      dto.supersedingStatement,
      dto.expectedVersion,
    );
    return { data: res };
  }

  @Delete('memories/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a memory' })
  @ApiResponse({ status: 204, description: 'Memory deleted' })
  async deleteMemory(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('expectedVersion') expectedVersion?: number,
  ): Promise<void> {
    await this.mavisService.delete(user.id, id, expectedVersion);
  }
}
