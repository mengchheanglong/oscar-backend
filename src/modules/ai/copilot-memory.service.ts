import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { ProjectMember } from '../projects/entities/project-member.entity';
import { ProjectStatus } from '../projects/entities/project.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { CopilotMemory } from './entities/copilot-memory.entity';
import { CreateCopilotMemoryDto, UpdateCopilotMemoryDto } from './dto/copilot-memory.dto';

@Injectable()
export class CopilotMemoryService {
  constructor(
    @InjectRepository(CopilotMemory) private readonly memories: Repository<CopilotMemory>,
    @InjectRepository(ProjectMember) private readonly members: Repository<ProjectMember>,
    @InjectRepository(ChatMessage) private readonly messages: Repository<ChatMessage>,
  ) {}

  private async assertAccess(projectId: string, userId: string, mutation = false): Promise<void> {
    const membership = await this.members.findOne({
      where: { projectId, userId, removedAt: IsNull() },
      relations: ['project', 'user'],
    });
    if (!membership?.project || !membership.user?.isActive) {
      throw new NotFoundException({ code: 'PROJECT_NOT_FOUND', message: 'Project not found.' });
    }
    if (mutation && membership.project.status === ProjectStatus.ARCHIVED) {
      throw new BadRequestException({
        code: 'PROJECT_ARCHIVED',
        message: 'This project is read-only.',
      });
    }
  }

  private reviewedContent(content: string, userConfirmed: boolean): string {
    if (userConfirmed !== true || !content.trim() || content.trim().length > 2000) {
      throw new BadRequestException({
        code: 'INVALID_MEMORY',
        message: 'Review a nonempty memory of at most 2000 characters before saving.',
      });
    }
    return content.trim();
  }

  async list(projectId: string, userId: string, limit = 100): Promise<CopilotMemory[]> {
    await this.assertAccess(projectId, userId);
    return this.memories.find({
      where: { projectId, userId, deletedAt: IsNull() },
      order: { updatedAt: 'DESC', id: 'DESC' },
      take: Math.min(Math.max(limit, 1), 100),
    });
  }

  async create(
    projectId: string,
    userId: string,
    dto: CreateCopilotMemoryDto,
  ): Promise<CopilotMemory> {
    await this.assertAccess(projectId, userId, true);
    const content = this.reviewedContent(dto.content, dto.userConfirmed);
    if (dto.sourceMessageId) {
      const message = await this.messages.findOne({
        where: {
          id: dto.sourceMessageId,
          conversation: { projectId, userId, deletedAt: IsNull() },
        },
      });
      if (!message)
        throw new NotFoundException({
          code: 'MESSAGE_NOT_FOUND',
          message: 'Source message not found.',
        });
    }
    const payloadHash = createHash('sha256')
      .update(
        JSON.stringify({
          kind: dto.kind,
          content,
          sourceMessageId: dto.sourceMessageId ?? null,
        }),
      )
      .digest('hex');

    // A unique scope/key constraint handles simultaneous retries without overwriting a reviewed entry.
    await this.memories
      .createQueryBuilder()
      .insert()
      .values({
        projectId,
        userId,
        kind: dto.kind,
        content,
        sourceMessageId: dto.sourceMessageId ?? null,
        idempotencyKey: dto.idempotencyKey,
        payloadHash,
      })
      .onConflict('("project_id", "user_id", "idempotency_key") DO NOTHING')
      .execute();
    const memory = await this.memories
      .createQueryBuilder('memory')
      .addSelect('memory.payloadHash')
      .where(
        'memory.projectId = :projectId AND memory.userId = :userId AND memory.idempotencyKey = :key',
        {
          projectId,
          userId,
          key: dto.idempotencyKey,
        },
      )
      .getOne();
    if (!memory || memory.payloadHash !== payloadHash || memory.deletedAt) {
      throw new ConflictException({
        code: 'MEMORY_RETRY_CONFLICT',
        message: 'Use a new save key for changed or removed memory.',
      });
    }
    return memory;
  }

  private async current(projectId: string, userId: string, id: string): Promise<CopilotMemory> {
    const memory = await this.memories.findOne({
      where: { id, projectId, userId, deletedAt: IsNull() },
    });
    if (!memory)
      throw new NotFoundException({ code: 'MEMORY_NOT_FOUND', message: 'Memory not found.' });
    return memory;
  }

  async update(
    projectId: string,
    userId: string,
    id: string,
    dto: UpdateCopilotMemoryDto,
  ): Promise<CopilotMemory> {
    await this.assertAccess(projectId, userId, true);
    const content = this.reviewedContent(dto.content, dto.userConfirmed);
    await this.current(projectId, userId, id);
    const result = await this.memories.update(
      { id, projectId, userId, deletedAt: IsNull(), version: dto.version },
      {
        kind: dto.kind,
        content,
      },
    );
    if (!result.affected)
      throw new ConflictException({
        code: 'STALE_MEMORY',
        message: 'Memory changed. Refresh before editing.',
      });
    return this.current(projectId, userId, id);
  }

  async remove(projectId: string, userId: string, id: string, version: number): Promise<void> {
    await this.assertAccess(projectId, userId, true);
    await this.current(projectId, userId, id);
    const result = await this.memories.update(
      { id, projectId, userId, deletedAt: IsNull(), version },
      { deletedAt: new Date() },
    );
    if (!result.affected)
      throw new ConflictException({
        code: 'STALE_MEMORY',
        message: 'Memory changed. Refresh before removing.',
      });
  }
}
