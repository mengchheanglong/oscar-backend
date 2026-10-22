import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class ChiefPreferencesDto {
  @ApiProperty({ enum: ['OFF', 'DAILY', 'WEEKLY'] })
  @IsEnum({ OFF: 'OFF', DAILY: 'DAILY', WEEKLY: 'WEEKLY' })
  cadence!: 'OFF' | 'DAILY' | 'WEEKLY';
  @ApiProperty() @IsInt() @Min(0) @Max(23) hourUtc!: number;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Reporting threshold in USD; does not enforce provider spending.',
  })
  @ValidateIf((_o, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(99999999)
  monthlyBudgetUsd!: number | null;
}
export class ReviewExecutionDto {
  @ApiProperty() @IsUUID() idempotencyKey!: string;
  @ApiProperty({ enum: ['ACCEPTED', 'NEEDS_WORK', 'REJECTED'] })
  @IsEnum({ ACCEPTED: 'ACCEPTED', NEEDS_WORK: 'NEEDS_WORK', REJECTED: 'REJECTED' })
  verdict!: 'ACCEPTED' | 'NEEDS_WORK' | 'REJECTED';
  @ApiProperty({ description: 'What you checked, observed evidence, and remaining gaps.' })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  observation!: string;
  @ApiPropertyOptional({
    description: 'Optional lesson, saved as a proposed MAVIS memory for separate approval.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  lesson?: string;
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'User-reported USD cost. Omit when unknown.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(99999999)
  reportedCostUsd?: number | null;
}
