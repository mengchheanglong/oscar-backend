import { ApiProperty } from '@nestjs/swagger';
export class UploadedFolderIdResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
}
export class UploadedFolderResponse extends UploadedFolderIdResponse {
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['UPLOADING', 'READY'] }) status!: string;
  @ApiProperty() pendingFiles!: number;
  @ApiProperty() failedFiles!: number;
  @ApiProperty() expectedFiles!: number;
  @ApiProperty() fileCount!: number;
  @ApiProperty() bytes!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) uploadedAt!: string | null;
}
export class StoredFileResponse extends UploadedFolderIdResponse {
  @ApiProperty({ type: String, nullable: true }) resumeHash!: string | null;
  @ApiProperty({ enum: ['PENDING', 'PROCESSING', 'DONE', 'SKIPPED', 'FAILED'] })
  extractionStatus!: string;
  @ApiProperty() path!: string;
  @ApiProperty() size!: number;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
}
export class UploadedFileResultResponse extends UploadedFolderIdResponse {
  @ApiProperty() path!: string;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
}
export class UploadedFilesResponse {
  @ApiProperty({ format: 'uuid' }) folderId!: string;
  @ApiProperty({ type: [StoredFileResponse] }) files!: StoredFileResponse[];
  @ApiProperty({ type: Number, nullable: true }) nextOffset!: number | null;
}
export class UploadedCompleteResponse extends UploadedFolderIdResponse {
  @ApiProperty({ enum: ['READY'] }) status!: string;
}
export class UploadedReadResponse {
  @ApiProperty({ format: 'uuid' }) folderId!: string;
  @ApiProperty() path!: string;
  @ApiProperty() size!: number;
  @ApiProperty() hash!: string;
  @ApiProperty({ type: String, nullable: true }) text!: string | null;
  @ApiProperty({ type: String, required: false, nullable: true }) reason?: string | null;
  @ApiProperty({ required: false }) offset?: number;
  @ApiProperty({ type: Number, required: false, nullable: true }) nextOffset?: number | null;
  @ApiProperty({ required: false }) citation?: string;
}

export class UploadedFolderSettingsResponse {
  @ApiProperty() quotaBytes!: number;
  @ApiProperty() usedBytes!: number;
  @ApiProperty() maxFileBytes!: number;
  @ApiProperty() maxFiles!: number;
  @ApiProperty() maxSources!: number;
}
