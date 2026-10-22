import { Res, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import {
  Body,
  Controller,
  Delete,
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
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { User } from '../users/entities/user.entity';
import { PlatformsService } from './platforms.service';
import {
  CreateConnectionDto,
  CreateExternalLinkDto,
  PlatformActivityOverviewDto,
  QueryConnectionsDto,
  QueryExternalLinksDto,
  UpdateConnectionDto,
} from './dto';
import { PlatformConnection } from './entities/platform-connection.entity';
import { ExternalLink } from './entities/external-link.entity';

@ApiTags('platforms')
@ApiCookieAuth()
@UseGuards(SessionAuthGuard, CsrfGuard)
@Controller('platforms')
export class PlatformsController {
  constructor(private readonly platformsService: PlatformsService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Get OSCAR platform activity overview answering what is happening in Paperclip and T3',
  })
  @ApiResponse({ status: 200, type: PlatformActivityOverviewDto })
  async getOverview(
    @CurrentUser() user: User,
    @Query('projectId') projectId?: string,
  ): Promise<PlatformActivityOverviewDto> {
    return this.platformsService.getPlatformOverview(user.id, projectId);
  }

  @Post('connections')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new external platform connection (Paperclip or T3 Code)' })
  @ApiResponse({ status: 201, type: PlatformConnection })
  async createConnection(
    @CurrentUser() user: User,
    @Body() dto: CreateConnectionDto,
  ): Promise<PlatformConnection> {
    return this.platformsService.createConnection(user.id, dto);
  }

  @Get('connections')
  @ApiOperation({ summary: 'List registered platform connections' })
  @ApiResponse({ status: 200 })
  async listConnections(
    @CurrentUser() user: User,
    @Query() query: QueryConnectionsDto,
  ): Promise<{ items: PlatformConnection[]; total: number }> {
    return this.platformsService.listConnections(user.id, query);
  }

  @Get('connections/:id')
  @ApiOperation({ summary: 'Get a platform connection by ID' })
  @ApiResponse({ status: 200, type: PlatformConnection })
  async getConnection(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PlatformConnection> {
    return this.platformsService.getConnection(user.id, id);
  }

  @Patch('connections/:id')
  @ApiOperation({ summary: 'Update a platform connection' })
  @ApiResponse({ status: 200, type: PlatformConnection })
  async updateConnection(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConnectionDto,
  ): Promise<PlatformConnection> {
    return this.platformsService.updateConnection(user.id, id, dto);
  }

  @Delete('connections/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a platform connection' })
  @ApiResponse({ status: 204 })
  async deleteConnection(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.platformsService.deleteConnection(user.id, id);
  }

  @Post('connections/:id/authorize')
  async authorize(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('origin') origin?: string,
  ) {
    return this.platformsService.authorize(user.id, id, origin);
  }

  @Get('connections/:id/oauth/callback')
  async completeAuthorization(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() response: Response,
  ) {
    if (!code || !state || code.length > 4096 || state.length > 128)
      throw new BadRequestException('Authorization was cancelled or expired.');
    const frontendOrigin = await this.platformsService.completeAuthorization(
      user.id,
      id,
      code,
      state,
    );
    response.redirect(
      `${frontendOrigin || process.env.APP_ORIGIN || 'http://localhost:3002'}/settings?section=integrations&app=t3&connected=1`,
    );
  }

  @Post('connections/:id/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run a live health and capability probe on a platform connection' })
  @ApiResponse({ status: 200, type: PlatformConnection })
  async testConnection(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PlatformConnection> {
    return this.platformsService.testConnection(user.id, id);
  }

  @Get('connections/:id/entities')
  @ApiOperation({ summary: 'Fetch live read-only entities from the connected platform' })
  @ApiResponse({ status: 200 })
  async getEntities(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.platformsService.getEntities(user.id, id) };
  }

  @Post('links')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Map an external platform record to a OSCAR goal or project' })
  @ApiResponse({ status: 201, type: ExternalLink })
  async createExternalLink(
    @CurrentUser() user: User,
    @Body() dto: CreateExternalLinkDto,
  ): Promise<ExternalLink> {
    return this.platformsService.createExternalLink(user.id, dto);
  }

  @Get('links')
  @ApiOperation({ summary: 'List mapped external records' })
  @ApiResponse({ status: 200 })
  async listExternalLinks(
    @CurrentUser() user: User,
    @Query() query: QueryExternalLinksDto,
  ): Promise<{ items: ExternalLink[]; total: number }> {
    return this.platformsService.listExternalLinks(user.id, query);
  }

  @Delete('links/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a mapped external record link' })
  @ApiResponse({ status: 204 })
  async deleteExternalLink(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.platformsService.deleteExternalLink(user.id, id);
  }
}
