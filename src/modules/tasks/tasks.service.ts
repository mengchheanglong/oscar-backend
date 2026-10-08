import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Raw, Repository, SelectQueryBuilder } from 'typeorm';
import { AIProposal, ProposalStatus } from '../ai/entities/proposal.entity';
import { TaskProposalPayloadSchema } from '../ai/dto/task-proposal.dto';
import { Task, TaskStatus, Priority } from './entities/task.entity';
import { Project } from '../projects/entities/project.entity';
import { ProjectMember, ProjectRole } from '../projects/entities/project-member.entity';
import { Requirement } from '../requirements/entities/requirement.entity';
import { Meeting } from '../meetings/entities/meeting.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../ingestion/outbox.service';

const SORT_COLUMN_MAP: Record<string, string> = {
  number: 'task.number',
  title: 'task.title',
  status: 'task.status',
  priority: 'task.priority',
  dueDate: 'task.dueDate',
  createdAt: 'task.createdAt',
  updatedAt: 'task.updatedAt',
};

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(ProjectMember)
    private readonly memberRepository: Repository<ProjectMember>,
    @InjectRepository(Requirement)
    private readonly requirementRepository: Repository<Requirement>,
    @InjectRepository(Meeting)
    private readonly meetingRepository: Repository<Meeting>,
    private readonly auditService: AuditService,
    private readonly outboxService: OutboxService,
    private readonly dataSource: DataSource,
  ) {}

  async create(
    projectId: string,
    actorId: string,
    dto: CreateTaskDto,
    requestId?: string,
  ): Promise<Task> {
    if (!dto.title || dto.title.trim().length === 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Task title cannot be empty or whitespace.',
      });
    }
    if (dto.assigneeId) {
      await this.validateAssigneeInProject(dto.assigneeId, projectId);
    }
    if (dto.requirementId) {
      await this.validateRequirementInProject(dto.requirementId, projectId);
    }
    if (dto.sourceMeetingId) {
      await this.validateMeetingInProject(dto.sourceMeetingId, projectId);
    }

    return this.dataSource.transaction(async (manager) => {
      const result: { max: number | null }[] = await manager.query(
        `SELECT MAX("number") as max FROM "tasks" WHERE "project_id" = $1`,
        [projectId],
      );
      const nextNumber = (result[0]?.max ?? 0) + 1;

      const task = manager.create(Task, {
        projectId,
        number: nextNumber,
        title: dto.title.trim(),
        description: dto.description?.trim() ?? null,
        status: dto.status ?? TaskStatus.TODO,
        priority: dto.priority ?? Priority.MEDIUM,
        blockedReason: dto.blockedReason ? dto.blockedReason.trim() : null,
        assigneeId: dto.assigneeId ?? null,
        dueDate: dto.dueDate ?? null,
        requirementId: dto.requirementId ?? null,
        sourceMeetingId: dto.sourceMeetingId ?? null,
        createdBy: actorId,
        updatedBy: actorId,
        version: 1,
        deletedAt: null,
      });

      const saved = await manager.save(Task, task);

      await this.outboxService.emit(manager, {
        projectId,
        eventType: 'TASK_CREATED',
        payload: {
          taskId: saved.id,
          revision: 1,
          title: saved.title,
          description: saved.description,
          status: saved.status,
          priority: saved.priority,
          dueDate: saved.dueDate,
        },
        dedupeKey: `task:${saved.id}:1:created`,
      });

      await this.auditService.record({
        projectId,
        actorId,
        action: 'TASK_CREATED',
        entityType: 'TASK',
        entityId: saved.id,
        metadata: { number: saved.number, title: saved.title },
        requestId,
      });

      if (saved.assigneeId) {
        await this.auditService.record({
          projectId,
          actorId,
          action: 'TASK_ASSIGNED',
          entityType: 'TASK',
          entityId: saved.id,
          metadata: { assigneeId: saved.assigneeId },
          requestId,
        });
      }

      return saved;
    });
  }

  async list(
    projectId: string,
    query: ListTasksQueryDto,
  ): Promise<{ data: Task[]; total: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 100;
    const sortBy = query.sortBy ?? 'number';
    const sortOrder = query.sortOrder ?? 'DESC';

    const qb: SelectQueryBuilder<Task> = this.taskRepository.createQueryBuilder('task');
    if (typeof qb.leftJoinAndSelect === 'function') {
      qb.leftJoinAndSelect('task.assignee', 'assignee');
      qb.leftJoinAndSelect('task.project', 'project');
    }
    qb.where('task.projectId = :projectId', { projectId }).andWhere('task.deletedAt IS NULL');

    if (query.number !== undefined) {
      qb.andWhere('task.number = :number', { number: query.number });
    }
    if (query.status) {
      qb.andWhere('task.status = :status', { status: query.status });
    }
    if (query.priority) {
      qb.andWhere('task.priority = :priority', { priority: query.priority });
    }
    if (query.assigneeId) {
      qb.andWhere('task.assigneeId = :assigneeId', { assigneeId: query.assigneeId });
    }
    if (query.requirementId) {
      qb.andWhere('task.requirementId = :requirementId', { requirementId: query.requirementId });
    }
    if (query.sourceMeetingId) {
      qb.andWhere('task.sourceMeetingId = :sourceMeetingId', {
        sourceMeetingId: query.sourceMeetingId,
      });
    }
    if (query.search) {
      qb.andWhere(
        `to_tsvector('english', coalesce(task.title, '') || ' ' || coalesce(task.description, '')) @@ plainto_tsquery('english', :search)`,
        { search: query.search },
      );
    }

    const sortColumn = SORT_COLUMN_MAP[sortBy] ?? 'task.number';
    qb.orderBy(sortColumn, sortOrder).addOrderBy('task.id', 'ASC');

    qb.skip((page - 1) * pageSize).take(pageSize);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async listAllUserTasks(
    userId: string,
    query: ListTasksQueryDto,
  ): Promise<{ data: Task[]; total: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 100;
    const sortBy = query.sortBy ?? 'number';
    const sortOrder = query.sortOrder ?? 'DESC';

    const memberships = await this.memberRepository.find({
      where: { userId },
      select: ['projectId'],
    });

    if (memberships.length === 0) {
      return { data: [], total: 0 };
    }

    const projectIds = memberships.map((m) => m.projectId);
    let targetProjectIds = projectIds;
    if (query.projectId && query.projectId !== 'ALL') {
      if (!projectIds.includes(query.projectId)) {
        return { data: [], total: 0 };
      }
      targetProjectIds = [query.projectId];
    }

    const qb: SelectQueryBuilder<Task> = this.taskRepository.createQueryBuilder('task');
    if (typeof qb.leftJoinAndSelect === 'function') {
      qb.leftJoinAndSelect('task.assignee', 'assignee');
      qb.leftJoinAndSelect('task.project', 'project');
    }
    qb.where('task.projectId IN (:...targetProjectIds)', { targetProjectIds }).andWhere(
      'task.deletedAt IS NULL',
    );

    if (query.number !== undefined) {
      qb.andWhere('task.number = :number', { number: query.number });
    }
    if (query.status) {
      qb.andWhere('task.status = :status', { status: query.status });
    }
    if (query.priority) {
      qb.andWhere('task.priority = :priority', { priority: query.priority });
    }
    if (query.assigneeId) {
      qb.andWhere('task.assigneeId = :assigneeId', { assigneeId: query.assigneeId });
    }
    if (query.search) {
      qb.andWhere(
        `to_tsvector('english', coalesce(task.title, '') || ' ' || coalesce(task.description, '')) @@ plainto_tsquery('english', :search)`,
        { search: query.search },
      );
    }

    const sortColumn = SORT_COLUMN_MAP[sortBy] ?? 'task.number';
    qb.orderBy(sortColumn, sortOrder).addOrderBy('task.id', 'ASC');

    qb.skip((page - 1) * pageSize).take(pageSize);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async getById(projectId: string, taskId: string): Promise<Task> {
    const task = await this.taskRepository.findOne({
      where: { id: taskId, projectId, deletedAt: IsNull() },
      relations: ['assignee', 'project'],
    });
    if (!task) {
      throw new NotFoundException({
        code: 'TASK_NOT_FOUND',
        message: 'Task not found.',
      });
    }
    return task;
  }

  async getAiProvenance(projectId: string, taskId: string) {
    const proposal = await this.dataSource.getRepository(AIProposal).findOne({
      where: {
        projectId,
        status: ProposalStatus.CONFIRMED,
        resultRecordIds: Raw((alias) => `${alias} @> CAST(:record AS jsonb)`, {
          record: JSON.stringify([{ entityType: 'TASK', id: taskId }]),
        }),
      },
    });
    if (!proposal) return null;
    const draft = TaskProposalPayloadSchema.safeParse(proposal.draftJson);
    // Expose only public source identifiers, never another user's private draft.
    return {
      proposalId: proposal.id,
      sourceEntityType: proposal.sourceEntityType,
      sourceEntityId: proposal.sourceEntityId,
      sourceRevision: proposal.sourceRevision,
      sourceReferences: draft.success ? draft.data.sourceReferences || [] : [],
    };
  }

  async update(
    projectId: string,
    taskId: string,
    actorId: string,
    dto: UpdateTaskDto,
    requestId?: string,
  ): Promise<Task> {
    const task = await this.getById(projectId, taskId);

    if (task.version !== dto.version) {
      throw new ConflictException({
        code: 'CONCURRENCY_CONFLICT',
        message: 'Task has been modified by another request. Please reload.',
      });
    }

    if (dto.assigneeId !== undefined && dto.assigneeId !== null) {
      await this.validateAssigneeInProject(dto.assigneeId, projectId);
    }
    if (dto.requirementId !== undefined && dto.requirementId !== null) {
      await this.validateRequirementInProject(dto.requirementId, projectId);
    }
    if (dto.sourceMeetingId !== undefined && dto.sourceMeetingId !== null) {
      await this.validateMeetingInProject(dto.sourceMeetingId, projectId);
    }

    const previousAssigneeId = task.assigneeId;
    const previousStatus = task.status;

    if (dto.title !== undefined) {
      if (dto.title.trim().length === 0) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Task title cannot be empty or whitespace.',
        });
      }
      task.title = dto.title.trim();
    }
    if (dto.description !== undefined) {
      task.description = dto.description ? dto.description.trim() : null;
    }
    if (dto.status !== undefined) task.status = dto.status;
    if (dto.priority !== undefined) task.priority = dto.priority;
    if (dto.blockedReason !== undefined) {
      task.blockedReason = dto.blockedReason ? dto.blockedReason.trim() : null;
    } else if (dto.status !== undefined && dto.status !== TaskStatus.BLOCKED) {
      task.blockedReason = null;
    }
    if (dto.assigneeId !== undefined) task.assigneeId = dto.assigneeId;
    if (dto.dueDate !== undefined) task.dueDate = dto.dueDate;
    if (dto.requirementId !== undefined) task.requirementId = dto.requirementId;
    task.updatedBy = actorId;

    const saved = await this.taskRepository.save(task);

    await this.outboxService.emit({
      projectId,
      eventType: 'TASK_UPDATED',
      payload: {
        taskId: saved.id,
        revision: saved.version,
        title: saved.title,
        description: saved.description,
        status: saved.status,
        priority: saved.priority,
        dueDate: saved.dueDate,
      },
      dedupeKey: `task:${saved.id}:${saved.version}:updated`,
    });

    await this.auditService.record({
      projectId,
      actorId,
      action: 'TASK_UPDATED',
      entityType: 'TASK',
      entityId: saved.id,
      metadata: { number: saved.number, version: saved.version },
      requestId,
    });

    if (dto.assigneeId !== undefined && dto.assigneeId !== previousAssigneeId) {
      await this.auditService.record({
        projectId,
        actorId,
        action: 'TASK_ASSIGNED',
        entityType: 'TASK',
        entityId: saved.id,
        metadata: { assigneeId: saved.assigneeId, previousAssigneeId },
        requestId,
      });
    }

    if (dto.status !== undefined && dto.status !== previousStatus) {
      await this.auditService.record({
        projectId,
        actorId,
        action: 'TASK_STATUS_CHANGED',
        entityType: 'TASK',
        entityId: saved.id,
        metadata: { status: saved.status, previousStatus },
        requestId,
      });
    }

    return saved;
  }

  async softDelete(
    projectId: string,
    taskId: string,
    actorId: string,
    actorRole: ProjectRole,
    requestId?: string,
  ): Promise<void> {
    const task = await this.getById(projectId, taskId);

    if (actorRole === ProjectRole.CONTRIBUTOR && task.createdBy !== actorId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You can only delete tasks you created.',
      });
    }

    task.deletedAt = new Date();
    task.updatedBy = actorId;
    await this.taskRepository.save(task);

    await this.outboxService.emit({
      projectId,
      eventType: 'TASK_DELETED',
      payload: {
        taskId: task.id,
      },
      dedupeKey: `task:${task.id}:deleted`,
    });

    await this.auditService.record({
      projectId,
      actorId,
      action: 'TASK_DELETED',
      entityType: 'TASK',
      entityId: task.id,
      metadata: { number: task.number },
      requestId,
    });
  }

  async listForRequirement(projectId: string, requirementId: string): Promise<Task[]> {
    return this.taskRepository.find({
      where: { projectId, requirementId, deletedAt: IsNull() },
      order: { number: 'ASC' },
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

  private async validateAssigneeInProject(userId: string, projectId: string): Promise<void> {
    try {
      const membership = await this.memberRepository.findOne({
        where: { projectId, userId, removedAt: IsNull() },
      });
      if (!membership) {
        throw new BadRequestException({
          code: 'INVALID_ASSIGNEE',
          message: 'Assignee must be an active member of this project.',
        });
      }
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      if (
        (typeof err === 'object' && err !== null && 'code' in err && err.code === '22P02') ||
        (err instanceof Error && err.message.includes('invalid input syntax for type uuid'))
      ) {
        throw new BadRequestException({
          code: 'INVALID_ASSIGNEE',
          message: 'Assignee must be an active member of this project.',
        });
      }
      throw err;
    }
  }

  private async validateRequirementInProject(
    requirementId: string,
    projectId: string,
  ): Promise<void> {
    try {
      const requirement = await this.requirementRepository.findOne({
        where: { id: requirementId, projectId, deletedAt: IsNull() },
        select: ['id'],
      });
      if (!requirement) {
        throw new BadRequestException({
          code: 'INVALID_REQUIREMENT',
          message: 'Linked requirement not found in this project.',
        });
      }
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      if (
        (typeof err === 'object' && err !== null && 'code' in err && err.code === '22P02') ||
        (err instanceof Error && err.message.includes('invalid input syntax for type uuid'))
      ) {
        throw new BadRequestException({
          code: 'INVALID_REQUIREMENT',
          message: 'Linked requirement not found in this project.',
        });
      }
      throw err;
    }
  }

  private async validateMeetingInProject(meetingId: string, projectId: string): Promise<void> {
    try {
      const meeting = await this.meetingRepository.findOne({
        where: { id: meetingId, projectId, deletedAt: IsNull() },
        select: ['id'],
      });
      if (!meeting) {
        throw new BadRequestException({
          code: 'INVALID_MEETING',
          message: 'Linked meeting not found in this project.',
        });
      }
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      if (
        (typeof err === 'object' && err !== null && 'code' in err && err.code === '22P02') ||
        (err instanceof Error && err.message.includes('invalid input syntax for type uuid'))
      ) {
        throw new BadRequestException({
          code: 'INVALID_MEETING',
          message: 'Linked meeting not found in this project.',
        });
      }
      throw err;
    }
  }
}
