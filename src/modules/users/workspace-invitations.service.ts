import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'node:crypto';
import { ProfessionalRole, SystemRole, User } from './entities/user.entity';
import { InvitationStatus, WorkspaceInvitation } from './entities/workspace-invitation.entity';
import { CreateInvitationDto } from './dto/create-invitation.dto';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

@Injectable()
export class WorkspaceInvitationsService {
  private readonly logger = new Logger(WorkspaceInvitationsService.name);

  constructor(
    @InjectRepository(WorkspaceInvitation)
    private readonly invitationRepository: Repository<WorkspaceInvitation>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async createInvitation(actor: User, dto: CreateInvitationDto): Promise<WorkspaceInvitation> {
    if (dto.systemRole === SystemRole.ADMIN && actor.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException({
        code: 'ADMIN_INVITATION_FORBIDDEN',
        message: 'Only a system administrator can invite another administrator.',
      });
    }
    const normalizedEmail = dto.email.trim().toLowerCase();

    // Check if user already exists
    const existingUser = await this.userRepository.findOne({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      throw new ConflictException({
        code: 'USER_ALREADY_EXISTS',
        message: 'A user with this email address already belongs to the workspace.',
      });
    }

    // Check for existing pending invitation
    const existingInvite = await this.invitationRepository.findOne({
      where: { email: normalizedEmail, status: InvitationStatus.PENDING, invitedById: actor.id },
      relations: ['invitedBy'],
    });

    if (existingInvite) {
      if (existingInvite.expiresAt.getTime() > Date.now()) {
        // Return existing active invite
        return existingInvite;
      }
      // Mark as expired
      existingInvite.status = InvitationStatus.EXPIRED;
      await this.invitationRepository.save(existingInvite);
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const invite = this.invitationRepository.create({
      email: normalizedEmail,
      systemRole: dto.systemRole ?? SystemRole.USER,
      professionalRole: dto.professionalRole ?? ProfessionalRole.DEVELOPER,
      token,
      status: InvitationStatus.PENDING,
      invitedById: actor.id,
      expiresAt,
    });

    const saved = await this.invitationRepository.save(invite);
    saved.invitedBy = actor;

    this.logger.log(`Created workspace invitation ${saved.id} by ${actor.id}`);
    return saved;
  }

  async listPendingInvitations(actorId: string): Promise<WorkspaceInvitation[]> {
    await this.expireStaleInvites(actorId);

    return this.invitationRepository.find({
      where: { status: InvitationStatus.PENDING, invitedById: actorId },
      relations: ['invitedBy'],
      order: { createdAt: 'DESC' },
    });
  }

  async cancelInvitation(id: string, actorId: string): Promise<{ id: string; cancelled: boolean }> {
    const invite = await this.invitationRepository.findOne({
      where: { id, invitedById: actorId },
    });

    if (!invite) {
      throw new NotFoundException({
        code: 'INVITATION_NOT_FOUND',
        message: 'Workspace invitation not found.',
      });
    }

    if (invite.status !== InvitationStatus.PENDING) {
      throw new ConflictException({
        code: 'INVITATION_NOT_PENDING',
        message: `Cannot cancel an invitation with status ${invite.status}.`,
      });
    }

    invite.status = InvitationStatus.CANCELLED;
    await this.invitationRepository.save(invite);

    return { id: invite.id, cancelled: true };
  }

  async getInvitePreview(token: string): Promise<{
    email: string;
    systemRole: string;
    professionalRole: string;
    expiresAt: string;
    inviterName?: string;
  }> {
    const invite = await this.findActiveInviteByToken(token);

    return {
      email: invite.email,
      systemRole: invite.systemRole,
      professionalRole: invite.professionalRole,
      expiresAt: invite.expiresAt.toISOString(),
      inviterName: invite.invitedBy?.displayName,
    };
  }

  async findActiveInviteByToken(token: string): Promise<WorkspaceInvitation> {
    const invite = await this.invitationRepository.findOne({
      where: { token },
      relations: ['invitedBy'],
    });

    if (!invite) {
      throw new NotFoundException({
        code: 'INVITATION_NOT_FOUND',
        message: 'This workspace invitation does not exist.',
      });
    }

    if (invite.status === InvitationStatus.CANCELLED) {
      throw new GoneException({
        code: 'INVITATION_CANCELLED',
        message: 'This workspace invitation was cancelled.',
      });
    }

    if (invite.status === InvitationStatus.ACCEPTED) {
      throw new GoneException({
        code: 'INVITATION_ALREADY_USED',
        message: 'This workspace invitation has already been accepted.',
      });
    }

    if (invite.status === InvitationStatus.EXPIRED || invite.expiresAt.getTime() <= Date.now()) {
      if (invite.status === InvitationStatus.PENDING) {
        invite.status = InvitationStatus.EXPIRED;
        await this.invitationRepository.save(invite);
      }
      throw new GoneException({
        code: 'INVITATION_EXPIRED',
        message: 'This invitation has expired. Ask your workspace admin for a new invite link.',
      });
    }

    return invite;
  }

  async markAccepted(inviteId: string): Promise<void> {
    await this.invitationRepository.update(
      { id: inviteId },
      { status: InvitationStatus.ACCEPTED, acceptedAt: new Date() },
    );
  }

  private async expireStaleInvites(actorId: string): Promise<void> {
    await this.invitationRepository
      .createQueryBuilder()
      .update(WorkspaceInvitation)
      .set({ status: InvitationStatus.EXPIRED })
      .where('status = :status AND expires_at <= :now AND invited_by_id = :actorId', {
        status: InvitationStatus.PENDING,
        now: new Date(),
        actorId,
      })
      .execute();
  }
}
