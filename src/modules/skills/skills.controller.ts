import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { ProjectPolicyGuard } from '../../common/guards/project-policy.guard';
import { User } from '../users/entities/user.entity';
import { SkillsService } from './skills.service';
import {
  AttachedSkillDto,
  SaveSkillDto,
  SkillResponseDto,
  SkillSummaryDto,
  UpdateSkillDto,
} from './skills.dto';

@ApiTags('Skills')
@ApiCookieAuth()
@Controller('skills')
@UseGuards(SessionAuthGuard, CsrfGuard)
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}
  @Get()
  @ApiOkResponse({ type: [SkillSummaryDto] })
  list(@CurrentUser() user: User) {
    return this.skills.list(user.id);
  }
  @Get(':id')
  @ApiOkResponse({ type: SkillResponseDto })
  get(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.skills.get(user.id, id);
  }
  @Post()
  @ApiCreatedResponse({ type: SkillResponseDto })
  create(@CurrentUser() user: User, @Body() dto: SaveSkillDto) {
    return this.skills.save(user.id, dto);
  }
  @Patch(':id')
  @ApiOkResponse({ type: SkillResponseDto })
  update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSkillDto,
  ) {
    return this.skills.save(user.id, dto, id);
  }
  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.skills.remove(user.id, id);
  }
}
@ApiTags('Chat skills')
@ApiCookieAuth()
@Controller('projects/:projectId/ai/conversations/:conversationId/skills')
@UseGuards(SessionAuthGuard, CsrfGuard, ProjectPolicyGuard)
export class ConversationSkillsController {
  constructor(private readonly skills: SkillsService) {}
  @Get()
  @ApiOkResponse({ type: [AttachedSkillDto] })
  list(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ) {
    return this.skills.attached(projectId, user.id, conversationId);
  }
  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  remove(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.skills.detach(projectId, user.id, conversationId, id);
  }
}
