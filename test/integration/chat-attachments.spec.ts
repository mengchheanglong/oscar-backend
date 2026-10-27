import { MavisService } from '../../src/modules/mavis/mavis.service';
import { MavisMemory } from '../../src/modules/mavis/entities/mavis-memory.entity';
import { Goal } from '../../src/modules/goals/entities/goal.entity';
import { Decision } from '../../src/modules/decisions/entities/decision.entity';
import { AgentRun } from '../../src/modules/assistant/entities/agent-run.entity';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Document } from '../../src/modules/documents/entities/document.entity';
import { DocumentRevision } from '../../src/modules/documents/entities/document-revision.entity';
import { AuditService } from '../../src/modules/audit/audit.service';
import { OutboxService } from '../../src/modules/ingestion/outbox.service';
import { databaseOptions } from '../../src/database/database-options';
import { AttachmentsService } from '../../src/modules/assistant/attachments.service';
import { DocumentsService } from '../../src/modules/documents/documents.service';
import { User } from '../../src/modules/users/entities/user.entity';
import { Project } from '../../src/modules/projects/entities/project.entity';
import {
  ProjectMember,
  ProjectRole,
} from '../../src/modules/projects/entities/project-member.entity';
import { AssistantMode } from '../../src/modules/assistant/entities/assistant-mode.enum';
import { Conversation } from '../../src/modules/assistant/entities/conversation.entity';
import { StorageDriver } from '../../src/modules/storage/storage.interface';
import { LlmProvider } from '../../src/modules/assistant/llm/llm-provider.interface';
import { ConversationHistoryRepository } from '../../src/modules/assistant/context/conversation-history.repository';
import { RetrievalService } from '../../src/modules/mavis/retrieval/retrieval.service';
import {
  ChatMessage,
  MessageRole,
  MessageStatus,
} from '../../src/modules/assistant/entities/chat-message.entity';
import { SavedMemoryService } from '../../src/modules/assistant/saved-memory.service';
import {
  SavedMemory,
  SavedMemoryKind,
} from '../../src/modules/assistant/entities/saved-memory.entity';

describe('Private chat attachment lifecycle (PostgreSQL)', () => {
  let db: DataSource,
    service: AttachmentsService,
    owner: User,
    other: User,
    project: Project,
    chat: Conversation,
    second: Conversation,
    attachmentId: string;
  const bytes = new Map<string, Buffer>();
  const storage: StorageDriver = {
    save: async (k, b) => {
      if (typeof b === 'string') throw Error('buffer required');
      bytes.set(k, b);
      return { sizeBytes: b.length, sha256: 'a'.repeat(64) };
    },
    getStream: async (k) => Readable.from(bytes.get(k)!),
    delete: async (k) => {
      bytes.delete(k);
    },
    exists: async (k) => bytes.has(k),
    getAbsolutePath: (k) => k,
  };
  const llm = {
    generateStructuredOutput: jest.fn(async () => ({
      data: { content: 'The pilot has 12 shops.' },
    })),
  } as unknown as LlmProvider;
  const scope = () => ({ projectId: project.id, userId: owner.id, conversationId: chat.id });
  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (
      process.env.NODE_ENV !== 'test' ||
      !url ||
      !['127.0.0.1', 'localhost'].includes(new URL(url).hostname) ||
      !new URL(url).pathname.endsWith('_test') ||
      new URL(url).port !== '43105'
    )
      throw Error('Dedicated local test database required.');
    db = await new DataSource(databaseOptions(url)).initialize();
    await db.runMigrations({ transaction: 'all' });
    [owner, other] = (await db.getRepository(User).save(
      ['owner', 'other'].map((displayName) => ({
        displayName,
        email: randomUUID() + '@attachment.test',
        passwordHash: 'synthetic',
      })),
    )) as [User, User];
    project = await db.getRepository(Project).save({
      key: 'A' + randomUUID().slice(0, 7).toUpperCase(),
      name: 'Attachment QA',
      createdBy: owner.id,
    });
    await db.getRepository(ProjectMember).save([
      { projectId: project.id, userId: owner.id, accessRole: ProjectRole.OWNER },
      { projectId: project.id, userId: other.id, accessRole: ProjectRole.CONTRIBUTOR },
    ]);
    [chat, second] = (await db.getRepository(Conversation).save([
      { projectId: project.id, userId: owner.id, title: 'Attachment QA' },
      { projectId: project.id, userId: owner.id, title: 'Other chat' },
    ])) as [Conversation, Conversation];
    service = new AttachmentsService(
      db,
      new DocumentsService(
        db.getRepository(Document),
        db.getRepository(DocumentRevision),
        db.getRepository(ProjectMember),
        storage,
        { record: async () => {} } as unknown as AuditService,
        { emit: async () => {} } as unknown as OutboxService,
        db,
        new ConfigService(),
      ),
      storage,
      llm,
    );
  });
  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query('DELETE FROM copilot_memories WHERE project_id=$1', [project?.id]);
      await db.query('DELETE FROM ai_conversations WHERE project_id=$1', [project?.id]);
      await db.query('DELETE FROM projects WHERE id=$1', [project?.id]);
      await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[owner?.id, other?.id]]);
      await db.destroy();
    }
  });
  it('keeps uploads out of shared documents and retrieval while available to their chat and handoff', async () => {
    const buffer = Buffer.from('Pilot cobalt has 12 shops. Launch budget is 400 dollars.');
    const a = await service.upload(scope(), {
      buffer,
      size: buffer.length,
      originalname: 'pilot.txt',
    } as Express.Multer.File);
    attachmentId = a.id;
    expect(await service.list(scope())).toHaveLength(1);
    expect(await service.list({ ...scope(), conversationId: second.id })).toHaveLength(0);
    expect(
      await service.evidence({ ...scope(), conversationId: second.id }, 'pilot cobalt'),
    ).toHaveLength(0);
    expect((await service.evidence(scope(), 'pilot cobalt'))[0]?.text).toContain('12 shops');
    expect(await service.handoff(scope(), 'pilot')).toContain('untrusted');
    expect(await db.query('SELECT id FROM documents WHERE id=$1', [a.id])).toHaveLength(0);
    expect(
      await new RetrievalService(db).retrieve({
        projectId: project.id,
        actorId: owner.id,
        query: 'pilot cobalt',
        mode: 'keyword',
      }),
    ).toHaveLength(0);
    expect(await service.draftMemory(scope(), a.id)).toMatchObject({
      content: 'The pilot has 12 shops.',
      sourceAttachmentId: a.id,
    });
    expect(
      await db.query('SELECT id FROM copilot_memories WHERE source_attachment_id=$1', [a.id]),
    ).toHaveLength(0);
  });
  it('shares only through an explicit, repeatable promotion and rejects unreadable uploads', async () => {
    const before = await db.query('SELECT id FROM documents WHERE project_id=$1', [project.id]);
    expect(before).toHaveLength(0);
    const result = await service.promote(scope(), attachmentId);
    expect(await service.promote(scope(), attachmentId)).toEqual(result);
    expect(
      await db.query('SELECT id FROM documents WHERE project_id=$1', [project.id]),
    ).toHaveLength(1);
    await expect(
      service.upload(scope(), {
        buffer: Buffer.from(''),
        size: 0,
        originalname: 'empty.txt',
      } as Express.Multer.File),
    ).rejects.toThrow();
    expect(await service.list(scope())).toHaveLength(1);
  });
  it('retrieves matching passages deep in files and rejects limits without orphaning storage', async () => {
    const buffer = Buffer.from(
      'Background notes and ordinary planning. '.repeat(3000) +
        ' Zephyrquartz launch authorization is violet.',
    );
    const local = { ...scope(), conversationId: second.id };
    const file = await service.upload(local, {
      buffer,
      size: buffer.length,
      originalname: 'long.txt',
    } as Express.Multer.File);
    expect(
      (await service.evidence(local, 'Zephyrquartz')).some((e) => e.text?.includes('violet')),
    ).toBe(true);
    await service.remove(local, file.id);
    const before = bytes.size;
    await db.query(
      `INSERT INTO chat_attachments(id,project_id,user_id,conversation_id,filename,mime_type,storage_key,size_bytes,chunks)
      SELECT gen_random_uuid(),$1,$2,$3,'limit.txt','text/plain','synthetic',1,'[]'::jsonb FROM generate_series(1,20)`,
      [project.id, owner.id, second.id],
    );
    await expect(
      service.upload(local, {
        buffer: Buffer.from('more notes'),
        size: 10,
        originalname: 'extra.txt',
      } as Express.Multer.File),
    ).rejects.toThrow('20 files');
    expect(bytes.size).toBe(before);
    await db.query(
      "DELETE FROM chat_attachments WHERE conversation_id=$1 AND storage_key='synthetic'",
      [second.id],
    );
  });
  it('refuses removal during an in-flight chat turn', async () => {
    const runner = db.createQueryRunner();
    await runner.connect();
    try {
      await runner.query('SELECT pg_advisory_lock(hashtextextended($1,83))', [chat.id]);
      await expect(service.remove(scope(), attachmentId)).rejects.toThrow('current answer');
      expect(await service.list(scope())).toHaveLength(1);
    } finally {
      await runner.query('SELECT pg_advisory_unlock(hashtextextended($1,83))', [chat.id]);
      await runner.release();
    }
  });
  it('rejects other accounts, wrong chats/projects, removed membership, and deleted chats', async () => {
    for (const s of [
      { ...scope(), userId: other.id },
      { ...scope(), conversationId: second.id },
      { ...scope(), projectId: randomUUID() },
    ]) {
      await expect(service.download(s, attachmentId)).rejects.toThrow('not found');
      await expect(service.promote(s, attachmentId)).rejects.toThrow('not found');
      await expect(service.remove(s, attachmentId)).rejects.toThrow('not found');
    }
    await db.query(
      'UPDATE project_members SET removed_at=now() WHERE project_id=$1 AND user_id=$2',
      [project.id, owner.id],
    );
    await expect(service.list(scope())).rejects.toThrow('not found');
    await db.query(
      'UPDATE project_members SET removed_at=NULL WHERE project_id=$1 AND user_id=$2',
      [project.id, owner.id],
    );
    await db.query('UPDATE ai_conversations SET deleted_at=now() WHERE id=$1', [chat.id]);
    await expect(service.list(scope())).rejects.toThrow('not found');
    await db.query('UPDATE ai_conversations SET deleted_at=NULL WHERE id=$1', [chat.id]);
  });
  it('does not recall attachment-derived dialogue across chats and preserves reviewed memory provenance', async () => {
    const message = await db.getRepository(ChatMessage).save({
      conversationId: chat.id,
      role: MessageRole.ASSISTANT,
      mode: AssistantMode.WORKSPACE,
      status: MessageStatus.COMPLETED,
      content: 'Pilot cobalt has 12 shops.',
      citations: [],
    });
    const history = new ConversationHistoryRepository(db);
    expect(
      await history.lexical({ ...scope(), conversationId: second.id }, 'pilot cobalt', '999999'),
    ).toHaveLength(0);
    const mavis = new MavisService(
      db.getRepository(MavisMemory),
      db.getRepository(ProjectMember),
      db.getRepository(User),
      db.getRepository(Goal),
      db.getRepository(Decision),
      db.getRepository(AgentRun),
      db.getRepository(ChatMessage),
      new RetrievalService(db),
      db,
      db.getRepository(Project),
    );
    const pack = await mavis.retrieveContext({
      actorId: owner.id,
      projectId: project.id,
      query: 'pilot cobalt',
      includeApprovedMemories: false,
      includeProjectSources: false,
    });
    expect(pack.historicalConversations).toHaveLength(0);
    const memories = new SavedMemoryService(
      db.getRepository(SavedMemory),
      db.getRepository(ProjectMember),
      db.getRepository(ChatMessage),
      service,
    );
    const dto = {
      kind: SavedMemoryKind.CONTEXT,
      content: 'The pilot has 12 shops.',
      userConfirmed: true as const,
      idempotencyKey: randomUUID(),
      sourceAttachmentId: attachmentId,
    };
    const memory = await memories.create(project.id, owner.id, dto);
    expect(memory.sourceAttachmentId).toBe(attachmentId);
    expect((await memories.create(project.id, owner.id, dto)).id).toBe(memory.id);
    await expect(
      memories.create(project.id, other.id, { ...dto, idempotencyKey: randomUUID() }),
    ).rejects.toThrow('not found');
    const before = await history.revision(scope());
    await service.remove(scope(), attachmentId);
    expect(await service.list(scope())).toHaveLength(0);
    await expect(service.download(scope(), attachmentId)).rejects.toThrow('not found');
    expect(
      (await db.getRepository(ChatMessage).findOneByOrFail({ id: message.id })).contextExcluded,
    ).toBe(true);
    expect(await history.revision(scope())).not.toBe(before);
    expect((await memories.list(project.id, owner.id)).some((m) => m.id === memory.id)).toBe(true);
    expect(
      (await db.getRepository(Conversation).findOneByOrFail({ id: chat.id })).hasPrivateAttachments,
    ).toBe(true);
  });
});
