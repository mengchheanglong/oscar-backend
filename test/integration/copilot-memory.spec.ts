import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { databaseOptions } from '../../src/database/database-options';
import { CopilotMemoryService } from '../../src/modules/ai/copilot-memory.service';
import {
  CopilotMemory,
  CopilotMemoryKind,
} from '../../src/modules/ai/entities/copilot-memory.entity';
import { AiMode, Conversation } from '../../src/modules/ai/entities/conversation.entity';
import { ChatMessage, MessageRole } from '../../src/modules/ai/entities/chat-message.entity';
import { User } from '../../src/modules/users/entities/user.entity';
import { Project, ProjectStatus } from '../../src/modules/projects/entities/project.entity';
import {
  ProjectMember,
  ProjectRole,
} from '../../src/modules/projects/entities/project-member.entity';

describe('Private copilot memory with PostgreSQL', () => {
  let database: DataSource;
  let service: CopilotMemoryService;
  let userA: User;
  let userB: User;
  let projectA: Project;
  let projectB: Project;
  const projectIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (process.env.NODE_ENV !== 'test' || !url || !new URL(url).pathname.endsWith('_test'))
      throw new Error('Use the dedicated test database.');
    database = await new DataSource(databaseOptions(url)).initialize();
    await database.runMigrations({ transaction: 'all' });
    const users = database.getRepository(User);
    userA = await users.save(
      users.create({
        email: `${randomUUID()}@memory.test`,
        displayName: 'Memory A',
        passwordHash: 'synthetic-test-only',
      }),
    );
    userIds.push(userA.id);
    userB = await users.save(
      users.create({
        email: `${randomUUID()}@memory.test`,
        displayName: 'Memory B',
        passwordHash: 'synthetic-test-only',
      }),
    );
    userIds.push(userB.id);
    const projects = database.getRepository(Project);
    projectA = await projects.save(
      projects.create({
        key: `M${randomUUID().slice(0, 7).toUpperCase()}`,
        name: 'Memory A',
        createdBy: userA.id,
      }),
    );
    projectIds.push(projectA.id);
    projectB = await projects.save(
      projects.create({
        key: `M${randomUUID().slice(0, 7).toUpperCase()}`,
        name: 'Memory B',
        createdBy: userB.id,
      }),
    );
    projectIds.push(projectB.id);
    const members = database.getRepository(ProjectMember);
    await members.save([
      members.create({ projectId: projectA.id, userId: userA.id, accessRole: ProjectRole.OWNER }),
      members.create({ projectId: projectA.id, userId: userB.id, accessRole: ProjectRole.VIEWER }),
      members.create({ projectId: projectB.id, userId: userB.id, accessRole: ProjectRole.OWNER }),
    ]);
    service = new CopilotMemoryService(
      database.getRepository(CopilotMemory),
      members,
      database.getRepository(ChatMessage),
    );
  });

  beforeEach(async () => {
    await database.getRepository(CopilotMemory).delete({ projectId: In(projectIds) });
  });

  afterAll(async () => {
    if (!database?.isInitialized) return;
    try {
      if (projectIds.length) await database.getRepository(Project).delete({ id: In(projectIds) });
      if (userIds.length) await database.getRepository(User).delete({ id: In(userIds) });
    } finally {
      await database.destroy();
    }
  });

  const draft = (content = 'Compare the assumptions before selecting a plan.') => ({
    kind: CopilotMemoryKind.CONTEXT,
    content,
    userConfirmed: true as const,
    idempotencyKey: randomUUID(),
  });

  it('isolates memories between users in the same project and between projects', async () => {
    const memory = await service.create(projectA.id, userA.id, draft());
    await service.create(projectB.id, userB.id, draft('Other project context.'));
    expect((await service.list(projectA.id, userA.id)).map((m) => m.id)).toEqual([memory.id]);
    expect(await service.list(projectA.id, userB.id)).toEqual([]);
    await expect(service.list(projectB.id, userA.id)).rejects.toThrow(NotFoundException);
    await expect(
      service.update(projectA.id, userB.id, memory.id, {
        ...draft('Overwrite'),
        version: memory.version,
      }),
    ).rejects.toThrow(NotFoundException);
    await expect(service.remove(projectB.id, userB.id, memory.id, memory.version)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('persists one memory for simultaneous retries and rejects changed payloads without overwriting it', async () => {
    const input = draft();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => service.create(projectA.id, userA.id, input)),
    );
    expect(new Set(results.map((m) => m.id)).size).toBe(1);
    expect(
      await database.getRepository(CopilotMemory).count({ where: { projectId: projectA.id } }),
    ).toBe(1);
    await expect(
      service.create(projectA.id, userA.id, { ...input, content: 'Changed payload' }),
    ).rejects.toThrow(ConflictException);
    expect((await service.list(projectA.id, userA.id))[0]?.content).toBe(input.content);
    const freshService = new CopilotMemoryService(
      database.getRepository(CopilotMemory),
      database.getRepository(ProjectMember),
      database.getRepository(ChatMessage),
    );
    expect((await freshService.list(projectA.id, userA.id))[0]?.id).toBe(results[0]?.id);
  });

  it('rejects stale edits/removals and never resurrects a removed memory on retry', async () => {
    const input = draft();
    const saved = await service.create(projectA.id, userA.id, input);
    const updated = await service.update(projectA.id, userA.id, saved.id, {
      ...input,
      content: 'Reviewed correction.',
      version: saved.version,
    });
    expect(updated.version).toBe(saved.version + 1);
    await expect(
      service.update(projectA.id, userA.id, saved.id, { ...input, version: saved.version }),
    ).rejects.toThrow(ConflictException);
    await expect(service.remove(projectA.id, userA.id, saved.id, saved.version)).rejects.toThrow(
      ConflictException,
    );
    await service.remove(projectA.id, userA.id, saved.id, updated.version);
    expect(await service.list(projectA.id, userA.id)).toEqual([]);
    await expect(service.create(projectA.id, userA.id, input)).rejects.toThrow(ConflictException);
  });

  it('accepts provenance only from the same private, live conversation scope', async () => {
    const conversations = database.getRepository(Conversation);
    const messages = database.getRepository(ChatMessage);
    const other = await conversations.save(
      conversations.create({ projectId: projectA.id, userId: userB.id }),
    );
    const otherMessage = await messages.save(
      messages.create({
        conversationId: other.id,
        role: MessageRole.ASSISTANT,
        mode: AiMode.WORKSPACE,
        content: 'Private other-user reply.',
      }),
    );
    await expect(
      service.create(projectA.id, userA.id, { ...draft(), sourceMessageId: otherMessage.id }),
    ).rejects.toThrow(NotFoundException);
    const own = await conversations.save(
      conversations.create({ projectId: projectA.id, userId: userA.id }),
    );
    const ownMessage = await messages.save(
      messages.create({
        conversationId: own.id,
        role: MessageRole.ASSISTANT,
        mode: AiMode.WORKSPACE,
        content: 'Review this lesson.',
      }),
    );
    expect(
      (await service.create(projectA.id, userA.id, { ...draft(), sourceMessageId: ownMessage.id }))
        .sourceMessageId,
    ).toBe(ownMessage.id);
    await conversations.update(own.id, { deletedAt: new Date() });
    await expect(
      service.create(projectA.id, userA.id, { ...draft(), sourceMessageId: ownMessage.id }),
    ).rejects.toThrow(NotFoundException);
  });

  it('requires explicit review, active membership/account, and a writable project for mutations', async () => {
    await expect(
      service.create(projectA.id, userA.id, {
        ...draft(),
        userConfirmed: false as unknown as true,
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(service.create(projectA.id, userA.id, draft('   '))).rejects.toThrow(
      BadRequestException,
    );
    await database
      .getRepository(ProjectMember)
      .update({ projectId: projectA.id, userId: userB.id }, { removedAt: new Date() });
    try {
      await expect(service.list(projectA.id, userB.id)).rejects.toThrow(NotFoundException);
    } finally {
      await database
        .getRepository(ProjectMember)
        .update({ projectId: projectA.id, userId: userB.id }, { removedAt: null });
    }
    await database.getRepository(User).update(userB.id, { isActive: false });
    try {
      await expect(service.list(projectA.id, userB.id)).rejects.toThrow(NotFoundException);
    } finally {
      await database.getRepository(User).update(userB.id, { isActive: true });
    }
    await database.getRepository(Project).update(projectA.id, { status: ProjectStatus.ARCHIVED });
    try {
      await expect(service.create(projectA.id, userA.id, draft())).rejects.toThrow(
        BadRequestException,
      );
    } finally {
      await database.getRepository(Project).update(projectA.id, { status: ProjectStatus.ACTIVE });
    }
  });
});
