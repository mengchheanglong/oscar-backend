import { ConfigService } from '@nestjs/config';
import { resumeHash } from './resume-hash';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { ProjectMember, ProjectRole } from '../projects/entities/project-member.entity';
import { ProjectStatus } from '../projects/entities/project.entity';
import { STORAGE_DRIVER, StorageDriver } from '../storage/storage.interface';
import { LocalFolder } from './entities/local-folder.entity';
import { UploadedFile } from './entities/uploaded-file.entity';
import {
  KnowledgeSource,
  KnowledgeSourceType,
  KnowledgeSourceStatus,
  KnowledgeChunk,
} from '../ingestion/entities';
import { SemanticChunker } from '../ingestion/chunker/semantic-chunker';
import { PdfExtractor } from '../ingestion/extractors/pdf-extractor';
import { DocxExtractor } from '../ingestion/extractors/docx-extractor';

export const MAX_FOLDER_FILE_BYTES = 8 * 1024 ** 3;
export const MAX_FOLDER_FILES = 1000000;
export function validUploadedPath(p: string): boolean {
  return Boolean(
    typeof p === 'string' &&
    p &&
    p.length <= 450 &&
    !/[\\:]/.test(p) &&
    !Array.from(p).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) &&
    p.split('/').every((part) => part && part !== '.' && part !== '..'),
  );
}
@Injectable()
export class UploadedFoldersService {
  constructor(
    private readonly db: DataSource,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    private readonly config: ConfigService = new ConfigService(),
  ) {}
  limits() {
    return {
      quotaBytes: Number(this.config.get('FOLDER_STORAGE_QUOTA_BYTES') ?? 20 * 1024 ** 3),
      maxFileBytes: Number(this.config.get('FOLDER_MAX_FILE_BYTES') ?? 1024 ** 3),
      maxFiles: Number(this.config.get('FOLDER_MAX_FILES') ?? 100000),
      maxSources: Number(this.config.get('FOLDER_MAX_SOURCES') ?? 100),
    };
  }
  private async usedBytes(userId: string, db: DataSource | EntityManager = this.db) {
    const result = (await db.query(
      'SELECT COALESCE(SUM(f.size),0) AS bytes FROM uploaded_folder_files f JOIN local_folders l ON l.id=f.folder_id WHERE l.user_id=$1',
      [userId],
    )) as { bytes: string }[];
    return Number(result[0]?.bytes || 0);
  }
  async settings(projectId: string, userId: string) {
    await this.access(projectId, userId);
    return { ...this.limits(), usedBytes: await this.usedBytes(userId) };
  }
  private async access(
    projectId: string,
    userId: string,
    mutation = false,
    db: DataSource | EntityManager = this.db,
  ) {
    const member = await db.getRepository(ProjectMember).findOne({
      where: { projectId, userId, removedAt: IsNull() },
      relations: ['project', 'user'],
    });
    if (!member?.project || !member.user?.isActive)
      throw new NotFoundException('Project not found.');
    if (mutation && member.project.status === ProjectStatus.ARCHIVED)
      throw new BadRequestException('This project is read-only.');
    if (
      mutation &&
      ![ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.CONTRIBUTOR].includes(member.accessRole)
    )
      throw new ForbiddenException('Project write access is required.');
  }
  private async folder(
    projectId: string,
    userId: string,
    id: string,
    db: DataSource | EntityManager = this.db,
    lock = false,
  ) {
    const folder = await db.getRepository(LocalFolder).findOne({
      where: { id, projectId, userId, storageMode: 'UPLOAD' },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!folder) throw new NotFoundException('Uploaded folder not found.');
    return folder;
  }
  async owns(projectId: string, userId: string, id: string): Promise<boolean> {
    await this.access(projectId, userId);
    return this.db
      .getRepository(LocalFolder)
      .exists({ where: { id, projectId, userId, storageMode: 'UPLOAD', status: 'READY' } });
  }
  async list(projectId: string, userId: string) {
    await this.access(projectId, userId);
    const folders = await this.db
      .getRepository(LocalFolder)
      .find({ where: { projectId, userId, storageMode: 'UPLOAD' }, order: { syncedAt: 'DESC' } });
    return Promise.all(
      folders.map(async (f) => {
        const summary = await this.db
          .getRepository(UploadedFile)
          .createQueryBuilder('f')
          .select('COUNT(*)', 'count')
          .addSelect('COALESCE(SUM(f.size),0)', 'bytes')
          .addSelect(
            "COUNT(*) FILTER (WHERE f.extraction_status IN ('PENDING','PROCESSING'))",
            'pending',
          )
          .addSelect("COUNT(*) FILTER (WHERE f.extraction_status = 'FAILED')", 'failed')
          .where('f.folder_id = :id', { id: f.id })
          .getRawOne<{ count: string; bytes: string; pending: string; failed: string }>();
        return {
          id: f.id,
          name: f.name,
          status: f.status,
          expectedFiles: f.expectedFiles,
          pendingFiles: Number(summary?.pending || 0),
          failedFiles: Number(summary?.failed || 0),
          fileCount: Number(summary?.count || 0),
          bytes: Number(summary?.bytes || 0),
          uploadedAt: f.syncedAt,
        };
      }),
    );
  }
  async create(projectId: string, userId: string, name: string, expectedFiles: number) {
    await this.access(projectId, userId, true);
    if (
      !name.trim() ||
      name.length > 200 ||
      !Number.isInteger(expectedFiles) ||
      expectedFiles < 1 ||
      expectedFiles > this.limits().maxFiles
    )
      throw new BadRequestException(`Choose a folder with 1–${this.limits().maxFiles} files.`);
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      await this.access(projectId, userId, true, tx);
      if (
        (await tx.count(LocalFolder, { where: { projectId, userId } })) >= this.limits().maxSources
      )
        throw new BadRequestException(
          `Keep at most ${this.limits().maxSources} folders per project.`,
        );
      const folder = await tx.save(
        LocalFolder,
        tx.create(LocalFolder, {
          id: randomUUID(),
          projectId,
          userId,
          name: name.trim(),
          expectedFiles,
          storageMode: 'UPLOAD',
          status: 'UPLOADING',
          version: 0,
        }),
      );
      return { id: folder.id };
    });
  }
  async put(
    projectId: string,
    userId: string,
    folderId: string,
    relative: string,
    file: Express.Multer.File,
  ) {
    await this.access(projectId, userId, true);
    await this.folder(projectId, userId, folderId);
    if (!validUploadedPath(relative) || !file || file.size > this.limits().maxFileBytes)
      throw new BadRequestException(
        'Invalid file path or file exceeds the configured upload size.',
      );
    const id = randomUUID(),
      key = `folder-files/${id}/original`;
    let committed = false;
    try {
      const saved = await this.storage.save(key, file.path || file.buffer);
      if (saved.sizeBytes > this.limits().maxFileBytes)
        throw new BadRequestException('File exceeds the configured upload size.');
      const fingerprint = await resumeHash(await this.storage.getStream(key));
      const result = await this.db.transaction(async (tx) => {
        await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
        const folder = await this.folder(projectId, userId, folderId, tx, true);
        await this.access(projectId, userId, true, tx);
        const previous = await tx.findOneBy(UploadedFile, {
          folderId,
          pathKey: relative.toLowerCase(),
        });
        if (previous) {
          if (previous.hash !== saved.sha256 || previous.path !== relative)
            throw new ConflictException(
              'This folder already contains a different file at that path.',
            );
          if (!previous.resumeHash)
            await tx.update(UploadedFile, { id: previous.id }, { resumeHash: fingerprint });
          return { id: previous.id, path: previous.path, reason: previous.reason };
        }
        if (folder.status !== 'UPLOADING')
          throw new ConflictException('The upload is already complete.');
        const totals = await tx
          .getRepository(UploadedFile)
          .createQueryBuilder('f')
          .select('COUNT(*)', 'count')
          .addSelect('COALESCE(SUM(f.size),0)', 'bytes')
          .where('f.folder_id = :folderId', { folderId })
          .getRawOne<{ count: string; bytes: string }>();
        if (
          Number(totals?.count || 0) >= (folder.expectedFiles || MAX_FOLDER_FILES) ||
          (await this.usedBytes(userId, tx)) + saved.sizeBytes > this.limits().quotaBytes
        )
          throw new BadRequestException(
            'Upload exceeds its expected file count or your storage quota.',
          );
        await tx.save(
          UploadedFile,
          tx.create(UploadedFile, {
            id,
            folderId,
            path: relative,
            pathKey: relative.toLowerCase(),
            storageKey: key,
            textKey: null,
            resumeHash: fingerprint,
            extractionStatus: 'PENDING',
            size: saved.sizeBytes,
            hash: saved.sha256,
            reason: 'Preparing content. Original is available for download.',
          }),
        );
        await tx.save(
          KnowledgeSource,
          tx.create(KnowledgeSource, {
            projectId,
            ownerId: userId,
            localFolderId: folderId,
            sourceId: id,
            sourceType: KnowledgeSourceType.LOCAL_FILE,
            sourceRevision: 1,
            title: relative,
            contentHash: saved.sha256,
            activeIndexVersion: 1,
            status: KnowledgeSourceStatus.QUEUED,
            deletedAt: null,
          }),
        );
        return {
          id,
          path: relative,
          reason: 'Preparing content. Original is available for download.',
        };
      });
      committed = result.id === id;
      return result;
    } finally {
      if (!committed) {
        await this.storage.delete(key);
      }
    }
  }
  async processNext(): Promise<boolean> {
    const token = randomUUID();
    const claim = await this.db.transaction(async (tx) => {
      const rows =
        (await tx.query(`SELECT f.id, l.project_id AS "projectId", l.user_id AS "userId", l.id AS "folderId", l.name FROM uploaded_folder_files f
        JOIN local_folders l ON l.id=f.folder_id JOIN users u ON u.id=l.user_id
        JOIN projects p ON p.id=l.project_id JOIN project_members m ON m.project_id=l.project_id AND m.user_id=l.user_id
        WHERE l.storage_mode='UPLOAD' AND l.status='READY' AND u.is_active=true AND m.removed_at IS NULL AND p.status='ACTIVE'
          AND m.access_role IN ('OWNER','MANAGER','CONTRIBUTOR')
          AND (f.extraction_status='PENDING' OR (f.extraction_status='PROCESSING' AND f.extraction_lease_until < now()))
        ORDER BY f.id LIMIT 1 FOR UPDATE OF f SKIP LOCKED`)) as {
          id: string;
          projectId: string;
          userId: string;
          folderId: string;
          name: string;
        }[];
      const item = rows[0];
      if (!item) return null;
      await tx.update(
        UploadedFile,
        { id: item.id },
        {
          extractionStatus: 'PROCESSING',
          extractionToken: token,
          extractionLeaseUntil: new Date(Date.now() + 120000),
        },
      );
      await tx.increment(UploadedFile, { id: item.id }, 'extractionAttempts', 1);
      return item;
    });
    if (!claim) return false;
    const key = `folder-files/${claim.id}/text-${token}`;
    let committed = false;
    try {
      const file = await this.db
        .getRepository(UploadedFile)
        .findOneBy({ id: claim.id, extractionToken: token });
      if (!file) return true;
      let text: string | null = null,
        reason: string | null = null;
      if (file.size > 10 * 1024 ** 2)
        reason = 'Stored original; content extraction is limited to 10 MiB per file.';
      else {
        const chunks: Buffer[] = [];
        let bytes = 0;
        const stream = await this.storage.getStream(file.storageKey);
        for await (const chunk of stream) {
          const buffer = Buffer.from(chunk);
          bytes += buffer.length;
          if (bytes > 10 * 1024 ** 2) {
            stream.destroy();
            throw new Error('EXTRACTION_SIZE');
          }
          chunks.push(buffer);
        }
        const buffer = Buffer.concat(chunks);
        try {
          if (file.path.toLowerCase().endsWith('.pdf'))
            text = (await new PdfExtractor().extract(buffer, 'application/pdf', file.path)).text;
          else if (file.path.toLowerCase().endsWith('.docx'))
            text = (
              await new DocxExtractor().extract(buffer, 'application/octet-stream', file.path)
            ).text;
          else {
            text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
            if (text.includes('\0')) throw new Error('BINARY');
          }
          if (Buffer.byteLength(text, 'utf8') > 4 * 1024 ** 2) {
            text = null;
            reason = 'Text exceeds the 4 MiB indexing limit.';
          }
        } catch {
          text = null;
          reason = 'Stored original; content reader unavailable or extraction failed.';
        }
      }
      if (text !== null) await this.storage.save(key, Buffer.from(text, 'utf8'));
      committed = await this.db.transaction(async (tx) => {
        const folder = await this.folder(claim.projectId, claim.userId, claim.folderId, tx, true);
        await this.access(claim.projectId, claim.userId, true, tx);
        const current = await tx.findOne(UploadedFile, {
          where: { id: claim.id, extractionToken: token },
          lock: { mode: 'pessimistic_write' },
        });
        if (!current || folder.status !== 'READY') return false;
        const source = await tx.findOneByOrFail(KnowledgeSource, {
          sourceId: file.id,
          localFolderId: folder.id,
          ownerId: claim.userId,
          projectId: claim.projectId,
        });
        await tx.delete(KnowledgeChunk, { knowledgeSourceId: source.id });
        if (text) {
          const chunks = new SemanticChunker().chunk({
            text,
            sections: [{ title: file.path, content: text }],
            metadata: { charCount: text.length },
          });
          await tx.save(
            KnowledgeChunk,
            chunks.map((c) =>
              tx.create(KnowledgeChunk, {
                projectId: claim.projectId,
                knowledgeSourceId: source.id,
                indexVersion: 1,
                chunkIndex: c.chunkIndex,
                text: c.text,
                tokenCount: c.tokenCount,
                metadata: { ...c.metadata, relativePath: file.path, folderName: folder.name },
                embedding: null,
                embeddingDimensions: 0,
                embeddingModel: 'keyword-only',
              }),
            ),
            { chunk: 100 },
          );
        }
        await tx.update(
          KnowledgeSource,
          { id: source.id },
          { status: KnowledgeSourceStatus.INDEXED },
        );
        await tx.update(
          UploadedFile,
          { id: file.id, extractionToken: token },
          {
            textKey: text === null ? null : key,
            reason,
            extractionStatus: text === null ? 'SKIPPED' : 'DONE',
            extractionToken: null,
            extractionLeaseUntil: null,
          },
        );
        return true;
      });
    } catch {
      const file = await this.db
        .getRepository(UploadedFile)
        .findOneBy({ id: claim.id, extractionToken: token });
      if (file)
        await this.db.getRepository(UploadedFile).update(
          { id: file.id, extractionToken: token },
          {
            extractionStatus: file.extractionAttempts >= 3 ? 'FAILED' : 'PROCESSING',
            extractionLeaseUntil: new Date(Date.now() + 30000),
            reason:
              file.extractionAttempts >= 3
                ? 'Could not prepare content. Original is available for download.'
                : 'Preparing content. Original is available for download.',
          },
        );
    } finally {
      if (!committed) await this.storage.delete(key);
    }
    return true;
  }
  async complete(projectId: string, userId: string, id: string) {
    await this.access(projectId, userId, true);
    return this.db.transaction(async (tx) => {
      const folder = await this.folder(projectId, userId, id, tx, true);
      await this.access(projectId, userId, true, tx);
      if ((await tx.count(UploadedFile, { where: { folderId: id } })) !== folder.expectedFiles)
        throw new ConflictException('Some files are missing. Retry the upload before completing.');
      // Earlier upload sessions already prepared text synchronously. Publish those
      // sources while leaving new background jobs queued until their worker commits.
      await tx.query(
        `UPDATE knowledge_sources s SET status='INDEXED' FROM uploaded_folder_files f
         WHERE f.folder_id=$1 AND s.local_folder_id=$1 AND s.owner_id=$2 AND s.project_id=$3
           AND s.source_id::text=f.id::text AND f.extraction_status IN ('DONE','SKIPPED')`,
        [id, userId, projectId],
      );
      folder.status = 'READY';
      folder.syncedAt = new Date();
      folder.version = 1;
      await tx.save(folder);
      return { id, status: folder.status };
    });
  }
  async files(projectId: string, userId: string, id: string, query = '', offset = 0, limit = 100) {
    await this.access(projectId, userId);
    await this.folder(projectId, userId, id);
    const files = await this.db
      .getRepository(UploadedFile)
      .createQueryBuilder('f')
      .where('f.folder_id = :id', { id })
      .andWhere('f.path_key LIKE :query', {
        query: '%' + query.toLowerCase().replace(/[\\%_]/g, '\\$&') + '%',
      })
      .orderBy('f.path', 'ASC')
      .skip(offset)
      .take(limit + 1)
      .getMany();
    return {
      folderId: id,
      files: files
        .slice(0, limit)
        .map(({ id, path, size, reason, resumeHash, extractionStatus }) => ({
          id,
          path,
          size,
          reason,
          resumeHash,
          extractionStatus,
        })),
      nextOffset: files.length > limit ? offset + limit : null,
    };
  }
  async read(projectId: string, userId: string, id: string, relative: string, offset = 0) {
    await this.access(projectId, userId);
    const folder = await this.folder(projectId, userId, id);
    if (folder.status !== 'READY') throw new BadRequestException('Upload is incomplete.');
    const file = await this.db
      .getRepository(UploadedFile)
      .findOneBy({ folderId: id, path: relative });
    if (!file) throw new NotFoundException('File not found.');
    const metadata = { folderId: id, path: file.path, size: file.size, hash: file.hash };
    if (!file.textKey) {
      if (
        !/\.(pdf|docx)$/i.test(file.path) &&
        (file.size > 10 * 1024 ** 2 || file.reason?.startsWith('Text exceeds'))
      ) {
        const stream = await this.storage.getStream(file.storageKey);
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let seen = 0,
          bytes = 0,
          page = '',
          more = false;
        try {
          for await (const chunk of stream) {
            const buffer = Buffer.from(chunk);
            bytes += buffer.length;
            if (bytes > 64 * 1024 ** 2) throw new Error('READ_BOUND');
            const text = decoder.decode(buffer, { stream: true });
            if (text.includes('\0')) throw new Error('BINARY');
            if (seen + text.length > offset && page.length < 8001)
              page += text.slice(
                Math.max(0, offset - seen),
                Math.max(0, offset - seen) + 8001 - page.length,
              );
            seen += text.length;
            if (page.length > 8000) {
              more = true;
              break;
            }
          }
          if (!more) {
            const tail = decoder.decode();
            if (seen + tail.length > offset) page += tail.slice(Math.max(0, offset - seen));
          }
        } catch {
          return {
            ...metadata,
            text: null,
            reason: 'Stored original; this file cannot be read as bounded UTF-8 text.',
          };
        } finally {
          stream.destroy();
        }
        await this.access(projectId, userId);
        await this.folder(projectId, userId, id);
        return {
          ...metadata,
          text: page.slice(0, 8000),
          offset,
          nextOffset: more ? offset + 8000 : null,
          citation: `stored:${id}:${relative}#${file.hash.slice(0, 12)}:${offset}`,
        };
      }
      return { ...metadata, text: null, reason: file.reason };
    }
    const stream = await this.storage.getStream(file.textKey),
      buffers: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of stream) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > 4 * 1024 * 1024) {
        stream.destroy();
        throw new BadRequestException('Stored text exceeds read limit.');
      }
      buffers.push(buffer);
    }
    await this.access(projectId, userId);
    await this.folder(projectId, userId, id);
    const text = Buffer.concat(buffers).toString('utf8');
    return {
      ...metadata,
      text: text.slice(offset, offset + 8000),
      offset,
      nextOffset: text.length > offset + 8000 ? offset + 8000 : null,
      citation: `stored:${id}:${relative}#${file.hash.slice(0, 12)}:${offset}`,
    };
  }
  async search(projectId: string, userId: string, id: string, query: string, offset = 0) {
    await this.access(projectId, userId);
    const folder = await this.folder(projectId, userId, id);
    if (folder.status !== 'READY') throw new BadRequestException('Upload is incomplete.');
    const matches = await this.db
      .getRepository(KnowledgeChunk)
      .createQueryBuilder('c')
      .innerJoin(KnowledgeSource, 's', 's.id = c.knowledge_source_id')
      .select('s.title', 'path')
      .addSelect('c.text', 'text')
      .where(
        's.project_id = :projectId AND s.owner_id = :userId AND s.local_folder_id = :id AND s.status = :status',
        { projectId, userId, id, status: KnowledgeSourceStatus.INDEXED },
      )
      .andWhere('c.text ILIKE :query', { query: '%' + query.replace(/[\\%_]/g, '\\$&') + '%' })
      .orderBy('s.title')
      .addOrderBy('c.chunk_index')
      .offset(offset)
      .limit(51)
      .getRawMany<{ path: string; text: string }>();
    return {
      folderId: id,
      matches: matches.slice(0, 50).map((m) => ({ path: m.path, text: m.text.slice(0, 3000) })),
      nextOffset: matches.length > 50 ? offset + 50 : null,
    };
  }
  async download(projectId: string, userId: string, id: string, fileId: string) {
    await this.access(projectId, userId);
    await this.folder(projectId, userId, id);
    const file = await this.db.getRepository(UploadedFile).findOneBy({ id: fileId, folderId: id });
    if (!file) throw new NotFoundException('File not found.');
    return {
      stream: await this.storage.getStream(file.storageKey),
      filename: file.path.split('/').pop()!,
      size: file.size,
    };
  }
  async remove(projectId: string, userId: string, id: string) {
    await this.access(projectId, userId, true);
    const files = await this.db.transaction(async (tx) => {
      await this.folder(projectId, userId, id, tx, true);
      await this.access(projectId, userId, true, tx);
      const files = await tx.find(UploadedFile, { where: { folderId: id } });
      await tx.delete(LocalFolder, { id, projectId, userId, storageMode: 'UPLOAD' });
      return files;
    });
    for (const file of files) {
      await this.storage.delete(file.storageKey);
      if (file.textKey) await this.storage.delete(file.textKey);
    }
  }
}
