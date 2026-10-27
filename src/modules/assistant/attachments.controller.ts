import 'multer';
import {
  Controller,
  Delete,
  Get,
  Post,
  Param,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Res,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags, ApiConsumes, ApiBody, ApiOperation } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { ProjectPolicyGuard } from '../../common/guards/project-policy.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { AttachmentsService } from './attachments.service';

@ApiTags('Chat attachments')
@ApiCookieAuth()
@Controller('projects/:projectId/ai/conversations/:conversationId/attachments')
@UseGuards(SessionAuthGuard, CsrfGuard, ProjectPolicyGuard)
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}
  @Get()
  @ApiOperation({ summary: 'List private attachments in your chat' })
  list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @CurrentUser() user: User,
  ) {
    return this.attachments.list({ projectId, conversationId, userId: user.id });
  }
  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOperation({ summary: 'Upload a private chat attachment (20 MiB maximum)' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  upload(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @CurrentUser() user: User,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.attachments.upload({ projectId, conversationId, userId: user.id }, file);
  }
  @Get(':id/memories')
  @ApiOperation({ summary: 'List reviewed private memories linked to this attachment' })
  memories(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.attachments.linkedMemories({ projectId, conversationId, userId: user.id }, id);
  }
  @Get(':id/download')
  @ApiOperation({ summary: 'Download an original attachment from your chat' })
  async download(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Res() res: Response,
  ) {
    const file = await this.attachments.download(
      { projectId, conversationId, userId: user.id },
      id,
    );
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename.replace(/[^\w.-]/g, '_')}"`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    file.stream.pipe(res);
  }
  @Delete(':id')
  @ApiOperation({
    summary:
      'Remove attachment access and invalidate prior assistant context; reviewed memories remain separately managed',
  })
  remove(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.attachments.remove({ projectId, conversationId, userId: user.id }, id);
  }
  @Post(':id/project-knowledge')
  @ApiOperation({ summary: 'Explicitly copy a chat attachment into shared project knowledge' })
  promote(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.attachments.promote({ projectId, conversationId, userId: user.id }, id);
  }
  @Post(':id/memory-draft')
  @ApiOperation({
    summary: 'Draft a short memory from file excerpts for review; does not save memory',
  })
  draft(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.attachments.draftMemory({ projectId, conversationId, userId: user.id }, id);
  }
}
