import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export enum SearchEntityType {
  DECISION = 'DECISION',
  TASK = 'TASK',
  DOCUMENT = 'DOCUMENT',
  GITHUB_ISSUE = 'GITHUB_ISSUE',
  GITHUB_PR = 'GITHUB_PR',
  GITHUB_CODE = 'GITHUB_CODE',
  GOAL = 'GOAL',
}

export class SearchQueryDto {
  @ApiProperty({ description: 'Search keyword', example: 'database architecture' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  q!: string;

  @ApiPropertyOptional({
    description: 'Filter by entity type',
    enum: SearchEntityType,
  })
  @IsOptional()
  @IsEnum(SearchEntityType)
  type?: SearchEntityType;

  @ApiPropertyOptional({
    description: 'Search mode: keyword (default), semantic, or hybrid',
    enum: ['keyword', 'semantic', 'hybrid'],
    default: 'keyword',
  })
  @IsOptional()
  @IsEnum(['keyword', 'semantic', 'hybrid'])
  mode?: 'keyword' | 'semantic' | 'hybrid';

  @ApiPropertyOptional({
    description: 'Filter by status (e.g. APPROVED, IN_PROGRESS, TODO, ACCEPTED)',
    example: 'APPROVED',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    description: 'Filter tasks by assignee UUID',
    example: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
  })
  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @ApiPropertyOptional({
    description: 'Start date filter (ISO string)',
    example: '2026-09-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'End date filter (ISO string)',
    example: '2026-09-30T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}

export class SearchResultItemDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d' })
  id!: string;

  @ApiProperty({ enum: SearchEntityType, example: SearchEntityType.DOCUMENT })
  type!: SearchEntityType;

  @ApiPropertyOptional({ example: 'AIW-REQ-1', nullable: true })
  key!: string | null;

  @ApiProperty({ example: 'User Authentication System' })
  title!: string;

  @ApiPropertyOptional({
    example: 'Support session-based authentication with CSRF protection.',
    nullable: true,
  })
  snippet!: string | null;

  @ApiPropertyOptional({ example: 'APPROVED', nullable: true })
  status!: string | null;

  @ApiPropertyOptional({ example: 'HIGH', nullable: true })
  priority!: string | null;

  @ApiProperty({ example: '2026-09-15T12:00:00.000Z' })
  updatedAt!: Date;

  @ApiPropertyOptional({
    example: { assigneeName: 'Alice Developer', dueDate: '2026-09-30' },
    nullable: true,
  })
  metadata!: Record<string, unknown> | null;
}

export class SearchMetaCountsDto {
  @ApiProperty({ example: 2 })
  DECISION!: number;

  @ApiProperty({ example: 4 })
  TASK!: number;

  @ApiProperty({ example: 2 })
  DOCUMENT!: number;

  @ApiPropertyOptional({ example: 0 })
  GITHUB_ISSUE?: number;

  @ApiPropertyOptional({ example: 0 })
  GITHUB_PR?: number;

  @ApiPropertyOptional({ example: 0 })
  GITHUB_CODE?: number;

  @ApiPropertyOptional({ example: 0 })
  GOAL?: number;
}

export class SearchMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  pageSize!: number;

  @ApiProperty({ example: 12 })
  total!: number;

  @ApiProperty({ type: SearchMetaCountsDto })
  countsByType!: SearchMetaCountsDto;
}

export class SearchResponseDto {
  @ApiProperty({ type: [SearchResultItemDto] })
  data!: SearchResultItemDto[];

  @ApiProperty({ type: SearchMetaDto })
  meta!: SearchMetaDto;
}
