import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsObject, Min } from 'class-validator';

export class UpdateProposalDto {
  @ApiProperty({ description: 'Current proposal version for optimistic locking', example: 1 })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({ description: 'Updated draft JSON payload' })
  @IsObject()
  @IsNotEmpty()
  draftJson!: Record<string, unknown>;
}
