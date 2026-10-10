import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, IsNull } from 'typeorm';
import { ProjectMember } from '../projects/entities/project-member.entity';
import { ProjectStatus } from '../projects/entities/project.entity';
import {
  KnowledgeChunk,
  KnowledgeSource,
  KnowledgeSourceStatus,
  KnowledgeSourceType,
} from '../ingestion/entities';
import { SemanticChunker } from '../ingestion/chunker/semantic-chunker';
import { PdfExtractor } from '../ingestion/extractors/pdf-extractor';
import { DocxExtractor } from '../ingestion/extractors/docx-extractor';
import { LocalFolder } from './entities/local-folder.entity';
import { LocalFolderResponse, SyncLocalFolderDto } from './local-folder.dto';
import { allowedLocalPath, MAX_LOCAL_FILE_BYTES, MAX_LOCAL_TOTAL_BYTES } from './local-file-policy';

@Injectable()
export class LocalFoldersService {
  constructor(private readonly database: DataSource) {}

  private async access(projectId: string, userId: string, mutation = false): Promise<void> {
    const member = await this.database.getRepository(ProjectMember).findOne({
      where: { projectId, userId, removedAt: IsNull() },
      relations: ['project', 'user'],
    });
    if (!member?.project || !member.user?.isActive)
      throw new NotFoundException('Project not found.');
    if (mutation && member.project.status === ProjectStatus.ARCHIVED)
      throw new BadRequestException('This project is read-only.');
  }

  async extract(
    projectId: string,
    userId: string,
    file?: Express.Multer.File,
  ): Promise<{ text: string }> {
    await this.access(projectId, userId, true);
    if (!file || file.size > 10 * 1024 * 1024)
      throw new BadRequestException('Choose a file up to 10 MiB.');
    const extractor = file.originalname.toLowerCase().endsWith('.pdf')
      ? new PdfExtractor()
      : file.originalname.toLowerCase().endsWith('.docx')
        ? new DocxExtractor()
        : null;
    if (!extractor) throw new BadRequestException('Text extraction supports PDF and DOCX.');
    try {
      const result = await extractor.extract(file.buffer, file.mimetype, file.originalname);
      if (!result.text) throw new Error('Empty document');
      if (Buffer.byteLength(result.text, 'utf8') > MAX_LOCAL_FILE_BYTES)
        throw new Error('Extracted text is too large');
      return { text: result.text };
    } catch {
      throw new BadRequestException(
        'Could not extract text within the 128 KiB limit. The previous index is unchanged.',
      );
    }
  }

  async list(projectId: string, userId: string): Promise<LocalFolderResponse[]> {
    await this.access(projectId, userId);
    const folders = await this.database.getRepository(LocalFolder).find({
      where: { projectId, userId, storageMode: 'SNAPSHOT' },
      order: { syncedAt: 'DESC' },
      take: 20,
    });
    return Promise.all(
      folders.map(async (folder) => {
        const sources = await this.database.getRepository(KnowledgeSource).find({
          where: { projectId, ownerId: userId, localFolderId: folder.id },
          order: { title: 'ASC' },
        });
        return {
          id: folder.id,
          name: folder.name,
          version: folder.version,
          syncedAt: folder.syncedAt,
          files: sources.map((source) => ({
            path: source.title,
            revision: source.sourceRevision,
            hash: source.contentHash,
          })),
        };
      }),
    );
  }

  async sync(
    projectId: string,
    userId: string,
    id: string,
    dto: SyncLocalFolderDto,
  ): Promise<{ id: string; version: number }> {
    await this.access(projectId, userId, true);
    let total = 0;
    const seen = new Set<string>();
    if (!dto.name.trim() || dto.files.length > 100)
      throw new BadRequestException('Invalid folder manifest.');
    for (const file of dto.files) {
      const bytes = Buffer.byteLength(file.text, 'utf8');
      if (
        !allowedLocalPath(file.path) ||
        seen.has(file.path.toLowerCase()) ||
        bytes > MAX_LOCAL_FILE_BYTES ||
        file.text.includes('\0')
      )
        throw new BadRequestException('Unsupported file in folder manifest.');
      seen.add(file.path.toLowerCase());
      total += bytes;
    }
    if (total > MAX_LOCAL_TOTAL_BYTES)
      throw new BadRequestException('Folder exceeds the 512 KiB indexing limit.');
    return this.database.transaction(async (tx) => {
      // Serialize folder mutations and quota checks, including creation of a new ID.
      await tx.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      let folder = await tx.findOne(LocalFolder, {
        where: { id, projectId, userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!folder) {
        if (dto.expectedVersion !== 0 || (await tx.exists(LocalFolder, { where: { id } })))
          throw new NotFoundException('Folder not found.');
        if ((await tx.count(LocalFolder, { where: { projectId, userId } })) >= 20)
          throw new BadRequestException('Connect at most 20 folders per project.');
        folder = tx.create(LocalFolder, {
          id,
          projectId,
          userId,
          name: dto.name.trim(),
          version: 0,
        });
        await tx.save(folder);
      }
      if (folder.version !== dto.expectedVersion)
        throw new ConflictException('Folder changed. Reload sources before scanning again.');
      if (folder.storageMode && folder.storageMode !== 'SNAPSHOT')
        throw new NotFoundException('Folder not found.');
      const existing = await tx.find(KnowledgeSource, {
        where: { projectId, ownerId: userId, localFolderId: id },
      });
      const chunker = new SemanticChunker();
      for (const file of dto.files) {
        const hash = createHash('sha256').update(file.text).digest('hex');
        let source = existing.find((entry) => entry.title === file.path);
        if (source?.contentHash === hash) continue;
        const revision = source ? source.sourceRevision + 1 : 1;
        source ??= tx.create(KnowledgeSource, {
          projectId,
          ownerId: userId,
          localFolderId: id,
          sourceType: KnowledgeSourceType.LOCAL_FILE,
          sourceId: randomUUID(),
          title: file.path,
          deletedAt: null,
        });
        source.contentHash = hash;
        source.sourceRevision = revision;
        source.activeIndexVersion = revision;
        source.status = KnowledgeSourceStatus.INDEXED;
        await tx.save(source);
        await tx.delete(KnowledgeChunk, { knowledgeSourceId: source.id });
        const chunks = chunker.chunk({
          text: file.text,
          sections: [{ title: file.path, content: file.text }],
          metadata: { charCount: file.text.length },
        });
        if (chunks.length)
          await tx.save(
            KnowledgeChunk,
            chunks.map((chunk) =>
              tx.create(KnowledgeChunk, {
                projectId,
                knowledgeSourceId: source!.id,
                indexVersion: revision,
                chunkIndex: chunk.chunkIndex,
                text: chunk.text,
                tokenCount: chunk.tokenCount,
                metadata: {
                  ...chunk.metadata,
                  relativePath: file.path,
                  folderName: dto.name.trim(),
                },
                embedding: null,
                embeddingDimensions: 0,
                embeddingModel: 'keyword-only',
              }),
            ),
          );
      }
      for (const source of existing)
        if (!dto.files.some((file) => file.path === source.title))
          await tx.delete(KnowledgeSource, { id: source.id });
      folder.name = dto.name.trim();
      folder.version += 1;
      folder.syncedAt = new Date();
      await tx.save(folder);
      return { id: folder.id, version: folder.version };
    });
  }

  async disconnect(projectId: string, userId: string, id: string): Promise<void> {
    await this.access(projectId, userId, true);
    await this.database.transaction(async (tx) => {
      await tx.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const result = await tx.delete(LocalFolder, {
        id,
        projectId,
        userId,
        storageMode: 'SNAPSHOT',
      });
      if (!result.affected) throw new NotFoundException('Folder not found.');
    });
  }
}
