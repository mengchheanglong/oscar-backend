import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { ProjectMember, ProjectRole } from './entities/project-member.entity';
import { User } from '../users/entities/user.entity';
import { AddMemberDto } from './dto/add-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ProjectMembersService {
  constructor(
    @InjectRepository(ProjectMember)
    private readonly memberRepository: Repository<ProjectMember>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  async listMembers(projectId: string): Promise<ProjectMember[]> {
    return this.memberRepository.find({
      where: {
        projectId,
        removedAt: IsNull(),
      },
      relations: ['user'],
      order: { joinedAt: 'ASC' },
    });
  }

  async addMember(
    projectId: string,
    actorId: string,
    actorRole: ProjectRole,
    dto: AddMemberDto,
    requestId?: string,
  ): Promise<ProjectMember> {
    if (!dto.userId && !dto.email) {
      throw new BadRequestException({
        code: 'USER_IDENTIFIER_REQUIRED',
        message: 'Either userId or email must be provided to add a member.',
      });
    }

    const targetUser = dto.userId
      ? await this.userRepository.findOne({ where: { id: dto.userId } })
      : await this.userRepository.findOne({ where: { email: dto.email?.trim().toLowerCase() } });

    if (!targetUser || !targetUser.isActive) {
      throw new BadRequestException({
        code: 'USER_NOT_FOUND_OR_INACTIVE',
        message: 'The target user does not exist or has been deactivated.',
      });
    }

    const existing = await this.memberRepository.findOne({
      where: {
        projectId,
        userId: targetUser.id,
        removedAt: IsNull(),
      },
    });

    if (existing) {
      throw new ConflictException({
        code: 'MEMBER_ALREADY_EXISTS',
        message: 'This user is already an active member of the project.',
      });
    }

    if (dto.accessRole === ProjectRole.OWNER) {
      throw new BadRequestException({
        code: 'CANNOT_ASSIGN_OWNER',
        message: 'Projects can have only one active owner. Use ownership transfer instead.',
      });
    }

    if (dto.accessRole === ProjectRole.MANAGER && actorRole !== ProjectRole.OWNER) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only the project owner can add or promote managers.',
      });
    }

    const member = this.memberRepository.create({
      projectId,
      userId: targetUser.id,
      accessRole: dto.accessRole,
      joinedAt: new Date(),
      removedAt: null,
    });

    const saved = await this.memberRepository.save(member);
    saved.user = targetUser;

    await this.auditService.record({
      projectId,
      actorId,
      action: 'MEMBER_ADDED',
      entityType: 'PROJECT_MEMBER',
      entityId: saved.id,
      metadata: { targetUserId: targetUser.id, accessRole: saved.accessRole },
      requestId,
    });

    return saved;
  }

  async updateRole(
    projectId: string,
    actorId: string,
    actorRole: ProjectRole,
    targetUserId: string,
    dto: UpdateMemberDto,
    requestId?: string,
  ): Promise<ProjectMember> {
    const member = await this.memberRepository.findOne({
      where: {
        projectId,
        userId: targetUserId,
        removedAt: IsNull(),
      },
      relations: ['user'],
    });

    if (!member) {
      throw new NotFoundException({
        code: 'MEMBER_NOT_FOUND',
        message: 'Project member not found.',
      });
    }

    if (member.accessRole === ProjectRole.OWNER) {
      throw new BadRequestException({
        code: 'CANNOT_MODIFY_OWNER_ROLE',
        message: 'The owner role cannot be changed directly. Use ownership transfer.',
      });
    }

    if (dto.accessRole === ProjectRole.OWNER) {
      throw new BadRequestException({
        code: 'CANNOT_ASSIGN_OWNER',
        message: 'Projects can have only one active owner. Use ownership transfer instead.',
      });
    }

    const involvesManagerRole =
      dto.accessRole === ProjectRole.MANAGER || member.accessRole === ProjectRole.MANAGER;

    if (involvesManagerRole && actorRole !== ProjectRole.OWNER) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only the project owner can promote or demote managers.',
      });
    }

    const previousRole = member.accessRole;
    member.accessRole = dto.accessRole;
    const saved = await this.memberRepository.save(member);

    await this.auditService.record({
      projectId,
      actorId,
      action: 'MEMBER_ROLE_UPDATED',
      entityType: 'PROJECT_MEMBER',
      entityId: saved.id,
      metadata: { targetUserId, previousRole, newRole: saved.accessRole },
      requestId,
    });

    return saved;
  }

  async removeMember(
    projectId: string,
    actorId: string,
    actorRole: ProjectRole,
    targetUserId: string,
    requestId?: string,
  ): Promise<void> {
    const member = await this.memberRepository.findOne({
      where: {
        projectId,
        userId: targetUserId,
        removedAt: IsNull(),
      },
    });

    if (!member) {
      throw new NotFoundException({
        code: 'MEMBER_NOT_FOUND',
        message: 'Project member not found.',
      });
    }

    if (member.accessRole === ProjectRole.OWNER) {
      throw new BadRequestException({
        code: 'CANNOT_REMOVE_OWNER',
        message: 'The project owner cannot be removed. Transfer ownership or archive the project.',
      });
    }

    if (member.accessRole === ProjectRole.MANAGER && actorRole !== ProjectRole.OWNER) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only the project owner can remove managers.',
      });
    }

    member.removedAt = new Date();
    await this.memberRepository.save(member);

    await this.auditService.record({
      projectId,
      actorId,
      action: 'MEMBER_REMOVED',
      entityType: 'PROJECT_MEMBER',
      entityId: member.id,
      metadata: { targetUserId, previousRole: member.accessRole },
      requestId,
    });
  }

  async transferOwnership(
    projectId: string,
    currentOwnerId: string,
    dto: TransferOwnershipDto,
    requestId?: string,
  ): Promise<{ newOwner: ProjectMember; previousOwner: ProjectMember }> {
    return this.dataSource.transaction(async (manager) => {
      const currentOwner = await manager.findOne(ProjectMember, {
        where: {
          projectId,
          userId: currentOwnerId,
          accessRole: ProjectRole.OWNER,
          removedAt: IsNull(),
        },
        relations: ['user'],
      });

      if (!currentOwner) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'Only the project owner can transfer project ownership.',
        });
      }

      if (currentOwner.userId === dto.targetUserId) {
        throw new BadRequestException({
          code: 'ALREADY_OWNER',
          message: 'You are already the owner of this project.',
        });
      }

      const targetMember = await manager.findOne(ProjectMember, {
        where: {
          projectId,
          userId: dto.targetUserId,
          removedAt: IsNull(),
        },
        relations: ['user'],
      });

      if (!targetMember) {
        throw new BadRequestException({
          code: 'TARGET_NOT_MEMBER',
          message: 'Ownership can only be transferred to an active project member.',
        });
      }

      // Demote current owner to MANAGER and promote target to OWNER
      currentOwner.accessRole = ProjectRole.MANAGER;
      targetMember.accessRole = ProjectRole.OWNER;

      await manager.save(ProjectMember, [currentOwner, targetMember]);

      await this.auditService.record({
        projectId,
        actorId: currentOwnerId,
        action: 'OWNERSHIP_TRANSFERRED',
        entityType: 'PROJECT',
        entityId: projectId,
        metadata: {
          previousOwnerId: currentOwnerId,
          newOwnerId: targetMember.userId,
        },
        requestId,
      });

      return {
        newOwner: targetMember,
        previousOwner: currentOwner,
      };
    });
  }

  async searchCandidates(projectId: string, search?: string): Promise<User[]> {
    const activeMemberships = await this.memberRepository.find({
      where: {
        projectId,
        removedAt: IsNull(),
      },
      select: ['userId'],
    });

    const activeUserIds = activeMemberships.map((m) => m.userId);

    const query = this.userRepository
      .createQueryBuilder('user')
      .where('user.isActive = :isActive', { isActive: true });

    if (activeUserIds.length > 0) {
      query.andWhere('user.id NOT IN (:...activeUserIds)', { activeUserIds });
    }

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      query.andWhere('(user.displayName ILIKE :term OR user.email ILIKE :term)', { term });
    }

    return query.take(50).getMany();
  }
}
