import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export enum MavisReviewAction {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  SUPERSEDE = 'SUPERSEDE',
}

export class ReviewMemoryDto {
  @ApiProperty({ enum: MavisReviewAction, description: 'Review action to execute' })
  @IsEnum(MavisReviewAction)
  action!: MavisReviewAction;

  @ApiPropertyOptional({
    description: 'Replacement statement when action is SUPERSEDE',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  supersedingStatement?: string;

  @ApiPropertyOptional({ description: 'Optional explanation or review notes' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  reason?: string;

  @ApiPropertyOptional({ description: 'Expected current version for optimistic concurrency' })
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}

export class MemoryVersionDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}
export class RejectMemoryDto extends MemoryVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  reason?: string;
}
export class CorrectMemoryDto extends MemoryVersionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  supersedingStatement!: string;
}
export class RunMemoryCandidateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  statement?: string;
}
