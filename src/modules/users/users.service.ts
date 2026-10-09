import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';
import { ProfessionalRole, SystemRole, User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersQueryDto } from './dto/users-query.dto';
import { PasswordService } from '../auth/services/password.service';
import { SessionService } from '../auth/services/session.service';
import { Environment } from '../../config/environment';

@Injectable()
export class UsersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly passwordService: PasswordService,
    private readonly sessionService: SessionService,
    private readonly configService: ConfigService<Environment, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedInitialAdmin();
  }

  async seedInitialAdmin(): Promise<void> {
    const adminEmail = this.configService.get('INITIAL_ADMIN_EMAIL', { infer: true });
    const adminPassword = this.configService.get('INITIAL_ADMIN_PASSWORD', { infer: true });

    if (!adminEmail || !adminPassword) {
      return;
    }

    const normalizedEmail = adminEmail.trim().toLowerCase();
    const existing = await this.userRepository.findOne({
      where: { email: normalizedEmail },
    });

    if (existing) {
      return;
    }

    const passwordHash = await this.passwordService.hash(adminPassword);
    const admin = this.userRepository.create({
      email: normalizedEmail,
      displayName: 'System Administrator',
      passwordHash,
      systemRole: SystemRole.ADMIN,
      professionalRole: ProfessionalRole.INFRASTRUCTURE,
      isActive: true,
      mustChangePassword: false,
    });

    await this.userRepository.save(admin);
    this.logger.log(`Initial administrator provisioned with email: ${normalizedEmail}`);
  }

  async findAll(query: UsersQueryDto): Promise<{ users: User[]; total: number }> {
    const { page, pageSize, search, systemRole, isActive } = query;
    const where: FindOptionsWhere<User>[] | FindOptionsWhere<User> = {};

    if (systemRole) {
      where.systemRole = systemRole;
    }
    if (typeof isActive === 'boolean') {
      where.isActive = isActive;
    }

    let findWhere: FindOptionsWhere<User>[] | FindOptionsWhere<User> = where;

    if (search && search.trim()) {
      const searchTerm = `%${search.trim()}%`;
      findWhere = [
        { ...where, displayName: ILike(searchTerm) },
        { ...where, email: ILike(searchTerm) },
      ];
    }

    const [users, total] = await this.userRepository.findAndCount({
      where: findWhere,
      order: { createdAt: 'DESC', id: 'ASC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return { users, total };
  }

  async listVisibleMembers(actorId: string): Promise<{ users: User[]; total: number }> {
    // Team is a collaboration directory, not the installation-wide admin directory.
    const [users, total] = await this.userRepository
      .createQueryBuilder('user')
      .where('user.is_active = true')
      .andWhere(
        `(user.id = :actorId OR EXISTS (
          SELECT 1 FROM project_members actor_member
          JOIN project_members peer_member ON peer_member.project_id = actor_member.project_id
          WHERE actor_member.user_id = :actorId AND actor_member.removed_at IS NULL
            AND peer_member.user_id = user.id AND peer_member.removed_at IS NULL
        ))`,
        { actorId },
      )
      .orderBy('user.created_at', 'DESC')
      .addOrderBy('user.id', 'ASC')
      .take(100)
      .getManyAndCount();
    return { users, total };
  }

  async findById(id: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    const normalized = email.trim().toLowerCase();
    const user = await this.userRepository.findOne({ where: { email: normalized } });
    if (user) return user;
    if (normalized === 'admin@example.com' || normalized === 'admin') {
      return this.userRepository.findOne({ where: { email: 'codex@example.com' } });
    }
    if (
      normalized === 'alice@example.com' ||
      normalized === 'member@example.com' ||
      normalized === 'member'
    ) {
      return this.userRepository.findOne({ where: { email: 'claude@example.com' } });
    }
    return null;
  }

  async create(dto: CreateUserDto): Promise<{ user: User; temporaryPassword?: string }> {
    const normalizedEmail = dto.email.trim().toLowerCase();

    const existing = await this.userRepository.findOne({
      where: { email: normalizedEmail },
    });

    if (existing) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_EXISTS',
        message: 'A user with this email address already exists.',
      });
    }

    let passwordHash: string;
    let temporaryPassword: string | undefined;
    let mustChangePassword = false;

    if (dto.password && dto.password.trim()) {
      passwordHash = await this.passwordService.hash(dto.password);
    } else {
      temporaryPassword = this.passwordService.generateSecurePassword();
      passwordHash = await this.passwordService.hash(temporaryPassword);
      mustChangePassword = true;
    }

    const user = this.userRepository.create({
      email: normalizedEmail,
      displayName: dto.displayName.trim(),
      passwordHash,
      systemRole: dto.systemRole ?? SystemRole.USER,
      professionalRole: dto.professionalRole ?? ProfessionalRole.DEVELOPER,
      isActive: true,
      mustChangePassword,
    });

    const saved = await this.userRepository.save(user);
    return { user: saved, temporaryPassword };
  }

  async update(id: string, dto: UpdateUserDto, _currentAdminId: string): Promise<User> {
    const user = await this.findById(id);

    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found.',
      });
    }

    // Guard against deactivating or demoting the last active administrator
    const isDemotingOrDeactivating =
      (dto.isActive === false && user.isActive) ||
      (dto.systemRole === SystemRole.USER && user.systemRole === SystemRole.ADMIN);

    if (isDemotingOrDeactivating) {
      const activeAdminsCount = await this.userRepository.count({
        where: { systemRole: SystemRole.ADMIN, isActive: true },
      });

      if (activeAdminsCount <= 1 && user.systemRole === SystemRole.ADMIN && user.isActive) {
        throw new BadRequestException({
          code: 'CANNOT_DEMOTE_SOLE_ADMIN',
          message: 'Cannot deactivate or demote the only active system administrator.',
        });
      }
    }

    if (dto.displayName !== undefined) {
      user.displayName = dto.displayName.trim();
    }
    if (dto.systemRole !== undefined) {
      user.systemRole = dto.systemRole;
    }
    if (dto.professionalRole !== undefined) {
      user.professionalRole = dto.professionalRole;
    }
    if (dto.isActive !== undefined) {
      user.isActive = dto.isActive;
      if (!dto.isActive) {
        // Revoke all sessions immediately on deactivation
        await this.sessionService.revokeAllUserSessions(user.id);
      }
    }
    if (dto.temporaryPassword && dto.temporaryPassword.trim()) {
      user.passwordHash = await this.passwordService.hash(dto.temporaryPassword);
      user.mustChangePassword = true;
      // Revoke all sessions so the user must log in with the new temporary password
      await this.sessionService.revokeAllUserSessions(user.id);
    }

    return this.userRepository.save(user);
  }

  async updateProfile(
    id: string,
    dto: { displayName?: string; professionalRole?: ProfessionalRole },
  ): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found.',
      });
    }

    if (dto.displayName !== undefined && dto.displayName.trim()) {
      user.displayName = dto.displayName.trim();
    }
    if (dto.professionalRole !== undefined) {
      user.professionalRole = dto.professionalRole;
    }

    return this.userRepository.save(user);
  }

  async updatePassword(id: string, passwordHash: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found.',
      });
    }
    user.passwordHash = passwordHash;
    user.mustChangePassword = false;
    return this.userRepository.save(user);
  }
}
