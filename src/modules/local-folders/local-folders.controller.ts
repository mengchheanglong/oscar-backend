import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  Post,
  UploadedFile,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { ProjectPolicyGuard } from '../../common/guards/project-policy.guard';
import { User } from '../users/entities/user.entity';
import {
  LocalFolderResponse,
  SyncLocalFolderDto,
  SyncLocalFolderResponse,
} from './local-folder.dto';
import { LocalFoldersService } from './local-folders.service';

@ApiTags('Local folders')
@ApiCookieAuth()
@Controller('projects/:projectId/local-folders')
@UseGuards(SessionAuthGuard, CsrfGuard, ProjectPolicyGuard)
export class LocalFoldersController {
  constructor(private readonly folders: LocalFoldersService) {}
  @Get()
  @ApiOperation({ summary: 'List your private local folder sources' })
  @ApiOkResponse({ type: [LocalFolderResponse] })
  list(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentUser() user: User) {
    return this.folders.list(projectId, user.id);
  }
  @Post('extract')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOperation({ summary: 'Extract selected PDF or DOCX text without storing the original file' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ schema: { type: 'object', properties: { text: { type: 'string' } } } })
  extract(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: User,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.folders.extract(projectId, user.id, file);
  }
  @Put(':id')
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOperation({ summary: 'Atomically index a reviewed local folder manifest' })
  @ApiOkResponse({ type: SyncLocalFolderResponse })
  sync(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: SyncLocalFolderDto,
  ) {
    return this.folders.sync(projectId, user.id, id, dto);
  }
  @Delete(':id')
  @HttpCode(204)
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOperation({ summary: 'Disconnect a private folder and remove its indexed text' })
  @ApiNoContentResponse()
  disconnect(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.folders.disconnect(projectId, user.id, id);
  }
}
