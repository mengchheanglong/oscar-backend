import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, Matches, MaxLength, Min } from 'class-validator';

export class SaveSkillDto {
  @ApiProperty({ example: 'clear-plan' })
  @Matches(/^[a-z][a-z0-9_-]{0,47}$/)
  slug!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(80) name!: string;
  @ApiProperty() @IsString() @MaxLength(300) description!: string;
  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  instructions!: string;
}
export class UpdateSkillDto extends SaveSkillDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
}
export class SkillResponseDto extends SaveSkillDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() version!: number;
}
export class AttachedSkillDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty() version!: number;
}

export class SkillSummaryDto extends AttachedSkillDto {
  @ApiProperty() description!: string;
}
