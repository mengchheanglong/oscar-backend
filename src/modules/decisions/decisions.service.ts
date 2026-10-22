import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { Decision, DecisionStatus } from './entities/decision.entity';
import { DecisionRevision } from './entities/decision-revision.entity';
import { Project } from '../projects/entities/project.entity';
import { ProjectRole } from '../projects/entities/project-member.entity';
import { Goal } from '../goals/entities/goal.entity';
import { CreateDecisionDto } from './dto/create-decision.dto';
import { UpdateDecisionDto } from './dto/update-decision.dto';
import { ListDecisionsQueryDto } from './dto/list-decisions-query.dto';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../ingestion/outbox.service';

const SORT_COLUMN_MAP: Record<string, string> = {
  number: 'decision.number',
  title: 'decision.title',
  status: 'decision.status',
  decidedAt: 'decision.decidedAt',
  createdAt: 'decision.createdAt',
  updatedAt: 'decision.updatedAt',
};

/** Maximum supersession chain depth to prevent cycles */
const MAX_SUPERSESSION_DEPTH = 50;

@Injectable()
export class DecisionsService {
  constructor(
    @InjectRepository(Decision)
    private readonly decisionRepository: Repository<Decision>,
    @InjectRepository(DecisionRevision)
    private readonly revisionRepository: Repository<DecisionRevision>,
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(Goal)
    private readonly goalRepository: Repository<Goal>,
    private readonly auditService: AuditService,
    private readonly outboxService: OutboxService,
    private readonly dataSource: DataSource,
  ) {}

  async create(
    projectId: string,
    actorId: string,
    dto: CreateDecisionDto,
    requestId?: string,
  ): Promise<Decision> {
    if (!dto.title || dto.title.trim().length === 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Decision title cannot be empty or whitespace.',
      });
    }
    if (!dto.decisionText || dto.decisionText.trim().length === 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Decision text cannot be empty or whitespace.',
      });
    }
    if (dto.supersedesDecisionId) {
      await this.validateDecisionInProject(dto.supersedesDecisionId, projectId);
    }
    if (dto.goalId) {
      await this.validateGoalInProject(dto.goalId, projectId);
    }

    return this.dataSource.transaction(async (manager) => {
      // Allocate project-local number
      const result: { max: number | null }[] = await manager.query(
        `SELECT MAX("number") as max FROM "decisions" WHERE "project_id" = $1`,
        [projectId],
      );
      const nextNumber = (result[0]?.max ?? 0) + 1;

      const decision = manager.create(Decision, {
        projectId,
        number: nextNumber,
        title: dto.title.trim(),
        decisionText: dto.decisionText.trim(),
        rationale: dto.rationale?.trim() ?? null,
        status: DecisionStatus.PROPOSED,
        decidedAt: null,
        decidedBy: null,
        supersedesDecisionId: dto.supersedesDecisionId ?? null,
        goalId: dto.goalId ?? null,
        sourceMeetingId: null,
        createdBy: actorId,
        updatedBy: actorId,
        version: 1,
        deletedAt: null,
      });

      const saved = await manager.save(Decision, decision);

      // Create initial revision
      const revision = manager.create(DecisionRevision, {
        decisionId: saved.id,
        version: 1,
        title: saved.title,
        decisionText: saved.decisionText,
        rationale: saved.rationale,
        status: saved.status,
        changedBy: actorId,
      });
      await manager.save(DecisionRevision, revision);

      await this.outboxService.emit(manager, {
        projectId,
        eventType: 'DECISION_CREATED',
        payload: {
          decisionId: saved.id,
          revision: 1,
          title: saved.title,
          status: saved.status,
          category: 'ARCHITECTURE',
          context: saved.rationale,
          decision: saved.decisionText,
          consequences: null,
        },
        dedupeKey: `decision:${saved.id}:1:created`,
      });

      await this.auditService.record({
        projectId,
        actorId,
        action: 'DECISION_CREATED',
        entityType: 'DECISION',
        entityId: saved.id,
        metadata: { number: saved.number, title: saved.title },
        requestId,
      });

      return saved;
    });
  }

  async list(
    projectId: string,
    query: ListDecisionsQueryDto,
  ): Promise<{ data: Decision[]; total: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const sortBy = query.sortBy ?? 'number';
    const sortOrder = query.sortOrder ?? 'DESC';

    const qb: SelectQueryBuilder<Decision> = this.decisionRepository
      .createQueryBuilder('decision')
      .where('decision.projectId = :projectId', { projectId })
      .andWhere('decision.deletedAt IS NULL');

    if (query.number !== undefined) {
      qb.andWhere('decision.number = :number', { number: query.number });
    }
    if (query.status) {
      qb.andWhere('decision.status = :status', { status: query.status });
    }
    if (query.search) {
      qb.andWhere(
        `to_tsvector('english', coalesce(decision.title, '') || ' ' || coalesce(decision.decision_text, '')) @@ plainto_tsquery('english', :search)`,
        { search: query.search },
      );
    }

    const sortColumn = SORT_COLUMN_MAP[sortBy] ?? 'decision.number';
    qb.orderBy(sortColumn, sortOrder).addOrderBy('decision.id', 'ASC');

    qb.skip((page - 1) * pageSize).take(pageSize);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async getById(projectId: string, decisionId: string): Promise<Decision> {
    const decision = await this.decisionRepository.findOne({
      where: { id: decisionId, projectId, deletedAt: IsNull() },
    });
    if (!decision) {
      throw new NotFoundException({
        code: 'DECISION_NOT_FOUND',
        message: 'Decision not found.',
      });
    }
    return decision;
  }

  async update(
    projectId: string,
    decisionId: string,
    actorId: string,
    dto: UpdateDecisionDto,
    requestId?: string,
  ): Promise<Decision> {
    const decision = await this.getById(projectId, decisionId);

    if (decision.version !== dto.version) {
      throw new ConflictException({
        code: 'CONCURRENCY_CONFLICT',
        message: 'Decision has been modified by another request. Please reload.',
      });
    }
    if (dto.supersedesDecisionId !== undefined && dto.supersedesDecisionId !== null) {
      await this.validateDecisionInProject(dto.supersedesDecisionId, projectId);
      await this.checkSupersessionCycle(decisionId, dto.supersedesDecisionId);
    }

    const isAccepted = decision.status === DecisionStatus.ACCEPTED;

    // Apply updates
    if (dto.title !== undefined) {
      if (dto.title.trim().length === 0) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Decision title cannot be empty or whitespace.',
        });
      }
      decision.title = dto.title.trim();
    }
    if (dto.decisionText !== undefined) {
      if (dto.decisionText.trim().length === 0) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Decision text cannot be empty or whitespace.',
        });
      }
      decision.decisionText = dto.decisionText.trim();
    }
    if (dto.rationale !== undefined) decision.rationale = dto.rationale?.trim() ?? null;
    if (dto.status !== undefined) {
      decision.status = dto.status;
      if (dto.status === DecisionStatus.ACCEPTED && !decision.decidedAt) {
        decision.decidedAt = new Date();
        decision.decidedBy = actorId;
      }
    }
    if (dto.supersedesDecisionId !== undefined) {
      decision.supersedesDecisionId = dto.supersedesDecisionId ?? null;
    }
    if (dto.goalId !== undefined) {
      if (dto.goalId !== null) {
        await this.validateGoalInProject(dto.goalId, projectId);
      }
      decision.goalId = dto.goalId ?? null;
    }
    decision.updatedBy = actorId;

    const saved = await this.decisionRepository.save(decision);

    // Snapshot updated state as revision
    const revision = this.revisionRepository.create({
      decisionId: saved.id,
      version: saved.version,
      title: saved.title,
      decisionText: saved.decisionText,
      rationale: saved.rationale,
      status: saved.status,
      changedBy: actorId,
    });
    await this.revisionRepository.save(revision);

    await this.outboxService.emit({
      projectId,
      eventType: 'DECISION_UPDATED',
      payload: {
        decisionId: saved.id,
        revision: saved.version,
        title: saved.title,
        status: saved.status,
        category: 'ARCHITECTURE',
        context: saved.rationale,
        decision: saved.decisionText,
        consequences: null,
      },
      dedupeKey: `decision:${saved.id}:${saved.version}:updated`,
    });

    // Extra auditing when modifying an accepted decision
    const action = isAccepted ? 'ACCEPTED_DECISION_UPDATED' : 'DECISION_UPDATED';
    await this.auditService.record({
      projectId,
      actorId,
      action,
      entityType: 'DECISION',
      entityId: saved.id,
      metadata: { number: saved.number, version: saved.version },
      requestId,
    });

    return saved;
  }

  async softDelete(
    projectId: string,
    decisionId: string,
    actorId: string,
    actorRole: ProjectRole,
    requestId?: string,
  ): Promise<void> {
    const decision = await this.getById(projectId, decisionId);

    if (actorRole === ProjectRole.CONTRIBUTOR && decision.createdBy !== actorId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You can only delete decisions you created.',
      });
    }

    decision.deletedAt = new Date();
    decision.updatedBy = actorId;
    await this.decisionRepository.save(decision);

    await this.outboxService.emit({
      projectId,
      eventType: 'DECISION_DELETED',
      payload: {
        decisionId: decision.id,
      },
      dedupeKey: `decision:${decision.id}:deleted`,
    });

    await this.auditService.record({
      projectId,
      actorId,
      action: 'DECISION_DELETED',
      entityType: 'DECISION',
      entityId: decision.id,
      metadata: { number: decision.number },
      requestId,
    });
  }

  async listRevisions(projectId: string, decisionId: string): Promise<DecisionRevision[]> {
    await this.getById(projectId, decisionId);

    return this.revisionRepository.find({
      where: { decisionId },
      order: { version: 'DESC' },
    });
  }

  async getProjectKey(projectId: string): Promise<string> {
    const project = await this.projectRepository.findOne({
      where: { id: projectId },
      select: ['key'],
    });
    if (!project) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found.',
      });
    }
    return project.key;
  }

  private async validateDecisionInProject(decisionId: string, projectId: string): Promise<void> {
    try {
      const decision = await this.decisionRepository.findOne({
        where: { id: decisionId, projectId, deletedAt: IsNull() },
        select: ['id'],
      });
      if (!decision) {
        throw new BadRequestException({
          code: 'INVALID_DECISION',
          message: 'Referenced decision not found in this project.',
        });
      }
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      if (
        (typeof err === 'object' && err !== null && 'code' in err && err.code === '22P02') ||
        (err instanceof Error && err.message.includes('invalid input syntax for type uuid'))
      ) {
        throw new BadRequestException({
          code: 'INVALID_DECISION',
          message: 'Referenced decision not found in this project.',
        });
      }
      throw err;
    }
  }

  /**
   * Walk the supersession chain to prevent cycles.
   * Bounded to MAX_SUPERSESSION_DEPTH hops.
   */
  private async checkSupersessionCycle(
    currentDecisionId: string,
    targetDecisionId: string,
  ): Promise<void> {
    if (currentDecisionId === targetDecisionId) {
      throw new BadRequestException({
        code: 'SUPERSESSION_CYCLE',
        message: 'A decision cannot supersede itself.',
      });
    }

    let cursor = targetDecisionId;
    for (let depth = 0; depth < MAX_SUPERSESSION_DEPTH; depth++) {
      const parent = await this.decisionRepository.findOne({
        where: { id: cursor },
        select: ['id', 'supersedesDecisionId'],
      });
      if (!parent || !parent.supersedesDecisionId) {
        return; // Chain ends — no cycle
      }
      if (parent.supersedesDecisionId === currentDecisionId) {
        throw new BadRequestException({
          code: 'SUPERSESSION_CYCLE',
          message: 'This supersession would create a cycle.',
        });
      }
      cursor = parent.supersedesDecisionId;
    }

    throw new BadRequestException({
      code: 'SUPERSESSION_CHAIN_TOO_DEEP',
      message: 'Supersession chain exceeds maximum depth.',
    });
  }

  private async validateGoalInProject(goalId: string, projectId: string): Promise<void> {
    try {
      const goal = await this.goalRepository.findOne({
        where: { id: goalId, deletedAt: IsNull() },
        select: ['id', 'projectId'],
      });
      if (!goal) {
        throw new BadRequestException({
          code: 'INVALID_GOAL',
          message: 'Referenced goal not found in this project.',
        });
      }
      if (goal.projectId !== projectId) {
        throw new BadRequestException({
          code: 'INVALID_GOAL',
          message: 'Referenced goal does not belong to this project.',
        });
      }
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      if (
        (typeof err === 'object' && err !== null && 'code' in err && err.code === '22P02') ||
        (err instanceof Error && err.message.includes('invalid input syntax for type uuid'))
      ) {
        throw new BadRequestException({
          code: 'INVALID_GOAL',
          message: 'Referenced goal not found in this project.',
        });
      }
      throw err;
    }
  }
}
