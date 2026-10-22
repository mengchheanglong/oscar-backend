import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateGoalMetricDto {
  @ApiProperty({ example: 'Paying Customers' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @ApiProperty({ example: 'users' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  unit!: string;

  @ApiProperty({ example: 0, default: 0 })
  @IsNumber()
  @Type(() => Number)
  baselineValue: number = 0;

  @ApiProperty({ example: 2, default: 0 })
  @IsNumber()
  @Type(() => Number)
  currentValue: number = 0;

  @ApiProperty({ example: 10 })
  @IsNumber()
  @Type(() => Number)
  targetValue!: number;

  @ApiPropertyOptional({ example: '2026-10-18' })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'observationDate must be in YYYY-MM-DD format' })
  observationDate?: string;

  @ApiPropertyOptional({ example: 'Observed from Stripe customer subscriptions dashboard' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateGoalMetricDto {
  @ApiPropertyOptional({ example: 'Paying Customers' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ example: 'users' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  unit?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  baselineValue?: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  currentValue?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  targetValue?: number;

  @ApiPropertyOptional({ example: '2026-10-25' })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'observationDate must be in YYYY-MM-DD format' })
  observationDate?: string;

  @ApiPropertyOptional({ example: 'Weekly cohort check' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
