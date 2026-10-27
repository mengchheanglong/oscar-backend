import 'multer';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { extname } from 'node:path';
import type { Readable } from 'node:stream';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { Document, ProcessingStatus } from './entities/document.entity';
import { DocumentRevision } from './entities/document-revision.entity';
import { ProjectMember, ProjectRole } from '../projects/entities/project-member.entity';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';
import { STORAGE_DRIVER, type StorageDriver } from '../storage/storage.interface';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../ingestion/outbox.service';

const DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MiB

const ALLOWED_EXTENSIONS: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv',
};

const SORT_COLUMN_MAP: Record<string, string> = {
  createdAt: 'doc.createdAt',
  title: 'doc.title',
  sizeBytes: 'doc.sizeBytes',
  revision: 'doc.revision',
};

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  private readonly maxUploadBytes: number;

  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    @InjectRepository(DocumentRevision)
    private readonly revisionRepository: Repository<DocumentRevision>,
    @InjectRepository(ProjectMember)
    private readonly memberRepository: Repository<ProjectMember>,
    @Inject(STORAGE_DRIVER)
    private readonly storageDriver: StorageDriver,
    private readonly auditService: AuditService,
    private readonly outboxService: OutboxService,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {
    this.maxUploadBytes =
      this.configService.get<number>('MAX_UPLOAD_BYTES') ?? DEFAULT_MAX_UPLOAD_BYTES;
  }

  async validateFile(file?: Express.Multer.File): Promise<{ ext: string; detectedMime: string }> {
    if (!file || (!file.buffer && !file.path)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'A file is required.',
      });
    }

    if (file.size > this.maxUploadBytes) {
      throw new PayloadTooLargeException({
        code: 'PAYLOAD_TOO_LARGE',
        message: `File exceeds maximum allowed size of ${Math.floor(this.maxUploadBytes / (1024 * 1024))} MiB.`,
      });
    }

    if (file.size === 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'File cannot be empty.',
      });
    }

    const ext = extname(file.originalname).toLowerCase();
    const expectedMime = ALLOWED_EXTENSIONS[ext];
    if (!expectedMime) {
      throw new UnsupportedMediaTypeException({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: `Unsupported file extension "${ext}". Allowed types: PDF, DOCX, TXT, Markdown.`,
      });
    }

    // Inspect file header/bytes
    const buffer = file.buffer ?? (await readFile(file.path));

    if (ext === '.pdf') {
      // PDF must begin with %PDF- (0x25, 0x50, 0x44, 0x46, 0x2D)
      if (
        buffer.length < 5 ||
        buffer[0] !== 0x25 ||
        buffer[1] !== 0x50 ||
        buffer[2] !== 0x44 ||
        buffer[3] !== 0x46 ||
        buffer[4] !== 0x2d
      ) {
        throw new UnsupportedMediaTypeException({
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'File content does not match PDF signature (%PDF-).',
        });
      }
    } else if (ext === '.docx' || ext === '.xlsx' || ext === '.pptx') {
      // DOCX, XLSX, PPTX are ZIP archives, must begin with PK\x03\x04 (0x50, 0x4B, 0x03, 0x04)
      if (
        buffer.length < 4 ||
        buffer[0] !== 0x50 ||
        buffer[1] !== 0x4b ||
        buffer[2] !== 0x03 ||
        buffer[3] !== 0x04
      ) {
        throw new UnsupportedMediaTypeException({
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: `File content does not match ${ext.toUpperCase().replace('.', '')} ZIP signature (PK).`,
        });
      }
    } else if (ext === '.png') {
      // PNG header: 0x89 0x50 0x4E 0x47
      if (
        buffer.length < 4 ||
        buffer[0] !== 0x89 ||
        buffer[1] !== 0x50 ||
        buffer[2] !== 0x4e ||
        buffer[3] !== 0x47
      ) {
        throw new UnsupportedMediaTypeException({
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'File content does not match PNG signature.',
        });
      }
    } else if (ext === '.jpg' || ext === '.jpeg') {
      // JPEG header: 0xFF 0xD8 0xFF
      if (buffer.length < 3 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
        throw new UnsupportedMediaTypeException({
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'File content does not match JPEG signature.',
        });
      }
    } else {
      // TXT, Markdown, CSV: must not contain binary null bytes (0x00) and must be valid UTF-8
      if (buffer.includes(0x00)) {
        throw new UnsupportedMediaTypeException({
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'Text file contains binary data (null bytes).',
        });
      }

      try {
        new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      } catch {
        throw new UnsupportedMediaTypeException({
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'Text file contains invalid UTF-8 encoding.',
        });
      }
    }

    return { ext, detectedMime: expectedMime };
  }

  generateStorageKey(projectId: string, documentId: string, revision: number, ext: string): string {
    const nonce = randomBytes(8).toString('hex');
    return `projects/${projectId}/documents/${documentId}-rev${revision}-${nonce}${ext}`;
  }

  async upload(
    projectId: string,
    actorId: string,
    file: Express.Multer.File,
    dto: CreateDocumentDto,
    requestId?: string,
    transaction?: EntityManager,
  ): Promise<Document> {
    const { ext, detectedMime } = await this.validateFile(file);
    const documentId = randomUUID();
    const storageKey = this.generateStorageKey(projectId, documentId, 1, ext);

    const source = file.buffer ?? file.path;
    const meta = await this.storageDriver.save(storageKey, source);

    try {
      const title = dto?.title?.trim() || file.originalname.slice(0, 500);
      const description = dto?.description?.trim() || null;

      const persist = async (manager: EntityManager) => {
        const docRepo = manager.getRepository(Document);
        const revRepo = manager.getRepository(DocumentRevision);

        const doc = docRepo.create({
          id: documentId,
          projectId,
          title,
          description,
          originalFilename: file.originalname,
          storageKey,
          mimeType: detectedMime,
          sizeBytes: meta.sizeBytes,
          sha256: meta.sha256,
          revision: 1,
          processingStatus: ProcessingStatus.PENDING,
          createdBy: actorId,
          updatedBy: actorId,
        });
        const savedDoc = await docRepo.save(doc);

        const initialRevision = revRepo.create({
          documentId,
          revision: 1,
          originalFilename: file.originalname,
          storageKey,
          mimeType: detectedMime,
          sizeBytes: meta.sizeBytes,
          sha256: meta.sha256,
          changedBy: actorId,
        });
        await revRepo.save(initialRevision);

        await this.outboxService.emit(manager, {
          projectId,
          eventType: 'DOCUMENT_CREATED',
          payload: {
            documentId: savedDoc.id,
            revision: 1,
            title: savedDoc.title,
            storageKey: savedDoc.storageKey,
            mimeType: savedDoc.mimeType,
            originalFilename: savedDoc.originalFilename,
          },
          dedupeKey: `document:${savedDoc.id}:1:created`,
        });

        return savedDoc;
      };
      const document = transaction
        ? await persist(transaction)
        : await this.dataSource.transaction(persist);

      // Dispatch outbox events now that the document transaction is committed
      if (!transaction) void this.outboxService.processPending?.();

      await this.auditService.record({
        projectId,
        actorId,
        action: 'DOCUMENT_UPLOADED',
        entityType: 'DOCUMENT',
        entityId: document.id,
        metadata: {
          title: document.title,
          originalFilename: file.originalname,
          sizeBytes: meta.sizeBytes,
          mimeType: detectedMime,
        },
        requestId,
      });

      return document;
    } catch (err) {
      // Compensate on database failure: delete stored file to prevent orphans
      this.logger.warn(`Failed to persist document metadata; removing stored file: ${storageKey}`);
      await this.storageDriver.delete(storageKey);
      throw err;
    } finally {
      if (file.path) {
        try {
          await unlink(file.path);
        } catch {
          // Ignore temp cleanup error
        }
      }
    }
  }

  async list(
    projectId: string,
    query: ListDocumentsQueryDto,
  ): Promise<{ data: Document[]; total: number }> {
    const qb = this.documentRepository.createQueryBuilder('doc');
    if (typeof qb.leftJoinAndSelect === 'function') {
      qb.leftJoinAndSelect('doc.project', 'project');
      qb.leftJoinAndSelect('doc.creator', 'creator');
      qb.leftJoinAndSelect('doc.updater', 'updater');
    }
    qb.where('doc.projectId = :projectId', { projectId });
    qb.andWhere('doc.deletedAt IS NULL');

    if (query.mimeType) {
      qb.andWhere('doc.mimeType = :mimeType', { mimeType: query.mimeType });
    }

    if (query.processingStatus) {
      qb.andWhere('doc.processingStatus = :processingStatus', {
        processingStatus: query.processingStatus,
      });
    }

    if (query.search?.trim()) {
      const term = query.search.trim();
      qb.andWhere(
        "(to_tsvector('english', coalesce(doc.title, '') || ' ' || coalesce(doc.description, '') || ' ' || coalesce(doc.original_filename, '')) @@ plainto_tsquery('english', :search) OR doc.title ILIKE :searchLike OR doc.original_filename ILIKE :searchLike)",
        { search: term, searchLike: `%${term}%` },
      );
    }

    const sortCol = (query.sortBy && SORT_COLUMN_MAP[query.sortBy]) || 'doc.createdAt';
    const sortDir = query.sortOrder === 'ASC' ? 'ASC' : 'DESC';
    qb.orderBy(sortCol, sortDir);
    qb.addOrderBy('doc.id', 'ASC');

    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    qb.skip((page - 1) * pageSize).take(pageSize);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async listAllUserDocuments(
    userId: string,
    query: ListDocumentsQueryDto,
  ): Promise<{ data: Document[]; total: number }> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 100));

    const memberships = await this.memberRepository.find({
      where: { userId },
      select: ['projectId'],
    });

    if (memberships.length === 0) {
      return { data: [], total: 0 };
    }

    const userProjectIds = memberships.map((m) => m.projectId);
    let targetProjectIds = userProjectIds;

    if (query.projectId && query.projectId !== 'ALL') {
      if (!userProjectIds.includes(query.projectId)) {
        return { data: [], total: 0 };
      }
      targetProjectIds = [query.projectId];
    }

    const qb = this.documentRepository.createQueryBuilder('doc');
    qb.leftJoinAndSelect('doc.project', 'project');
    qb.leftJoinAndSelect('doc.creator', 'creator');
    qb.leftJoinAndSelect('doc.updater', 'updater');
    qb.where('doc.projectId IN (:...targetProjectIds)', { targetProjectIds });
    qb.andWhere('doc.deletedAt IS NULL');

    if (query.createdBy && query.createdBy !== 'ALL') {
      qb.andWhere('(doc.createdBy = :createdBy OR creator.displayName ILIKE :createdByName)', {
        createdBy: query.createdBy,
        createdByName: `%${query.createdBy}%`,
      });
    }

    if (query.mimeType) {
      qb.andWhere('doc.mimeType = :mimeType', { mimeType: query.mimeType });
    }

    if (query.fileType && query.fileType !== 'ALL') {
      const ft = query.fileType.toLowerCase();
      if (ft === 'pdf') {
        qb.andWhere('doc.originalFilename ILIKE :ext', { ext: '%.pdf' });
      } else if (ft === 'png' || ft === 'image') {
        qb.andWhere(
          "(doc.originalFilename ILIKE '%.png' OR doc.originalFilename ILIKE '%.jpg' OR doc.originalFilename ILIKE '%.jpeg')",
        );
      } else if (ft === 'docx' || ft === 'word') {
        qb.andWhere("(doc.originalFilename ILIKE '%.docx' OR doc.originalFilename ILIKE '%.doc')");
      } else if (ft === 'xlsx' || ft === 'excel') {
        qb.andWhere(
          "(doc.originalFilename ILIKE '%.xlsx' OR doc.originalFilename ILIKE '%.xls' OR doc.originalFilename ILIKE '%.csv')",
        );
      } else if (ft === 'pptx' || ft === 'presentation') {
        qb.andWhere("(doc.originalFilename ILIKE '%.pptx' OR doc.originalFilename ILIKE '%.ppt')");
      }
    }

    if (query.processingStatus) {
      qb.andWhere('doc.processingStatus = :processingStatus', {
        processingStatus: query.processingStatus,
      });
    }

    if (query.search?.trim()) {
      const term = query.search.trim();
      qb.andWhere('(doc.title ILIKE :searchLike OR doc.originalFilename ILIKE :searchLike)', {
        searchLike: `%${term}%`,
      });
    }

    const sortCol = (query.sortBy && SORT_COLUMN_MAP[query.sortBy]) || 'doc.createdAt';
    const sortDir = query.sortOrder === 'ASC' ? 'ASC' : 'DESC';
    qb.orderBy(sortCol, sortDir);
    qb.addOrderBy('doc.id', 'ASC');

    qb.skip((page - 1) * pageSize).take(pageSize);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async getById(projectId: string, documentId: string): Promise<Document> {
    const doc = await this.documentRepository.findOne({
      where: { id: documentId, projectId, deletedAt: IsNull() },
    });

    if (!doc) {
      throw new NotFoundException({
        code: 'DOCUMENT_NOT_FOUND',
        message: 'Document not found.',
      });
    }

    return doc;
  }

  async update(
    projectId: string,
    documentId: string,
    actorId: string,
    dto: UpdateDocumentDto,
    requestId?: string,
  ): Promise<Document> {
    const doc = await this.getById(projectId, documentId);

    if (doc.version !== dto.version) {
      throw new ConflictException({
        code: 'CONCURRENCY_CONFLICT',
        message: 'Document version conflict. Refresh and retry.',
      });
    }

    if (dto.title !== undefined) {
      if (dto.title.trim().length === 0) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Document title cannot be empty or whitespace.',
        });
      }
      doc.title = dto.title.trim();
    }
    if (dto.description !== undefined) {
      doc.description = dto.description ? dto.description.trim() : null;
    }
    doc.updatedBy = actorId;

    const updated = await this.documentRepository.save(doc);

    await this.outboxService.emit({
      projectId,
      eventType: 'DOCUMENT_UPDATED',
      payload: {
        documentId: updated.id,
        revision: updated.revision,
        title: updated.title,
        storageKey: updated.storageKey,
        mimeType: updated.mimeType,
        originalFilename: updated.originalFilename,
      },
      dedupeKey: `document:${updated.id}:${updated.revision}:${updated.version}:updated`,
    });

    await this.auditService.record({
      projectId,
      actorId,
      action: 'DOCUMENT_UPDATED',
      entityType: 'DOCUMENT',
      entityId: doc.id,
      metadata: {
        title: updated.title,
        version: updated.version,
      },
      requestId,
    });

    return updated;
  }

  async createRevision(
    projectId: string,
    documentId: string,
    actorId: string,
    file: Express.Multer.File,
    requestId?: string,
  ): Promise<Document> {
    const doc = await this.getById(projectId, documentId);
    const { ext, detectedMime } = await this.validateFile(file);

    const nextRevision = doc.revision + 1;
    const newStorageKey = this.generateStorageKey(projectId, doc.id, nextRevision, ext);

    const source = file.buffer ?? file.path;
    const meta = await this.storageDriver.save(newStorageKey, source);

    try {
      const updatedDoc = await this.dataSource.transaction(async (manager) => {
        const docRepo = manager.getRepository(Document);
        const revRepo = manager.getRepository(DocumentRevision);

        const rev = revRepo.create({
          documentId: doc.id,
          revision: nextRevision,
          originalFilename: file.originalname,
          storageKey: newStorageKey,
          mimeType: detectedMime,
          sizeBytes: meta.sizeBytes,
          sha256: meta.sha256,
          changedBy: actorId,
        });
        await revRepo.save(rev);

        doc.originalFilename = file.originalname;
        doc.storageKey = newStorageKey;
        doc.mimeType = detectedMime;
        doc.sizeBytes = meta.sizeBytes;
        doc.sha256 = meta.sha256;
        doc.revision = nextRevision;
        doc.processingStatus = ProcessingStatus.PENDING;
        doc.lastErrorCode = null;
        doc.updatedBy = actorId;

        const savedDoc = await docRepo.save(doc);

        await this.outboxService.emit(manager, {
          projectId,
          eventType: 'DOCUMENT_UPDATED',
          payload: {
            documentId: savedDoc.id,
            revision: nextRevision,
            title: savedDoc.title,
            storageKey: savedDoc.storageKey,
            mimeType: savedDoc.mimeType,
            originalFilename: savedDoc.originalFilename,
          },
          dedupeKey: `document:${savedDoc.id}:${nextRevision}:replaced`,
        });

        return savedDoc;
      });

      // Dispatch outbox events now that the revision replacement is committed
      void this.outboxService.processPending?.();

      await this.auditService.record({
        projectId,
        actorId,
        action: 'DOCUMENT_REPLACED',
        entityType: 'DOCUMENT',
        entityId: doc.id,
        metadata: {
          revision: nextRevision,
          originalFilename: file.originalname,
          sizeBytes: meta.sizeBytes,
          mimeType: detectedMime,
        },
        requestId,
      });

      return updatedDoc;
    } catch (err) {
      this.logger.warn(
        `Failed to persist replacement revision; removing stored file: ${newStorageKey}`,
      );
      await this.storageDriver.delete(newStorageKey);
      throw err;
    } finally {
      if (file.path) {
        try {
          await unlink(file.path);
        } catch {
          // Ignore temp cleanup error
        }
      }
    }
  }

  async getDownloadStream(
    projectId: string,
    documentId: string,
    actorId: string,
    requestId?: string,
  ): Promise<{
    stream: Readable;
    mimeType: string;
    originalFilename: string;
    sizeBytes: number;
  }> {
    const doc = await this.getById(projectId, documentId);

    const stream = await this.storageDriver.getStream(doc.storageKey);

    await this.auditService.record({
      projectId,
      actorId,
      action: 'DOCUMENT_DOWNLOADED',
      entityType: 'DOCUMENT',
      entityId: doc.id,
      metadata: {
        revision: doc.revision,
        originalFilename: doc.originalFilename,
        sizeBytes: doc.sizeBytes,
      },
      requestId,
    });

    return {
      stream,
      mimeType: doc.mimeType,
      originalFilename: doc.originalFilename,
      sizeBytes: doc.sizeBytes,
    };
  }

  async softDelete(
    projectId: string,
    documentId: string,
    actorId: string,
    actorRole: ProjectRole,
    requestId?: string,
  ): Promise<void> {
    const doc = await this.getById(projectId, documentId);

    if (actorRole === ProjectRole.CONTRIBUTOR && doc.createdBy !== actorId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Contributors can only delete documents they created.',
      });
    }

    if (actorRole === ProjectRole.VIEWER) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Viewers cannot delete documents.',
      });
    }

    doc.deletedAt = new Date();
    doc.updatedBy = actorId;
    await this.documentRepository.save(doc);

    await this.outboxService.emit({
      projectId,
      eventType: 'DOCUMENT_DELETED',
      payload: {
        documentId: doc.id,
      },
      dedupeKey: `document:${doc.id}:deleted`,
    });

    await this.auditService.record({
      projectId,
      actorId,
      action: 'DOCUMENT_DELETED',
      entityType: 'DOCUMENT',
      entityId: doc.id,
      metadata: {
        title: doc.title,
        originalFilename: doc.originalFilename,
      },
      requestId,
    });
  }

  async listRevisions(projectId: string, documentId: string): Promise<DocumentRevision[]> {
    await this.getById(projectId, documentId);

    return this.revisionRepository.find({
      where: { documentId },
      order: { revision: 'DESC' },
    });
  }
}
