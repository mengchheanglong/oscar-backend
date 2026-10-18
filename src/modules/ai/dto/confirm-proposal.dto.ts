import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ConfirmProposalDto {
  @ApiProperty({ description: 'Current proposal version for optimistic locking', example: 1 })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({
    description:
      'Array of draft itemIds to confirm. If omitted, all draft items are confirmed. An empty array selects no items.',
    type: [String],
    example: ['draft-item-1', 'draft-item-2'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  selectedItemIds?: string[];
}
