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
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';
import { WorkspaceInvitationsService } from './workspace-invitations.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { WorkspaceInvitationResponseDto } from './dto/workspace-invitation-response.dto';
import { UserResponseDto } from './dto/user-response.dto';

@ApiTags('Workspace')
@ApiCookieAuth()
@Controller('workspace')
@UseGuards(SessionAuthGuard, CsrfGuard)
export class WorkspaceController {
  constructor(
    private readonly usersService: UsersService,
    private readonly invitationsService: WorkspaceInvitationsService,
  ) {}

  @Get('members')
  @ApiOperation({ summary: 'List yourself and active collaborators sharing a project' })
  @ApiOkResponse({ description: 'List of workspace members' })
  async getMembers(@CurrentUser() actor: User) {
    const { users, total } = await this.usersService.listVisibleMembers(actor.id);

    return {
      data: users.map(UserResponseDto.fromEntity),
      meta: { total },
    };
  }

  @Get('invites')
  @ApiOperation({ summary: 'List your pending workspace invitations' })
  @ApiOkResponse({ description: 'List of pending workspace invitations' })
  async getPendingInvites(@CurrentUser() actor: User) {
    const invites = await this.invitationsService.listPendingInvitations(actor.id);
    return {
      data: invites.map(WorkspaceInvitationResponseDto.fromEntity),
    };
  }

  @Post('invites')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create and send a workspace invitation' })
  @ApiHeader({ name: 'x-csrf-token', description: 'CSRF token', required: true })
  @ApiOkResponse({ description: 'Invitation created' })
  async createInvite(@CurrentUser() actor: User, @Body() dto: CreateInvitationDto) {
    const invite = await this.invitationsService.createInvitation(actor, dto);
    return {
      data: WorkspaceInvitationResponseDto.fromEntity(invite),
    };
  }

  @Delete('invites/:id')
  @ApiOperation({ summary: 'Cancel a pending workspace invitation' })
  @ApiHeader({ name: 'x-csrf-token', description: 'CSRF token', required: true })
  @ApiOkResponse({ description: 'Invitation cancelled' })
  async cancelInvite(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: User) {
    const result = await this.invitationsService.cancelInvitation(id, actor.id);
    return {
      data: result,
    };
  }
}
