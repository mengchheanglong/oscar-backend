import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
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

export const MAX_FOLDER_FILE_BYTES = 256 * 1024 * 1024;
export const MAX_FOLDER_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_FOLDER_FILES = 5000;
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
  ) {}
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
          .where('f.folder_id = :id', { id: f.id })
          .getRawOne<{ count: string; bytes: string }>();
        return {
          id: f.id,
          name: f.name,
          status: f.status,
          expectedFiles: f.expectedFiles,
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
      expectedFiles > MAX_FOLDER_FILES
    )
      throw new BadRequestException('Choose a folder with 1–5000 files.');
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      await this.access(projectId, userId, true, tx);
      if ((await tx.count(LocalFolder, { where: { projectId, userId } })) >= 20)
        throw new BadRequestException('Keep at most 20 folders per project.');
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
    if (!validUploadedPath(relative) || !file || file.size > MAX_FOLDER_FILE_BYTES)
      throw new BadRequestException('Invalid file path or file exceeds 256 MiB.');
    const id = randomUUID(),
      key = `folder-files/${id}/original`,
      textKey = `folder-files/${id}/text`;
    let committed = false;
    try {
      const saved = await this.storage.save(key, file.path || file.buffer);
      if (saved.sizeBytes > MAX_FOLDER_FILE_BYTES)
        throw new BadRequestException('File exceeds 256 MiB.');
      let text: string | null = null,
        reason: string | null = null;
      if (saved.sizeBytes <= 10 * 1024 * 1024) {
        const buffer = file.path ? await fs.readFile(file.path) : file.buffer;
        try {
          if (relative.toLowerCase().endsWith('.pdf'))
            text = (await new PdfExtractor().extract(buffer, 'application/pdf', relative)).text;
          else if (relative.toLowerCase().endsWith('.docx'))
            text = (await new DocxExtractor().extract(buffer, 'application/octet-stream', relative))
              .text;
          else {
            text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
            if (text.includes('\0')) throw new Error();
          }
          if (Buffer.byteLength(text, 'utf8') > 4 * 1024 * 1024) {
            text = null;
            reason = 'Text exceeds the 4 MiB indexing limit.';
          }
        } catch {
          text = null;
          reason = 'Stored original; content reader unavailable or extraction failed.';
        }
      } else reason = 'Stored original; content extraction is limited to 10 MiB per file.';
      if (text !== null) await this.storage.save(textKey, Buffer.from(text, 'utf8'));
      const result = await this.db.transaction(async (tx) => {
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
          Number(totals?.bytes || 0) + saved.sizeBytes > MAX_FOLDER_BYTES
        )
          throw new BadRequestException('Folder exceeds its file count or 2 GiB storage limit.');
        await tx.save(
          UploadedFile,
          tx.create(UploadedFile, {
            id,
            folderId,
            path: relative,
            pathKey: relative.toLowerCase(),
            storageKey: key,
            textKey: text === null ? null : textKey,
            size: saved.sizeBytes,
            hash: saved.sha256,
            reason,
          }),
        );
        const source = await tx.save(
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
        if (text) {
          const chunks = new SemanticChunker().chunk({
            text,
            sections: [{ title: relative, content: text }],
            metadata: { charCount: text.length },
          });
          await tx.save(
            KnowledgeChunk,
            chunks.map((c) =>
              tx.create(KnowledgeChunk, {
                projectId,
                knowledgeSourceId: source.id,
                indexVersion: 1,
                chunkIndex: c.chunkIndex,
                text: c.text,
                tokenCount: c.tokenCount,
                metadata: { ...c.metadata, relativePath: relative, folderName: folder.name },
                embedding: null,
                embeddingDimensions: 0,
                embeddingModel: 'keyword-only',
              }),
            ),
            { chunk: 100 },
          );
        }
        return { id, path: relative, reason };
      });
      committed = result.id === id;
      return result;
    } finally {
      if (!committed) {
        await this.storage.delete(key);
        await this.storage.delete(textKey);
      }
    }
  }
  async complete(projectId: string, userId: string, id: string) {
    await this.access(projectId, userId, true);
    return this.db.transaction(async (tx) => {
      const folder = await this.folder(projectId, userId, id, tx, true);
      await this.access(projectId, userId, true, tx);
      if ((await tx.count(UploadedFile, { where: { folderId: id } })) !== folder.expectedFiles)
        throw new ConflictException('Some files are missing. Retry the upload before completing.');
      await tx.update(
        KnowledgeSource,
        { projectId, ownerId: userId, localFolderId: id },
        { status: KnowledgeSourceStatus.INDEXED },
      );
      folder.status = 'READY';
      folder.syncedAt = new Date();
      folder.version = 1;
      await tx.save(folder);
      return { id, status: folder.status };
    });
  }
  async files(projectId: string, userId: string, id: string, query = '', offset = 0) {
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
      .take(101)
      .getMany();
    return {
      folderId: id,
      files: files.slice(0, 100).map(({ id, path, size, reason }) => ({ id, path, size, reason })),
      nextOffset: files.length > 100 ? offset + 100 : null,
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
    if (!file.textKey) return { ...metadata, text: null, reason: file.reason };
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
