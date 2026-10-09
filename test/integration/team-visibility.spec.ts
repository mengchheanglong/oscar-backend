import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { databaseOptions } from '../../src/database/database-options';
import { UsersService } from '../../src/modules/users/users.service';
import { WorkspaceInvitationsService } from '../../src/modules/users/workspace-invitations.service';
import { User, SystemRole, ProfessionalRole } from '../../src/modules/users/entities/user.entity';
import {
  WorkspaceInvitation,
  InvitationStatus,
} from '../../src/modules/users/entities/workspace-invitation.entity';
import { PasswordService } from '../../src/modules/auth/services/password.service';
import { SessionService } from '../../src/modules/auth/services/session.service';
import { Project, ProjectStatus } from '../../src/modules/projects/entities/project.entity';
import {
  ProjectMember,
  ProjectRole,
} from '../../src/modules/projects/entities/project-member.entity';

describe('Team and invitation isolation with PostgreSQL', () => {
  let db: DataSource;
  let service: UsersService;
  let invites: WorkspaceInvitationsService;
  let a: User, b: User, c: User;
  const userIds: string[] = [];
  const projectIds: string[] = [];
  const inviteIds: string[] = [];
  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (process.env.NODE_ENV !== 'test' || !url || !new URL(url).pathname.endsWith('_test'))
      throw new Error('Dedicated test database required.');
    db = await new DataSource(databaseOptions(url)).initialize();
    await db.runMigrations({ transaction: 'all' });
    service = new UsersService(
      db.getRepository(User),
      {} as PasswordService,
      {} as SessionService,
      new ConfigService(),
    );
    invites = new WorkspaceInvitationsService(
      db.getRepository(WorkspaceInvitation),
      db.getRepository(User),
    );
    const users = await db.getRepository(User).save(
      ['A', 'B', 'C'].map((label) =>
        db.getRepository(User).create({
          email: `team-${label}-${randomUUID()}@example.test`,
          displayName: label,
          passwordHash: 'test-fixture',
          systemRole: label === 'A' ? SystemRole.ADMIN : SystemRole.USER,
          professionalRole: ProfessionalRole.DEVELOPER,
          isActive: true,
          mustChangePassword: false,
        }),
      ),
    );
    a = users[0]!;
    b = users[1]!;
    c = users[2]!;
    userIds.push(...users.map((u) => u.id));
  });
  afterAll(async () => {
    if (!db?.isInitialized) return;
    if (inviteIds.length) await db.getRepository(WorkspaceInvitation).delete({ id: In(inviteIds) });
    if (projectIds.length) await db.getRepository(Project).delete({ id: In(projectIds) });
    if (userIds.length) await db.getRepository(User).delete({ id: In(userIds) });
    await db.destroy();
  });
  const visible = async (user: User) =>
    (await service.listVisibleMembers(user.id)).users.map((u) => u.id).sort();
  async function project(members: User[]) {
    const p = await db.getRepository(Project).save({
      key: randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase(),
      name: 'Team isolation fixture',
      status: ProjectStatus.ACTIVE,
      createdBy: members[0]!.id,
    });
    projectIds.push(p.id);
    await db.getRepository(ProjectMember).save(
      members.map((u, i) => ({
        projectId: p.id,
        userId: u.id,
        accessRole: i === 0 ? ProjectRole.OWNER : ProjectRole.CONTRIBUTOR,
        addedBy: members[0]!.id,
      })),
    );
    return p;
  }
  it('returns only self before sharing any project, including for administrators', async () => {
    expect(await visible(a)).toEqual([a.id]);
    expect(await visible(b)).toEqual([b.id]);
  });
  it('includes direct active collaborators once, without exposing unrelated users', async () => {
    await project([a, b]);
    await project([a, b]);
    await project([c]);
    await project([b, c]);
    expect(await visible(a)).toEqual([a.id, b.id].sort());
    expect(await visible(b)).toEqual([a.id, b.id, c.id].sort());
    expect(await visible(c)).toEqual([b.id, c.id].sort());
  });
  it('removal of either actor or peer and account deactivation revoke directory visibility', async () => {
    await db.getRepository(ProjectMember).update({ userId: b.id }, { removedAt: new Date() });
    expect(await visible(a)).toEqual([a.id]);
    expect(await visible(b)).toEqual([b.id]);
    await db.getRepository(ProjectMember).update({ userId: b.id }, { removedAt: null });
    await db.getRepository(User).update(b.id, { isActive: false });
    expect(await visible(a)).toEqual([a.id]);
    await db.getRepository(User).update(b.id, { isActive: true });
    await db.getRepository(ProjectMember).update({ userId: a.id }, { removedAt: new Date() });
    expect(await visible(b)).toEqual([b.id, c.id].sort());
    await db.getRepository(ProjectMember).update({ userId: a.id }, { removedAt: null });
  });
  it('same-email invitations remain private to their sender and cannot be cancelled by another user', async () => {
    const email = `invited-${randomUUID()}@example.test`;
    const first = await invites.createInvitation(a, { email });
    const second = await invites.createInvitation(b, { email });
    inviteIds.push(first.id, second.id);
    expect(first.id).not.toBe(second.id);
    expect((await invites.listPendingInvitations(a.id)).map((i) => i.id)).toEqual([first.id]);
    expect((await invites.listPendingInvitations(b.id)).map((i) => i.id)).toEqual([second.id]);
    expect((await invites.createInvitation(b, { email })).id).toBe(second.id);
    await expect(invites.cancelInvitation(second.id, a.id)).rejects.toThrow(NotFoundException);
    expect(
      (await db.getRepository(WorkspaceInvitation).findOneByOrFail({ id: second.id })).status,
    ).toBe(InvitationStatus.PENDING);
    await invites.cancelInvitation(first.id, a.id);
    expect(await invites.listPendingInvitations(a.id)).toEqual([]);
    expect(second.systemRole).toBe(SystemRole.USER);
  });
  it('members cannot invite system administrators; administrator grants remain explicit', async () => {
    await expect(
      invites.createInvitation(b, {
        email: `denied-${randomUUID()}@example.test`,
        systemRole: SystemRole.ADMIN,
      }),
    ).rejects.toThrow(ForbiddenException);
    const granted = await invites.createInvitation(a, {
      email: `admin-${randomUUID()}@example.test`,
      systemRole: SystemRole.ADMIN,
    });
    inviteIds.push(granted.id);
    expect(granted.systemRole).toBe(SystemRole.ADMIN);
  });
});
