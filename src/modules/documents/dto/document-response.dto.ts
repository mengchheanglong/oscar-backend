import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Document, ProcessingStatus } from '../entities/document.entity';

export class DocumentResponseDto {
  @ApiProperty({ example: 'f87a8f89-8d7b-4029-9fa9-6f9ec67bc9e3' })
  id!: string;

  @ApiProperty({ example: 'f87a8f89-8d7b-4029-9fa9-6f9ec67bc9e3' })
  projectId!: string;

  @ApiProperty({ example: 'Architecture Overview' })
  title!: string;

  @ApiPropertyOptional({ example: 'Initial architectural specification document', nullable: true })
  description!: string | null;

  @ApiProperty({ example: 'architecture.pdf' })
  originalFilename!: string;

  @ApiProperty({ example: 'application/pdf' })
  mimeType!: string;

  @ApiProperty({ example: 1048576 })
  sizeBytes!: number;

  @ApiProperty({ example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' })
  sha256!: string;

  @ApiProperty({ example: 1 })
  revision!: number;

  @ApiProperty({ enum: ProcessingStatus, example: ProcessingStatus.PENDING })
  processingStatus!: ProcessingStatus;

  @ApiPropertyOptional({ example: null, nullable: true })
  lastErrorCode!: string | null;

  @ApiProperty()
  createdBy!: string;

  @ApiProperty()
  updatedBy!: string;

  @ApiProperty({ example: 1 })
  version!: number;

  @ApiPropertyOptional({
    example: { id: 'uuid', name: 'Continuum', key: 'AIW' },
  })
  project?: {
    id: string;
    name: string;
    key: string;
  };

  @ApiPropertyOptional({
    example: { id: 'uuid', displayName: 'Panhavorn', email: 'panhavorn@example.com' },
  })
  creator?: {
    id: string;
    displayName: string;
    email: string;
  };

  @ApiPropertyOptional({
    example: { id: 'uuid', displayName: 'Meng Fong', email: 'mengfong@example.com' },
  })
  updater?: {
    id: string;
    displayName: string;
    email: string;
  };

  @ApiProperty({ example: '2026-09-11T10:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-09-11T10:00:00.000Z' })
  updatedAt!: string;

  static fromEntity(doc: Document): DocumentResponseDto {
    return {
      id: doc.id,
      projectId: doc.projectId,
      title: doc.title,
      description: doc.description,
      originalFilename: doc.originalFilename,
      mimeType: doc.mimeType,
      sizeBytes: Number(doc.sizeBytes),
      sha256: doc.sha256,
      revision: doc.revision,
      processingStatus: doc.processingStatus,
      lastErrorCode: doc.lastErrorCode,
      createdBy: doc.createdBy,
      updatedBy: doc.updatedBy,
      version: doc.version,
      project: doc.project
        ? {
            id: doc.project.id,
            name: doc.project.name,
            key: doc.project.key,
          }
        : undefined,
      creator: doc.creator
        ? {
            id: doc.creator.id,
            displayName: doc.creator.displayName,
            email: doc.creator.email,
          }
        : undefined,
      updater: doc.updater
        ? {
            id: doc.updater.id,
            displayName: doc.updater.displayName,
            email: doc.updater.email,
          }
        : undefined,
      createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
      updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt,
    };
  }
}
