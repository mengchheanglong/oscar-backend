import { measureGoalProgress } from './goal-progress';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Optional,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import {
  Goal,
  GoalCategory,
  GoalMetric,
  GoalReviewCadence,
  GoalRevision,
  GoalStatus,
} from './entities';
import {
  CreateGoalDto,
  CreateGoalMetricDto,
  ListGoalsQueryDto,
  UpdateGoalDto,
  UpdateGoalMetricDto,
} from './dto';
import { Task } from '../tasks/entities/task.entity';
import { Decision } from '../decisions/entities/decision.entity';
import { ProjectMember, ProjectRole } from '../projects/entities/project-member.entity';
import { User, SystemRole } from '../users/entities/user.entity';
import { Project, ProjectStatus } from '../projects/entities/project.entity';
import { AuditService } from '../audit/audit.service';

export interface MeasuredProgressBreakdown {
  measuredProgress: number;
  metricsProgress: number;
  milestonesProgress: number;
  tasksProgress: number;
}

@Injectable()
export class GoalsService {
  constructor(
    @InjectRepository(Goal)
    private readonly goalRepository: Repository<Goal>,
    @InjectRepository(GoalMetric)
    private readonly metricRepository: Repository<GoalMetric>,
    @InjectRepository(GoalRevision)
    private readonly revisionRepository: Repository<GoalRevision>,
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    @InjectRepository(Decision)
    private readonly decisionRepository: Repository<Decision>,
    @InjectRepository(ProjectMember)
    private readonly memberRepository: Repository<ProjectMember>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
    @Optional() @InjectRepository(Project) private readonly projectRepository?: Repository<Project>,
  ) {}

  async listUserGoals(
    userId: string,
    query: ListGoalsQueryDto,
  ): Promise<{ data: Goal[]; total: number }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const qb = this.goalRepository
      .createQueryBuilder('goal')
      .leftJoinAndSelect('goal.metrics', 'metric')
      .leftJoinAndSelect('goal.project', 'project')
      .where('goal.userId = :userId', { userId })
      .andWhere(
        '(goal.projectId IS NULL OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = goal.project_id AND pm.user_id = :userId AND pm.removed_at IS NULL))',
        { userId },
      )
      .andWhere('goal.deletedAt IS NULL');

    if (query.projectId) {
      qb.andWhere('goal.projectId = :projectId', { projectId: query.projectId });
    }
    if (query.status) {
      qb.andWhere('goal.status = :status', { status: query.status });
    }
    if (query.category) {
      qb.andWhere('goal.category = :category', { category: query.category });
    }
    if (query.q) {
      qb.andWhere('(goal.title ILIKE :q OR goal.description ILIKE :q)', {
        q: `%${query.q.trim()}%`,
      });
    }

    qb.orderBy('goal.createdAt', 'DESC');
    qb.skip((page - 1) * limit).take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async listProjectGoals(
    projectId: string,
    query: ListGoalsQueryDto,
  ): Promise<{ data: Goal[]; total: number }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const qb = this.goalRepository
      .createQueryBuilder('goal')
      .leftJoinAndSelect('goal.metrics', 'metric')
      .leftJoinAndSelect('goal.project', 'project')
      .where('goal.projectId = :projectId', { projectId })
      .andWhere('goal.deletedAt IS NULL');

    if (query.status) {
      qb.andWhere('goal.status = :status', { status: query.status });
    }
    if (query.category) {
      qb.andWhere('goal.category = :category', { category: query.category });
    }
    if (query.q) {
      qb.andWhere('(goal.title ILIKE :q OR goal.description ILIKE :q)', {
        q: `%${query.q.trim()}%`,
      });
    }

    qb.orderBy('goal.createdAt', 'DESC');
    qb.skip((page - 1) * limit).take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async getGoal(id: string, userId: string, projectId?: string): Promise<Goal> {
    const goal = await this.goalRepository.findOne({
      where: { id, deletedAt: IsNull() },
      relations: ['metrics', 'project'],
    });

    if (!goal) {
      throw new NotFoundException({
        code: 'GOAL_NOT_FOUND',
        message: 'Goal not found.',
      });
    }

    if (projectId && goal.projectId !== projectId) {
      throw new NotFoundException({
        code: 'GOAL_NOT_FOUND',
        message: 'Goal not found in this project.',
      });
    }

    // Access check: user owns it OR is a project member of the goal's project
    if (goal.projectId) {
      await this.validateUserProjectAccess(userId, goal.projectId);
    } else if (goal.userId !== userId) {
      if (!goal.projectId) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'You do not have access to this goal.',
        });
      }
      await this.validateUserProjectAccess(userId, goal.projectId);
    }

    return goal;
  }

  async getGoalSummary(
    id: string,
    userId: string,
    projectId?: string,
  ): Promise<{
    goal: Goal;
    breakdown: MeasuredProgressBreakdown;
    linkedTasks: Array<{
      id: string;
      number: number;
      title: string;
      status: string;
      priority: string;
      assigneeName?: string | null;
    }>;
    linkedDecisions: Array<{
      id: string;
      number: number;
      title: string;
      status: string;
      decidedAt?: string | null;
    }>;
  }> {
    const goal = await this.getGoal(id, userId, projectId);

    const [tasks, decisions] = await Promise.all([
      this.taskRepository.find({
        where: { goalId: id, projectId: goal.projectId ?? IsNull(), deletedAt: IsNull() },
        relations: ['assignee'],
        order: { number: 'ASC' },
      }),
      this.decisionRepository.find({
        where: { goalId: id, projectId: goal.projectId ?? IsNull(), deletedAt: IsNull() },
        order: { number: 'ASC' },
      }),
    ]);

    const breakdown = this.calculateMeasuredProgress(goal, goal.metrics || [], tasks);

    return {
      goal,
      breakdown,
      linkedTasks: tasks.map((t) => ({
        id: t.id,
        number: t.number,
        title: t.title,
        status: t.status,
        priority: t.priority,
        assigneeName: t.assignee?.displayName || null,
      })),
      linkedDecisions: decisions.map((d) => ({
        id: d.id,
        number: d.number,
        title: d.title,
        status: d.status,
        decidedAt: d.decidedAt ? d.decidedAt.toISOString() : null,
      })),
    };
  }

  async createGoal(
    userId: string,
    dto: CreateGoalDto,
    projectId?: string,
    actorId?: string,
    requestId?: string,
  ): Promise<Goal> {
    if (!dto.title.trim()) throw new BadRequestException('Enter a goal title.');
    const effectiveProjectId = projectId || dto.projectId || null;
    const actor = actorId || userId;

    if (effectiveProjectId) {
      await this.validateUserProjectAccess(actor, effectiveProjectId, [
        ProjectRole.OWNER,
        ProjectRole.MANAGER,
        ProjectRole.CONTRIBUTOR,
      ]);
    }

    return this.dataSource.transaction(async (manager) => {
      const goal = manager.create(Goal, {
        userId,
        projectId: effectiveProjectId,
        title: dto.title.trim(),
        description: dto.description?.trim() ?? null,
        motivation: dto.motivation?.trim() ?? null,
        status: dto.status ?? GoalStatus.ACTIVE,
        timeframe: dto.timeframe?.trim() ?? null,
        startDate: dto.startDate ?? null,
        targetDate: dto.targetDate ?? null,
        baseline: dto.baseline?.trim() ?? null,
        target: dto.target?.trim() ?? null,
        progress: dto.progress ?? 0,
        confidence: dto.confidence ?? null,
        category: dto.category ?? GoalCategory.BUSINESS,
        dependencies: dto.dependencies?.trim() ?? null,
        risks: dto.risks?.trim() ?? null,
        reviewCadence: dto.reviewCadence ?? GoalReviewCadence.WEEKLY,
        initiatives: (dto.initiatives ?? []).map((i) => ({
          id: i.id,
          title: i.title,
          description: i.description ?? null,
          status: i.status ?? 'TODO',
        })),
        milestones: (dto.milestones ?? []).map((m) => ({
          id: m.id,
          title: m.title,
          targetDate: m.targetDate ?? null,
          completed: m.completed ?? false,
          completedAt: m.completedAt ?? null,
        })),
        version: 1,
        deletedAt: null,
      });

      const saved = await manager.save(Goal, goal);

      // Create initial revision
      const revision = manager.create(GoalRevision, {
        goalId: saved.id,
        version: 1,
        title: saved.title,
        status: saved.status,
        progress: saved.progress,
        target: saved.target,
        changedBy: actor,
        reason: 'Initial goal creation',
        snapshot: {
          title: saved.title,
          status: saved.status,
          target: saved.target,
          progress: saved.progress,
          milestones: saved.milestones,
          initiatives: saved.initiatives,
          description: saved.description,
          motivation: saved.motivation,
          timeframe: saved.timeframe,
          startDate: saved.startDate,
          targetDate: saved.targetDate,
          baseline: saved.baseline,
          confidence: saved.confidence,
          category: saved.category,
          dependencies: saved.dependencies,
          risks: saved.risks,
          reviewCadence: saved.reviewCadence,
        },
      });
      await manager.save(GoalRevision, revision);

      await this.auditService.record(
        {
          projectId: effectiveProjectId,
          actorId: actor,
          action: 'GOAL_CREATED',
          entityType: 'GOAL',
          entityId: saved.id,
          metadata: { title: saved.title, category: saved.category },
          requestId,
        },
        manager,
      );

      return saved;
    });
  }

  async updateGoal(
    id: string,
    userId: string,
    dto: UpdateGoalDto,
    projectId?: string,
    actorId?: string,
    requestId?: string,
  ): Promise<Goal> {
    const actor = actorId || userId;
    const goal = await this.getGoal(id, userId, projectId);
    await this.validateGoalMutationAccess(goal, actor);

    if (goal.version !== dto.version) {
      throw new ConflictException({
        code: 'CONCURRENCY_CONFLICT',
        message: 'Goal has been modified by another request. Please reload.',
      });
    }

    if (dto.title !== undefined) {
      if (dto.title.trim().length === 0) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Goal title cannot be empty or whitespace.',
        });
      }
      goal.title = dto.title.trim();
    }
    if (dto.description !== undefined) {
      goal.description = dto.description ? dto.description.trim() : null;
    }
    if (dto.motivation !== undefined) {
      goal.motivation = dto.motivation ? dto.motivation.trim() : null;
    }
    if (dto.status !== undefined) goal.status = dto.status;
    if (dto.timeframe !== undefined) goal.timeframe = dto.timeframe ? dto.timeframe.trim() : null;
    if (dto.startDate !== undefined) goal.startDate = dto.startDate;
    if (dto.targetDate !== undefined) goal.targetDate = dto.targetDate;
    if (dto.baseline !== undefined) goal.baseline = dto.baseline ? dto.baseline.trim() : null;
    if (dto.target !== undefined) goal.target = dto.target ? dto.target.trim() : null;
    if (dto.progress !== undefined) goal.progress = dto.progress;
    if (dto.confidence !== undefined) goal.confidence = dto.confidence;
    if (dto.category !== undefined) goal.category = dto.category;
    if (dto.dependencies !== undefined) {
      goal.dependencies = dto.dependencies ? dto.dependencies.trim() : null;
    }
    if (dto.risks !== undefined) goal.risks = dto.risks ? dto.risks.trim() : null;
    if (dto.reviewCadence !== undefined) goal.reviewCadence = dto.reviewCadence;
    if (dto.milestones !== undefined) {
      goal.milestones = dto.milestones.map((m) => ({
        id: m.id,
        title: m.title,
        targetDate: m.targetDate ?? null,
        completed: m.completed ?? false,
        completedAt: m.completedAt ?? null,
      }));
    }
    if (dto.initiatives !== undefined) {
      goal.initiatives = dto.initiatives.map((i) => ({
        id: i.id,
        title: i.title,
        description: i.description ?? null,
        status: i.status ?? 'TODO',
      }));
    }
    if (dto.projectId !== undefined && dto.projectId !== goal.projectId) {
      throw new BadRequestException(
        'Goal scope is fixed. Create a goal in the destination project to preserve source permissions.',
      );
    }
    if (dto.projectId !== undefined) {
      if (dto.projectId !== null) {
        await this.validateUserProjectAccess(actor, dto.projectId, [
          ProjectRole.OWNER,
          ProjectRole.MANAGER,
          ProjectRole.CONTRIBUTOR,
        ]);
      }
      goal.projectId = dto.projectId;
    }

    return this.dataSource.transaction(async (manager) => {
      const keys = [
        'title',
        'description',
        'motivation',
        'status',
        'timeframe',
        'startDate',
        'targetDate',
        'baseline',
        'target',
        'progress',
        'confidence',
        'category',
        'dependencies',
        'risks',
        'reviewCadence',
        'initiatives',
        'milestones',
      ] as const;
      const columns = Object.fromEntries(keys.map((key) => [key, goal[key]]));
      const saved = { ...goal, version: goal.version + 1 };
      const changed = await manager.update(
        Goal,
        { id, version: dto.version, deletedAt: IsNull() },
        { ...columns, version: saved.version },
      );
      if (changed.affected !== 1)
        throw new ConflictException('Goal changed. Refresh before saving.');

      // Record revision
      const revision = manager.create(GoalRevision, {
        goalId: saved.id,
        version: saved.version,
        title: saved.title,
        status: saved.status,
        progress: saved.progress,
        target: saved.target,
        changedBy: actor,
        reason: dto.revisionReason || 'Goal updated',
        snapshot: {
          title: saved.title,
          status: saved.status,
          target: saved.target,
          progress: saved.progress,
          milestones: saved.milestones,
          initiatives: saved.initiatives,
          description: saved.description,
          motivation: saved.motivation,
          timeframe: saved.timeframe,
          startDate: saved.startDate,
          targetDate: saved.targetDate,
          baseline: saved.baseline,
          confidence: saved.confidence,
          category: saved.category,
          dependencies: saved.dependencies,
          risks: saved.risks,
          reviewCadence: saved.reviewCadence,
        },
      });
      await manager.save(GoalRevision, revision);

      await this.auditService.record(
        {
          projectId: saved.projectId,
          actorId: actor,
          action: 'GOAL_UPDATED',
          entityType: 'GOAL',
          entityId: saved.id,
          metadata: { version: saved.version, status: saved.status },
          requestId,
        },
        manager,
      );

      return saved;
    });
  }

  async deleteGoal(
    id: string,
    userId: string,
    projectId?: string,
    actorId?: string,
    requestId?: string,
  ): Promise<void> {
    const actor = actorId || userId;
    const goal = await this.getGoal(id, userId, projectId);
    await this.validateGoalMutationAccess(goal, actor);

    goal.deletedAt = new Date();
    await this.goalRepository.save(goal);

    await this.auditService.record({
      projectId: goal.projectId,
      actorId: actor,
      action: 'GOAL_DELETED',
      entityType: 'GOAL',
      entityId: goal.id,
      metadata: { title: goal.title },
      requestId,
    });
  }

  async addMetric(
    goalId: string,
    userId: string,
    dto: CreateGoalMetricDto,
    projectId?: string,
    actorId?: string,
    requestId?: string,
  ): Promise<GoalMetric> {
    const actor = actorId || userId;
    const goal = await this.getGoal(goalId, userId, projectId);
    await this.validateGoalMutationAccess(goal, actor);

    const metric = this.metricRepository.create({
      goalId: goal.id,
      name: dto.name.trim(),
      unit: dto.unit.trim(),
      baselineValue: dto.baselineValue ?? 0,
      currentValue: dto.currentValue ?? 0,
      targetValue: dto.targetValue,
      observationDate: dto.observationDate ?? null,
      notes: dto.notes ? dto.notes.trim() : null,
    });

    const saved = await this.metricRepository.save(metric);

    await this.auditService.record({
      projectId: goal.projectId,
      actorId: actor,
      action: 'GOAL_METRIC_ADDED',
      entityType: 'GOAL_METRIC',
      entityId: saved.id,
      metadata: { goalId: goal.id, metricName: saved.name },
      requestId,
    });

    return saved;
  }

  async updateMetric(
    goalId: string,
    metricId: string,
    userId: string,
    dto: UpdateGoalMetricDto,
    projectId?: string,
    actorId?: string,
    requestId?: string,
  ): Promise<GoalMetric> {
    const actor = actorId || userId;
    const goal = await this.getGoal(goalId, userId, projectId);
    await this.validateGoalMutationAccess(goal, actor);

    const metric = await this.metricRepository.findOne({
      where: { id: metricId, goalId: goal.id },
    });

    if (!metric) {
      throw new NotFoundException({
        code: 'METRIC_NOT_FOUND',
        message: 'Goal metric not found.',
      });
    }

    if (dto.name !== undefined) metric.name = dto.name.trim();
    if (dto.unit !== undefined) metric.unit = dto.unit.trim();
    if (dto.baselineValue !== undefined) metric.baselineValue = dto.baselineValue;
    if (dto.currentValue !== undefined) metric.currentValue = dto.currentValue;
    if (dto.targetValue !== undefined) metric.targetValue = dto.targetValue;
    if (dto.observationDate !== undefined) metric.observationDate = dto.observationDate;
    if (dto.notes !== undefined) metric.notes = dto.notes ? dto.notes.trim() : null;

    const saved = await this.metricRepository.save(metric);

    await this.auditService.record({
      projectId: goal.projectId,
      actorId: actor,
      action: 'GOAL_METRIC_UPDATED',
      entityType: 'GOAL_METRIC',
      entityId: saved.id,
      metadata: { goalId: goal.id, metricName: saved.name, currentValue: saved.currentValue },
      requestId,
    });

    return saved;
  }

  async deleteMetric(
    goalId: string,
    metricId: string,
    userId: string,
    projectId?: string,
    actorId?: string,
    requestId?: string,
  ): Promise<void> {
    const actor = actorId || userId;
    const goal = await this.getGoal(goalId, userId, projectId);
    await this.validateGoalMutationAccess(goal, actor);

    const metric = await this.metricRepository.findOne({
      where: { id: metricId, goalId: goal.id },
    });

    if (!metric) {
      throw new NotFoundException({
        code: 'METRIC_NOT_FOUND',
        message: 'Goal metric not found.',
      });
    }

    await this.metricRepository.remove(metric);

    await this.auditService.record({
      projectId: goal.projectId,
      actorId: actor,
      action: 'GOAL_METRIC_DELETED',
      entityType: 'GOAL_METRIC',
      entityId: metricId,
      metadata: { goalId: goal.id, metricName: metric.name },
      requestId,
    });
  }

  async listRevisions(goalId: string, userId: string, projectId?: string): Promise<GoalRevision[]> {
    const goal = await this.getGoal(goalId, userId, projectId);

    return this.revisionRepository.find({
      where: { goalId: goal.id },
      order: { version: 'DESC' },
    });
  }

  calculateMeasuredProgress(
    goal: Goal,
    metrics: GoalMetric[] = [],
    tasks: Task[] = [],
  ): MeasuredProgressBreakdown {
    return measureGoalProgress(goal, metrics, tasks);
  }

  async getActiveGoalsForScope(
    userId: string,
    projectIds: string[] = [],
    limit = 5,
  ): Promise<Goal[]> {
    const qb = this.goalRepository
      .createQueryBuilder('goal')
      .leftJoinAndSelect('goal.metrics', 'metric')
      .where('goal.status IN (:...statuses)', { statuses: [GoalStatus.ACTIVE, GoalStatus.PLANNED] })
      .andWhere('goal.deletedAt IS NULL');

    if (projectIds.length > 0) {
      qb.andWhere(
        '(goal.projectId IN (:...projectIds) OR (goal.userId = :userId AND goal.projectId IS NULL))',
        {
          projectIds,
          userId,
        },
      );
    } else {
      qb.andWhere('goal.userId = :userId AND goal.projectId IS NULL', { userId });
    }

    qb.orderBy('goal.updatedAt', 'DESC');
    qb.take(limit);

    return qb.getMany();
  }

  private async validateGoalMutationAccess(goal: Goal, actorId: string): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: actorId } });
    if (goal.project?.status === ProjectStatus.ARCHIVED)
      throw new BadRequestException('This project is archived and read-only.');
    if (user?.systemRole === SystemRole.ADMIN) return;

    if (!goal.projectId) {
      if (goal.userId !== actorId) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'You do not have permission to modify this personal goal.',
        });
      }
      return;
    }

    await this.validateUserProjectAccess(actorId, goal.projectId, [
      ProjectRole.OWNER,
      ProjectRole.MANAGER,
      ProjectRole.CONTRIBUTOR,
    ]);
  }

  private async validateUserProjectAccess(
    userId: string,
    projectId: string,
    requiredRoles?: ProjectRole[],
  ): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (user?.systemRole === SystemRole.ADMIN) {
      if (
        requiredRoles?.length &&
        (await this.projectRepository?.findOne({ where: { id: projectId } }))?.status ===
          ProjectStatus.ARCHIVED
      )
        throw new BadRequestException('This project is archived and read-only.');
      return;
    }

    const member = await this.memberRepository.findOne({
      where: { userId, projectId, removedAt: IsNull() },
      relations: ['project'],
    });

    if (!member) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have access to this project.',
      });
    }

    if (requiredRoles?.length && member.project?.status === ProjectStatus.ARCHIVED) {
      throw new BadRequestException({
        code: 'PROJECT_ARCHIVED',
        message: 'This project is archived and read-only.',
      });
    }
    if (requiredRoles && requiredRoles.length > 0) {
      if (!requiredRoles.includes(member.accessRole)) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'You do not have permission to perform this action in this project.',
        });
      }
    }
  }
}
