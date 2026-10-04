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
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { ProjectPolicyGuard } from '../../common/guards/project-policy.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { User } from '../users/entities/user.entity';
import { CopilotMemoryService } from './copilot-memory.service';
import {
  CopilotMemoryResponseDto,
  CreateCopilotMemoryDto,
  DeleteCopilotMemoryDto,
  UpdateCopilotMemoryDto,
} from './dto/copilot-memory.dto';

@ApiTags('Copilot Memory')
@ApiCookieAuth()
@Controller('projects/:projectId/ai/memories')
@UseGuards(SessionAuthGuard, CsrfGuard, ProjectPolicyGuard)
export class CopilotMemoryController {
  constructor(private readonly memory: CopilotMemoryService) {}

  @Get()
  @ApiOperation({ summary: 'List the latest 100 private copilot memories in the project' })
  @ApiOkResponse({ type: [CopilotMemoryResponseDto] })
  async list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: User,
  ): Promise<CopilotMemoryResponseDto[]> {
    return (await this.memory.list(projectId, user.id)).map(CopilotMemoryResponseDto.fromEntity);
  }

  @Post()
  @ApiOperation({
    summary: 'Save explicitly reviewed private copilot memory; retries use the same key',
  })
  @ApiCreatedResponse({ type: CopilotMemoryResponseDto })
  async create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateCopilotMemoryDto,
  ): Promise<CopilotMemoryResponseDto> {
    return CopilotMemoryResponseDto.fromEntity(await this.memory.create(projectId, user.id, dto));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit reviewed private memory using its current version' })
  @ApiOkResponse({ type: CopilotMemoryResponseDto })
  async update(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateCopilotMemoryDto,
  ): Promise<CopilotMemoryResponseDto> {
    return CopilotMemoryResponseDto.fromEntity(
      await this.memory.update(projectId, user.id, id, dto),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove private copilot memory from saved copilot context' })
  @ApiNoContentResponse()
  async remove(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Query() dto: DeleteCopilotMemoryDto,
  ): Promise<void> {
    await this.memory.remove(projectId, user.id, id, dto.version);
  }
}
