import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LocalFileDto {
  @ApiProperty() @IsString() @MaxLength(450) path!: string;
  @ApiProperty() @IsString() @MaxLength(131072) text!: string;
}
export class SyncLocalFolderDto {
  @ApiProperty() @IsString() @MaxLength(200) name!: string;
  @ApiProperty() @IsInt() @Min(0) expectedVersion!: number;
  @ApiProperty({ type: [LocalFileDto], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => LocalFileDto)
  files!: LocalFileDto[];
}
export class LocalFolderFileResponse {
  @ApiProperty() path!: string;
  @ApiProperty() revision!: number;
  @ApiProperty() hash!: string | null;
}
export class LocalFolderResponse {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ nullable: true, type: String }) syncedAt!: Date | null;
  @ApiProperty({ type: [LocalFolderFileResponse] }) files!: LocalFolderFileResponse[];
}

export class SyncLocalFolderResponse {
  @ApiProperty() id!: string;
  @ApiProperty() version!: number;
}

export class ConnectLiveFolderDto {
  @ApiProperty({ description: 'Absolute path on the local backend computer' })
  @IsString()
  @MaxLength(1000)
  path!: string;
}
export class LiveFolderResponse {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() path!: string;
}
export class LiveFoldersResponse {
  @ApiProperty() available!: boolean;
  @ApiProperty() nativePickerAvailable!: boolean;
  @ApiProperty({ type: [LiveFolderResponse] }) folders!: LiveFolderResponse[];
}
export class PickLiveFolderResponse {
  @ApiProperty({ type: LiveFolderResponse, nullable: true }) folder!: LiveFolderResponse | null;
}
