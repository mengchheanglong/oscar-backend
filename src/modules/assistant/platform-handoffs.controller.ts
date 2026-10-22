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
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { ProjectPolicyGuard } from '../../common/guards/project-policy.guard';
import { User } from '../users/entities/user.entity';
import { CreatePlatformHandoffDto } from './dto/platform-handoff.dto';
import { PlatformHandoffsService } from './platform-handoffs.service';
import {
  PlatformHandoffResponseDto,
  T3ModelResponseDto,
  PaperclipTargetsResponseDto,
} from './dto/platform-handoff-response.dto';

@ApiTags('Platform handoffs')
@ApiCookieAuth()
@Controller('projects/:projectId/ai/handoffs')
@UseGuards(SessionAuthGuard, CsrfGuard, ProjectPolicyGuard)
export class PlatformHandoffsController {
  constructor(private readonly service: PlatformHandoffsService) {}
  @Get('paperclip-targets')
  @ApiOkResponse({ type: PaperclipTargetsResponseDto })
  paperclipTargets(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('connectionId', ParseUUIDPipe) connectionId: string,
  ) {
    return this.service.paperclipTargets(projectId, user.id, connectionId);
  }
  @Get('models')
  @ApiOkResponse({ type: [T3ModelResponseDto] })
  models(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('connectionId', ParseUUIDPipe) connectionId: string,
  ) {
    return this.service.models(projectId, user.id, connectionId);
  }
  @Get()
  @ApiOkResponse({ type: [PlatformHandoffResponseDto] })
  list(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('conversationId', ParseUUIDPipe) conversationId: string,
  ) {
    return this.service.list(projectId, user.id, conversationId);
  }
  @Post()
  @ApiCreatedResponse({ type: PlatformHandoffResponseDto })
  create(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreatePlatformHandoffDto,
  ) {
    return this.service.create(projectId, user.id, dto);
  }
  @Post(':id/refresh')
  @ApiOkResponse({ type: PlatformHandoffResponseDto })
  refresh(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.refresh(projectId, user.id, id);
  }
  @Post(':id/cancel')
  @ApiOkResponse({ type: PlatformHandoffResponseDto })
  cancel(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.cancel(projectId, user.id, id);
  }
}
