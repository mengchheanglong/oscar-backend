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
import { SavedMemoryService } from './saved-memory.service';
import {
  SavedMemoryResponseDto,
  CreateSavedMemoryDto,
  DeleteSavedMemoryDto,
  UpdateSavedMemoryDto,
} from './dto/saved-memory.dto';

@ApiTags('Saved personal memory')
@ApiCookieAuth()
@Controller('projects/:projectId/ai/memories')
@UseGuards(SessionAuthGuard, CsrfGuard, ProjectPolicyGuard)
export class SavedMemoryController {
  constructor(private readonly memory: SavedMemoryService) {}

  @Get()
  @ApiOperation({ summary: 'List the latest 100 private copilot memories in the project' })
  @ApiOkResponse({ type: [SavedMemoryResponseDto] })
  async list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: User,
  ): Promise<SavedMemoryResponseDto[]> {
    return (await this.memory.list(projectId, user.id)).map(SavedMemoryResponseDto.fromEntity);
  }

  @Post()
  @ApiOperation({
    summary: 'Save explicitly reviewed private copilot memory; retries use the same key',
  })
  @ApiCreatedResponse({ type: SavedMemoryResponseDto })
  async create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateSavedMemoryDto,
  ): Promise<SavedMemoryResponseDto> {
    return SavedMemoryResponseDto.fromEntity(await this.memory.create(projectId, user.id, dto));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit reviewed private memory using its current version' })
  @ApiOkResponse({ type: SavedMemoryResponseDto })
  async update(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateSavedMemoryDto,
  ): Promise<SavedMemoryResponseDto> {
    return SavedMemoryResponseDto.fromEntity(await this.memory.update(projectId, user.id, id, dto));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove private copilot memory from saved copilot context' })
  @ApiNoContentResponse()
  async remove(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Query() dto: DeleteSavedMemoryDto,
  ): Promise<void> {
    await this.memory.remove(projectId, user.id, id, dto.version);
  }
}
