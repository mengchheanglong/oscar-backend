import {
  UploadedFolderResponse,
  UploadedFolderIdResponse,
  UploadedFileResultResponse,
  UploadedFilesResponse,
  UploadedCompleteResponse,
  UploadedReadResponse,
  UploadedFolderSettingsResponse,
} from './uploaded-folder.responses';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiProperty,
  ApiCreatedResponse,
  ApiNoContentResponse,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdirSync, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { finalize } from 'rxjs';
import { Type } from 'class-transformer';
import { IsInt, IsString, Max, MaxLength, Min, IsOptional, MinLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { ProjectPolicyGuard } from '../../common/guards/project-policy.guard';
import { User } from '../users/entities/user.entity';
import { MAX_FOLDER_FILE_BYTES, UploadedFoldersService } from './uploaded-folders.service';

export class CreateUploadedFolderDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @ApiProperty({ minimum: 1, maximum: 1000000 })
  @IsInt()
  @Min(1)
  @Max(1000000)
  expectedFiles!: number;
}
export class UploadedFilesQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) limit?: number;
  @IsOptional() @IsString() @MaxLength(450) query?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000000) offset?: number;
}
export class UploadedReadQuery {
  @IsString() @MinLength(1) @MaxLength(450) path!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000000) offset?: number;
}
@Injectable()
export class UploadTempCleanup implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const file = context.switchToHttp().getRequest<{ file?: Express.Multer.File }>().file;
    return next.handle().pipe(
      finalize(() => {
        if (file?.path) void fs.unlink(file.path).catch(() => {});
      }),
    );
  }
}
@ApiTags('Uploaded folders')
@ApiCookieAuth()
@ApiHeader({ name: 'x-csrf-token', required: false })
@Controller('projects/:projectId/uploaded-folders')
@UseGuards(SessionAuthGuard, CsrfGuard, ProjectPolicyGuard)
export class UploadedFoldersController {
  constructor(private readonly folders: UploadedFoldersService) {}
  @Get('settings')
  @ApiOperation({ summary: 'Get upload policy and your account-wide original storage usage' })
  @ApiOkResponse({ type: UploadedFolderSettingsResponse })
  settings(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentUser() user: User) {
    return this.folders.settings(projectId, user.id);
  }
  @Get()
  @ApiOperation({ summary: 'List your private persistent folder uploads' })
  @ApiOkResponse({ type: [UploadedFolderResponse] })
  list(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentUser() user: User) {
    return this.folders.list(projectId, user.id);
  }
  @Post()
  @ApiOperation({ summary: 'Start a private folder upload session' })
  @ApiCreatedResponse({ type: UploadedFolderIdResponse })
  create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateUploadedFolderDto,
  ) {
    return this.folders.create(projectId, user.id, dto.name, dto.expectedFiles);
  }
  @Put(':id/files')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, callback) => {
          const dir = join(tmpdir(), 'aiw-folder-uploads');
          mkdirSync(dir, { recursive: true });
          callback(null, dir);
        },
        filename: (_req, _file, callback) => callback(null, randomUUID()),
      }),
      limits: { fileSize: MAX_FOLDER_FILE_BYTES, files: 1, fields: 1, fieldSize: 1800, parts: 3 },
    }),
    UploadTempCleanup,
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['path', 'file'],
      properties: {
        path: { type: 'string', maxLength: 450 },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({ summary: 'Store one original file; identical retries are idempotent' })
  @ApiOkResponse({ type: UploadedFileResultResponse })
  put(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('path') path: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.folders.put(projectId, user.id, id, path, file);
  }
  @Post(':id/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Publish a complete uploaded folder to private retrieval' })
  @ApiOkResponse({ type: UploadedCompleteResponse })
  complete(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.folders.complete(projectId, user.id, id);
  }
  @Get(':id/files')
  @ApiOperation({ summary: 'List original file metadata, 100 per page' })
  @ApiOkResponse({ type: UploadedFilesResponse })
  files(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: UploadedFilesQuery,
  ) {
    return this.folders.files(projectId, user.id, id, query.query, query.offset, query.limit);
  }
  @Get(':id/read')
  @ApiOperation({ summary: 'Read an extracted text page with its file version citation' })
  @ApiOkResponse({ type: UploadedReadResponse })
  read(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: UploadedReadQuery,
  ) {
    return this.folders.read(projectId, user.id, id, query.path, query.offset);
  }
  @Get(':id/files/:fileId/download')
  @ApiOperation({ summary: 'Download a private original file as an attachment' })
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async download(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ) {
    const file = await this.folders.download(projectId, user.id, id, fileId);
    return new StreamableFile(file.stream, {
      type: 'application/octet-stream',
      length: file.size,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    });
  }
  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete your stored folder copy and its private index' })
  @ApiNoContentResponse()
  remove(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.folders.remove(projectId, user.id, id);
  }
}
