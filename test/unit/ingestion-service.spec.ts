import { Repository, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { IngestionService } from '../../src/modules/ingestion/ingestion.service';
import {
  KnowledgeSource,
  KnowledgeChunk,
  ProcessingJob,
  KnowledgeSourceStatus,
  KnowledgeSourceType,
} from '../../src/modules/ingestion/entities';
import { MockEmbeddingProvider } from '../../src/modules/ingestion/embedding/mock-embedding-provider';

import { OutboxService } from '../../src/modules/ingestion/outbox.service';
import { LocalStorageService } from '../../src/modules/storage/local-storage.service';
import { readFile } from 'node:fs/promises';
import { Document, ProcessingStatus } from '../../src/modules/documents/entities/document.entity';

jest.mock('node:fs/promises', () => ({ readFile: jest.fn() }));

describe('IngestionService', () => {
  let service: IngestionService;
  let sourceRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let chunkRepo: {
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    find: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let jobRepo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
  };
  let storageDriver: {
    getAbsolutePath: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };
  let outboxService: {
    setEventHandler: jest.Mock;
    emit: jest.Mock;
  };
  let configService: {
    get: jest.Mock;
  };
  let dataSource: {
    transaction: jest.Mock;
    manager: { update: jest.Mock; findOne: jest.Mock };
  };

  beforeEach(() => {
    jest.mocked(readFile).mockReset().mockResolvedValue(Buffer.from('Workspace requirements.'));
    sourceRepo = {
      findOne: jest.fn(),
      create: jest.fn((dto) => ({ ...dto, id: 'source-uuid-1' })),
      save: jest.fn(async (entity) => ({ ...entity, id: entity.id || 'source-uuid-1' })),
    };

    chunkRepo = {
      create: jest.fn((dto) => ({ ...dto, id: 'chunk-uuid-1' })),
      save: jest.fn(async (chunks) => chunks),
      delete: jest.fn(async () => {}),
      find: jest.fn(async () => []),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };

    jobRepo = {
      create: jest.fn((dto) => ({ ...dto, id: 'job-uuid-1' })),
      save: jest.fn(async (job) => job),
      find: jest.fn(async () => []),
    };

    storageDriver = {
      getAbsolutePath: jest.fn(() => 'test.txt'),
      save: jest.fn(),
      delete: jest.fn(),
    };

    outboxService = {
      setEventHandler: jest.fn(),
      emit: jest.fn(),
    };

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'AI_EMBEDDING_PROVIDER') return 'mock';
        return null;
      }),
    };

    dataSource = {
      manager: {
        update: jest.fn().mockResolvedValue({ affected: 1 }),
        findOne: jest.fn().mockResolvedValue(null),
      },
      transaction: jest.fn(async (cb) => {
        const tx = {
          findOne: jest.fn(async () =>
            sourceRepo.create({
              id: 'source-uuid-1',
              projectId: 'proj-1',
              sourceType: KnowledgeSourceType.REQUIREMENT,
              sourceId: 'req-1',
              sourceRevision: 1,
              title: 'Test Req',
              activeIndexVersion: 0,
              status: KnowledgeSourceStatus.PROCESSING,
            }),
          ),
          create: jest.fn((_, dto) => ({ ...dto, id: 'new-chunk-1' })),
          save: jest.fn(async (_, entity) => entity),
          delete: jest.fn(async () => {}),
        };
        return cb(tx);
      }),
    };

    service = new IngestionService(
      sourceRepo as unknown as Repository<KnowledgeSource>,
      chunkRepo as unknown as Repository<KnowledgeChunk>,
      jobRepo as unknown as Repository<ProcessingJob>,
      storageDriver as unknown as LocalStorageService,
      outboxService as unknown as OutboxService,
      configService as unknown as ConfigService,
      dataSource as unknown as DataSource,
    );

    service.setEmbeddingProvider(new MockEmbeddingProvider(1536));
  });

  it('should initialize and register event handler on onModuleInit', () => {
    service.onModuleInit();
    expect(outboxService.setEventHandler).toHaveBeenCalled();
  });

  describe('document processing status', () => {
    const payload = {
      documentId: 'doc-1',
      revision: 1,
      title: 'SRS',
      storageKey: 'project/doc.txt',
      mimeType: 'text/plain',
      originalFilename: 'srs.txt',
    };

    it('loads the current file for manual reindex jobs before marking completion', async () => {
      dataSource.manager.findOne.mockResolvedValue(payload);
      sourceRepo.findOne.mockResolvedValue(null);
      await service.syncDocument('proj-1', { documentId: 'doc-1', revision: 1, title: 'SRS' });
      expect(dataSource.manager.findOne).toHaveBeenCalledWith(
        Document,
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'doc-1',
            projectId: 'proj-1',
            revision: 1,
            deletedAt: expect.anything(),
          }),
        }),
      );
      expect(dataSource.manager.update).toHaveBeenCalledWith(Document, expect.anything(), {
        processingStatus: ProcessingStatus.COMPLETED,
        lastErrorCode: null,
      });
    });

    it('skips manual reindex work for a deleted or superseded revision', async () => {
      await expect(
        service.syncDocument('proj-1', { documentId: 'doc-1', revision: 1, title: 'SRS' }),
      ).resolves.toBeNull();
      expect(dataSource.manager.update).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('marks the current document completed only after its index is activated', async () => {
      sourceRepo.findOne.mockResolvedValue(null);
      await service.syncDocument('proj-1', payload);
      expect(dataSource.transaction).toHaveBeenCalled();
      expect(dataSource.manager.update).toHaveBeenCalledWith(
        Document,
        expect.objectContaining({
          id: 'doc-1',
          projectId: 'proj-1',
          revision: 1,
          deletedAt: expect.anything(),
        }),
        { processingStatus: ProcessingStatus.COMPLETED, lastErrorCode: null },
      );
    });

    it('does not overwrite a replacement revision when older indexing finishes late', async () => {
      const replacement = { revision: 2, processingStatus: ProcessingStatus.PENDING };
      dataSource.manager.update.mockImplementation(async (_entity, criteria, patch) => {
        if (criteria.revision === replacement.revision) Object.assign(replacement, patch);
        return { affected: criteria.revision === replacement.revision ? 1 : 0 };
      });
      sourceRepo.findOne.mockResolvedValue(null);
      await service.syncDocument('proj-1', payload);
      expect(replacement.processingStatus).toBe(ProcessingStatus.PENDING);
    });

    it('does not mark a skipped older source as completed', async () => {
      sourceRepo.findOne.mockResolvedValue({
        sourceRevision: 3,
        status: KnowledgeSourceStatus.INDEXED,
      });
      await service.syncDocument('proj-1', payload);
      expect(dataSource.manager.update).not.toHaveBeenCalled();
    });

    it('marks read failures and propagates them so the outbox can retry', async () => {
      jest.mocked(readFile).mockRejectedValue(new Error('unreadable file'));
      await expect(service.syncDocument('proj-1', payload)).rejects.toThrow('unreadable file');
      expect(dataSource.manager.update).toHaveBeenCalledWith(
        Document,
        expect.objectContaining({ projectId: 'proj-1', revision: 1 }),
        { processingStatus: ProcessingStatus.FAILED, lastErrorCode: 'DOCUMENT_READ_FAILED' },
      );
    });

    it('marks embedding failures and propagates them so the outbox can retry', async () => {
      sourceRepo.findOne.mockResolvedValue(null);
      const provider = service.getEmbeddingProvider();
      if (!provider) throw new Error('Expected the explicit unit-test provider.');
      jest.spyOn(provider, 'embed').mockRejectedValue(new Error('embedding unavailable'));
      await expect(service.syncDocument('proj-1', payload)).rejects.toThrow(
        'embedding unavailable',
      );
      expect(dataSource.manager.update).toHaveBeenCalledWith(
        Document,
        expect.objectContaining({ projectId: 'proj-1', revision: 1 }),
        { processingStatus: ProcessingStatus.FAILED, lastErrorCode: 'DOCUMENT_INDEXING_FAILED' },
      );
    });

    it.each([
      ['unsupported format', 'image/png', 'srs.png', 'content', 'DOCUMENT_FORMAT_UNSUPPORTED'],
      ['no extractable text', 'text/plain', 'srs.txt', '   ', 'DOCUMENT_TEXT_EMPTY'],
    ])(
      'does not report %s as indexed',
      async (_name, mimeType, originalFilename, content, code) => {
        jest.mocked(readFile).mockResolvedValue(Buffer.from(content));
        await expect(
          service.syncDocument('proj-1', { ...payload, mimeType, originalFilename }),
        ).resolves.toBeNull();
        expect(dataSource.manager.update).toHaveBeenCalledWith(
          Document,
          expect.objectContaining({ projectId: 'proj-1', revision: 1 }),
          { processingStatus: ProcessingStatus.UNSUPPORTED, lastErrorCode: code },
        );
        expect(dataSource.transaction).not.toHaveBeenCalled();
      },
    );
  });

  it('should clean up chunks when a source is deleted', async () => {
    sourceRepo.findOne.mockResolvedValueOnce({
      id: 'source-uuid-1',
      projectId: 'proj-1',
      sourceType: KnowledgeSourceType.TASK,
      sourceId: 'task-1',
    });

    await service.deleteSource('proj-1', KnowledgeSourceType.TASK, 'task-1');

    expect(dataSource.transaction).toHaveBeenCalled();
  });
});
