import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../../src/database/database-options';
import { SkillsService } from '../../src/modules/skills/skills.service';
import { User } from '../../src/modules/users/entities/user.entity';
import { Project } from '../../src/modules/projects/entities/project.entity';
import {
  ProjectMember,
  ProjectRole,
} from '../../src/modules/projects/entities/project-member.entity';
import { Conversation } from '../../src/modules/assistant/entities/conversation.entity';
import { AssistantMode } from '../../src/modules/assistant/entities/assistant-mode.enum';
import {
  ChatMessage,
  MessageRole,
  MessageStatus,
} from '../../src/modules/assistant/entities/chat-message.entity';
import { skillContext, skillCommands } from '../../src/modules/skills/skill-context';

describe('Central skill library and conversation continuity (PostgreSQL)', () => {
  let db: DataSource,
    skills: SkillsService,
    user: User,
    other: User,
    project: Project,
    chat: Conversation;
  const input = (slug = 'clear-plan') => ({
    slug,
    name: 'Clear plan',
    description: 'Plan clearly.',
    instructions: 'Define the outcome, steps, and verification.',
  });
  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (process.env.NODE_ENV !== 'test' || !url || !new URL(url).pathname.endsWith('_test'))
      throw Error('Dedicated test database required.');
    db = await new DataSource(databaseOptions(url)).initialize();
    await db.runMigrations({ transaction: 'all' });
    skills = new SkillsService(db);
    user = await db.getRepository(User).save({
      email: randomUUID() + '@skills.test',
      displayName: 'Skill QA',
      passwordHash: 'synthetic',
    });
    other = await db.getRepository(User).save({
      email: randomUUID() + '@skills.test',
      displayName: 'Other QA',
      passwordHash: 'synthetic',
    });
    project = await db
      .getRepository(Project)
      .save({ key: 'S' + randomUUID().slice(0, 7), name: 'Skills QA', createdBy: user.id });
    await db.getRepository(ProjectMember).save([
      { projectId: project.id, userId: user.id, accessRole: ProjectRole.OWNER },
      { projectId: project.id, userId: other.id, accessRole: ProjectRole.CONTRIBUTOR },
    ]);
  });
  beforeEach(async () => {
    await db.query('DELETE FROM skills WHERE user_id=ANY($1::uuid[])', [[user.id, other.id]]);
    chat = await db.getRepository(Conversation).save({ projectId: project.id, userId: user.id });
  });
  afterAll(async () => {
    if (db?.isInitialized) {
      await db.getRepository(Project).delete(project.id);
      await db.getRepository(User).delete([user.id, other.id]);
      await db.destroy();
    }
  });
  it('attaches on invocation, survives later turns and isolates other chats', async () => {
    const row = await skills.save(user.id, input());
    const first = await skills.prepare(project.id, user.id, chat.id, '/clear-plan Build a plan');
    expect(first).toEqual([
      expect.objectContaining({ id: row.id, version: 1, instructions: input().instructions }),
    ]);
    expect(await new SkillsService(db).prepare(project.id, user.id, chat.id, 'Continue')).toEqual(
      first,
    );
    const second = await db
      .getRepository(Conversation)
      .save({ projectId: project.id, userId: user.id });
    expect(await skills.prepare(project.id, user.id, second.id, 'Continue')).toEqual([]);
    expect(await skills.attached(project.id, user.id, chat.id)).toEqual([
      { id: row.id, slug: row.slug, name: row.name, version: 1 },
    ]);
  });
  it('freezes versions until explicitly reattached and rejects stale edits', async () => {
    const row = await skills.save(user.id, input());
    const frozen = await skills.prepare(project.id, user.id, chat.id, '/clear-plan First');
    const updated = await skills.save(
      user.id,
      { ...input(), instructions: 'New instructions', version: 1 },
      row.id,
    );
    expect(updated.version).toBe(2);
    await expect(skills.save(user.id, { ...input(), version: 1 }, row.id)).rejects.toThrow(
      'Skill changed',
    );
    expect(await skills.prepare(project.id, user.id, chat.id, 'Later')).toEqual(frozen);
    expect(
      (await skills.prepare(project.id, user.id, chat.id, '/clear-plan Update'))[0]?.version,
    ).toBe(2);
  });
  it('rejects foreign skill IDs and conversation ownership even for another project member', async () => {
    const foreign = await skills.save(other.id, input('foreign'));
    await expect(skills.get(user.id, foreign.id)).rejects.toThrow('not found');
    await expect(skills.remove(user.id, foreign.id)).rejects.toThrow('not found');
    expect(await skills.list(user.id)).toEqual([]);
    await expect(skills.prepare(project.id, user.id, chat.id, '/foreign Task')).rejects.toThrow(
      'Unknown skill',
    );
    await expect(skills.attached(project.id, other.id, chat.id)).rejects.toThrow(
      'Conversation not found',
    );
    await expect(skills.prepare(randomUUID(), user.id, chat.id, 'Task')).rejects.toThrow(
      'Conversation not found',
    );
  });
  it('rolls back a batch with an unknown command or too many skills', async () => {
    for (let n = 0; n < 5; n++) await skills.save(user.id, input('plan-' + n));
    await expect(
      skills.prepare(project.id, user.id, chat.id, '/plan-0 /missing Task'),
    ).rejects.toThrow('Unknown skill');
    expect(await skills.attached(project.id, user.id, chat.id)).toEqual([]);
    await expect(
      skills.prepare(project.id, user.id, chat.id, '/plan-0 /plan-1 /plan-2 /plan-3 /plan-4 Task'),
    ).rejects.toThrow('four skills');
    expect(await skills.attached(project.id, user.id, chat.id)).toEqual([]);
  });
  it('removes skills from future turns while preserving the saved turn snapshot', async () => {
    const row = await skills.save(user.id, input());
    const selected = await skills.prepare(project.id, user.id, chat.id, '/clear-plan Task');
    const message = await db.getRepository(ChatMessage).save({
      conversationId: chat.id,
      content: '/clear-plan Task',
      role: MessageRole.USER,
      mode: AssistantMode.WORKSPACE,
      status: MessageStatus.COMPLETED,
      citations: [],
      skillContext: selected,
    });
    await skills.detach(project.id, user.id, chat.id, row.id);
    expect(await skills.prepare(project.id, user.id, chat.id, 'Next')).toEqual([]);
    await skills.prepare(project.id, user.id, chat.id, '/clear-plan Task');
    await skills.remove(user.id, row.id);
    expect(await skills.prepare(project.id, user.id, chat.id, 'Next')).toEqual([]);
    expect(
      (await db.getRepository(ChatMessage).findOneByOrFail({ id: message.id })).skillContext,
    ).toEqual(selected);
  });
  it('rechecks removed membership and inactive accounts', async () => {
    await db
      .getRepository(ProjectMember)
      .update({ projectId: project.id, userId: user.id }, { removedAt: new Date() });
    try {
      await expect(skills.attached(project.id, user.id, chat.id)).rejects.toThrow('not found');
    } finally {
      await db
        .getRepository(ProjectMember)
        .update({ projectId: project.id, userId: user.id }, { removedAt: null });
    }
    await db.getRepository(User).update(user.id, { isActive: false });
    try {
      await expect(skills.prepare(project.id, user.id, chat.id, 'Task')).rejects.toThrow(
        'not found',
      );
    } finally {
      await db.getRepository(User).update(user.id, { isActive: true });
    }
  });
  it('recognizes only explicit leading commands and retains native permission boundaries', () => {
    expect(skillCommands('/clear-plan /clear_plan task')).toEqual(['clear-plan', 'clear_plan']);
    expect(skillCommands('quote /clear-plan')).toEqual([]);
    expect(skillCommands('/tmp/file')).toEqual([]);
    expect(skillContext([])).toBe('');
    expect(skillContext([{ id: randomUUID(), ...input(), version: 1 }])).toContain(
      'cannot grant permissions',
    );
  });
});
