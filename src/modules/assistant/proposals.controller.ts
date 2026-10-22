import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
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
import { ConfirmProposalDto } from './dto/confirm-proposal.dto';
import { ProposalResponseDto, ResultRecordDto } from './dto/proposal-response.dto';
import { UpdateProposalDto } from './dto/update-proposal.dto';
import { ProposalStatus } from './entities/proposal.entity';
import { ProposalsService } from './proposals.service';

@ApiTags('AI Proposals')
@ApiCookieAuth()
@Controller('projects/:projectId/ai')
@UseGuards(SessionAuthGuard, CsrfGuard, ProjectPolicyGuard)
export class ProposalsController {
  constructor(private readonly proposalsService: ProposalsService) {}

  @Post('decisions/:decisionId/task-proposals')
  @ApiOperation({ summary: 'Generate task proposals from an architectural decision' })
  @ApiCreatedResponse({ description: 'Task proposal draft created', type: ProposalResponseDto })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiNotFoundResponse({ description: 'Decision or project not found' })
  async generateDecisionTaskProposal(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('decisionId', ParseUUIDPipe) decisionId: string,
    @CurrentUser() user: User,
  ): Promise<ProposalResponseDto> {
    const proposal = await this.proposalsService.generateDecisionTaskProposal(
      projectId,
      user.id,
      decisionId,
    );
    return ProposalResponseDto.fromEntity(proposal);
  }

  @Get('proposals')
  @ApiOperation({ summary: 'List own proposals in project' })
  @ApiQuery({ name: 'status', enum: ProposalStatus, required: false })
  @ApiOkResponse({ description: 'Proposals returned', type: [ProposalResponseDto] })
  async listProposals(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: User,
    @Query('status') status?: ProposalStatus,
  ): Promise<ProposalResponseDto[]> {
    const proposals = await this.proposalsService.listProposals(projectId, user.id, status);
    return proposals.map((p) => ProposalResponseDto.fromEntity(p));
  }

  @Get('proposals/:id')
  @ApiOperation({ summary: 'Get proposal draft details' })
  @ApiOkResponse({ description: 'Proposal details returned', type: ProposalResponseDto })
  @ApiNotFoundResponse({ description: 'Proposal not found' })
  async getProposal(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<ProposalResponseDto> {
    const proposal = await this.proposalsService.getProposal(projectId, user.id, id);
    return ProposalResponseDto.fromEntity(proposal);
  }

  @Patch('proposals/:id')
  @ApiOperation({ summary: 'Update proposal draft items before confirmation' })
  @ApiOkResponse({ description: 'Proposal updated', type: ProposalResponseDto })
  @ApiNotFoundResponse({ description: 'Proposal not found' })
  async updateProposal(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateProposalDto,
  ): Promise<ProposalResponseDto> {
    const proposal = await this.proposalsService.updateProposal(projectId, user.id, id, dto);
    return ProposalResponseDto.fromEntity(proposal);
  }

  @Post('proposals/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject proposal without creating domain records' })
  @ApiOkResponse({ description: 'Proposal rejected', type: ProposalResponseDto })
  @ApiNotFoundResponse({ description: 'Proposal not found' })
  async rejectProposal(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<ProposalResponseDto> {
    const proposal = await this.proposalsService.rejectProposal(projectId, user.id, id);
    return ProposalResponseDto.fromEntity(proposal);
  }

  @Post('proposals/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @RequireProjectRole(ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.CONTRIBUTOR)
  @ApiHeader({
    name: 'Idempotency-Key',
    description: 'Unique client operation key preventing duplicate confirmation',
    required: true,
  })
  @ApiOperation({ summary: 'Confirm proposal and transactionally create domain records' })
  @ApiOkResponse({
    description: 'Proposal confirmed and domain records created',
    schema: {
      properties: {
        proposal: { $ref: '#/components/schemas/ProposalResponseDto' },
        resultRecordIds: {
          type: 'array',
          items: { $ref: '#/components/schemas/ResultRecordDto' },
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Proposal not found' })
  async confirmProposal(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: ConfirmProposalDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ): Promise<{ proposal: ProposalResponseDto; resultRecordIds: ResultRecordDto[] }> {
    const { proposal, resultRecordIds } = await this.proposalsService.confirmProposal(
      projectId,
      user,
      id,
      dto,
      idempotencyKey,
    );

    return {
      proposal: ProposalResponseDto.fromEntity(proposal),
      resultRecordIds,
    };
  }
}
