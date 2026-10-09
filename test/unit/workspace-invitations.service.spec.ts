import { ConflictException, GoneException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { WorkspaceInvitationsService } from '../../src/modules/users/workspace-invitations.service';
import {
  InvitationStatus,
  WorkspaceInvitation,
} from '../../src/modules/users/entities/workspace-invitation.entity';
import { ProfessionalRole, SystemRole, User } from '../../src/modules/users/entities/user.entity';

describe('WorkspaceInvitationsService', () => {
  let service: WorkspaceInvitationsService;
  let mockInvitationRepo: jest.Mocked<Repository<WorkspaceInvitation>>;
  let mockUserRepo: jest.Mocked<Repository<User>>;

  const mockActor = {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'admin@workspace.com',
    displayName: 'Admin User',
    systemRole: SystemRole.ADMIN,
    professionalRole: ProfessionalRole.INFRASTRUCTURE,
  } as User;

  beforeEach(() => {
    mockInvitationRepo = {
      create: jest.fn((dto) => ({ ...dto, id: 'inv-uuid-1', createdAt: new Date() })),
      save: jest.fn(async (inv) => ({
        ...inv,
        id: (inv as WorkspaceInvitation).id || 'inv-uuid-1',
      })),
      findOne: jest.fn(),
      find: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({}),
      })),
    } as unknown as jest.Mocked<Repository<WorkspaceInvitation>>;

    mockUserRepo = {
      findOne: jest.fn(),
    } as unknown as jest.Mocked<Repository<User>>;

    service = new WorkspaceInvitationsService(mockInvitationRepo, mockUserRepo);
  });

  describe('createInvitation', () => {
    it('creates an invitation successfully when email is not registered', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);
      mockInvitationRepo.findOne.mockResolvedValue(null);

      const result = await service.createInvitation(mockActor, {
        email: 'newbie@company.com',
        systemRole: SystemRole.USER,
        professionalRole: ProfessionalRole.DEVELOPER,
      });

      expect(result).toBeDefined();
      expect(result.email).toBe('newbie@company.com');
      expect(result.token).toBeDefined();
      expect(result.token).toHaveLength(64);
      expect(mockInvitationRepo.save).toHaveBeenCalled();
    });

    it('throws ConflictException if email is already a registered user', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'existing-id',
        email: 'existing@company.com',
      } as User);

      await expect(
        service.createInvitation(mockActor, {
          email: 'existing@company.com',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('returns existing active invitation if one is already pending', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);
      const activeInvite = {
        id: 'existing-invite-id',
        email: 'pending@company.com',
        status: InvitationStatus.PENDING,
        expiresAt: new Date(Date.now() + 1000000),
      } as WorkspaceInvitation;
      mockInvitationRepo.findOne.mockResolvedValue(activeInvite);

      const result = await service.createInvitation(mockActor, {
        email: 'pending@company.com',
      });

      expect(result.id).toBe('existing-invite-id');
    });
  });

  describe('cancelInvitation', () => {
    it('cancels a pending invitation', async () => {
      const invite = {
        id: 'inv-to-cancel',
        status: InvitationStatus.PENDING,
      } as WorkspaceInvitation;
      mockInvitationRepo.findOne.mockResolvedValue(invite);

      const res = await service.cancelInvitation('inv-to-cancel', mockActor.id);
      expect(res.cancelled).toBe(true);
      expect(invite.status).toBe(InvitationStatus.CANCELLED);
    });

    it('throws NotFoundException if invitation does not exist', async () => {
      mockInvitationRepo.findOne.mockResolvedValue(null);
      await expect(service.cancelInvitation('nonexistent', mockActor.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getInvitePreview', () => {
    it('returns preview data for valid active invitation', async () => {
      const invite = {
        id: 'inv-1',
        token: 'validtoken123',
        email: 'invited@corp.com',
        systemRole: SystemRole.USER,
        professionalRole: ProfessionalRole.DEVELOPER,
        status: InvitationStatus.PENDING,
        expiresAt: new Date(Date.now() + 500000),
        invitedBy: { displayName: 'Alice Lead' },
      } as unknown as WorkspaceInvitation;
      mockInvitationRepo.findOne.mockResolvedValue(invite);

      const preview = await service.getInvitePreview('validtoken123');
      expect(preview.email).toBe('invited@corp.com');
      expect(preview.inviterName).toBe('Alice Lead');
    });

    it('throws GoneException if invitation is expired', async () => {
      const invite = {
        id: 'inv-exp',
        token: 'expiredtoken',
        status: InvitationStatus.EXPIRED,
        expiresAt: new Date(Date.now() - 10000),
      } as WorkspaceInvitation;
      mockInvitationRepo.findOne.mockResolvedValue(invite);

      await expect(service.getInvitePreview('expiredtoken')).rejects.toThrow(GoneException);
    });

    it('throws GoneException if invitation was cancelled', async () => {
      const invite = {
        id: 'inv-canc',
        token: 'canc-token',
        status: InvitationStatus.CANCELLED,
        expiresAt: new Date(Date.now() + 100000),
      } as WorkspaceInvitation;
      mockInvitationRepo.findOne.mockResolvedValue(invite);

      await expect(service.getInvitePreview('canc-token')).rejects.toThrow(GoneException);
    });
  });
});
