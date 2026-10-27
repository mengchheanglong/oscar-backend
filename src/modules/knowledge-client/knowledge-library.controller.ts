import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { IsInt, IsUUID, Min } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { User } from '../users/entities/user.entity';
import { KnowledgeClientService } from './knowledge-client.service';

export class PassageInspectDto {
  @ApiProperty({ format: 'uuid', description: 'Chunk UUID' })
  @IsUUID()
  chunkId!: string;

  @ApiProperty({ format: 'uuid', description: 'Document UUID' })
  @IsUUID()
  documentId!: string;

  @ApiProperty({ minimum: 1, description: 'Expected active revision number' })
  @IsInt()
  @Min(1)
  revision!: number;
}

export class PassageInspectResultDto {
  @ApiProperty({ format: 'uuid' }) chunkId!: string;
  @ApiProperty({ format: 'uuid' }) documentId!: string;
  @ApiProperty() collectionId!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ format: 'uuid' }) bookId?: string;
  @ApiPropertyOptional() author?: string;
  @ApiPropertyOptional() edition?: string;
  @ApiPropertyOptional() chapter?: string;
  @ApiPropertyOptional() locator?: string;
  @ApiPropertyOptional() pageStart?: number;
  @ApiPropertyOptional() pageEnd?: number;
  @ApiPropertyOptional() startMs?: number;
  @ApiPropertyOptional() endMs?: number;
  @ApiProperty() revision!: number;
  @ApiProperty() text!: string;
  @ApiProperty() charCount!: number;
  @ApiPropertyOptional() extraction?: string;
  @ApiProperty() reviewRequired!: boolean;
  @ApiPropertyOptional() coverageNote?: string;
  @ApiPropertyOptional() sourceUrl?: string;
  @ApiProperty() isTruncated!: boolean;
}

class PrivateCollectionStatusDto {
  @ApiProperty({ enum: ['personal-library', 'social-systems'] })
  id!: 'personal-library' | 'social-systems';
  @ApiProperty({ minimum: 0 })
  indexed_books!: number;
}

class KnowledgePolicyDto {
  @ApiProperty() enabled!: boolean;
  @ApiProperty() required!: boolean;
}

@ApiTags('Reference Knowledge')
@ApiCookieAuth()
@UseGuards(SessionAuthGuard)
@Controller('knowledge')
export class KnowledgeLibraryController {
  constructor(private readonly knowledge: KnowledgeClientService) {}
  @Get('collections')
  @ApiOkResponse({ type: [PrivateCollectionStatusDto] })
  collections(@CurrentUser() user: User): Promise<PrivateCollectionStatusDto[]> {
    return this.knowledge.collections(user.id);
  }
  @Get('policy')
  @ApiOkResponse({ type: KnowledgePolicyDto })
  policy(): KnowledgePolicyDto {
    return this.knowledge.policy();
  }

  @Post('passage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Inspect the full permitted indexed passage for a citation' })
  @ApiOkResponse({ type: PassageInspectResultDto })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Access denied to this source' })
  @ApiNotFoundResponse({ description: 'Passage or document not found' })
  @ApiConflictResponse({ description: 'Stale revision' })
  @ApiGoneResponse({ description: 'Passage excluded or removed' })
  inspectPassage(
    @CurrentUser() user: User,
    @Body() dto: PassageInspectDto,
  ): Promise<PassageInspectResultDto> {
    return this.knowledge.inspectPassage(user.id, dto);
  }
}
