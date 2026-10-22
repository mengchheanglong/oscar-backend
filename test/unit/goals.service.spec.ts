import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { GoalsService } from '../../src/modules/goals/goals.service';
import {
  Goal,
  GoalCategory,
  GoalConfidence,
  GoalMetric,
  GoalReviewCadence,
  GoalRevision,
  GoalStatus,
} from '../../src/modules/goals/entities';
import { Task, TaskStatus } from '../../src/modules/tasks/entities/task.entity';
import { Decision } from '../../src/modules/decisions/entities/decision.entity';
import {
  ProjectMember,
  ProjectRole,
} from '../../src/modules/projects/entities/project-member.entity';
import { SystemRole, User } from '../../src/modules/users/entities/user.entity';
import { AuditService } from '../../src/modules/audit/audit.service';
import { DataSource } from 'typeorm';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_USER_ID = '22222222-2222-2222-2222-222222222222';
const PROJECT_ID = '33333333-3333-3333-3333-333333333333';
const GOAL_ID = '44444444-4444-4444-4444-444444444444';
const METRIC_ID = '55555555-5555-5555-5555-555555555555';

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: GOAL_ID,
    userId: USER_ID,
    projectId: PROJECT_ID,
    title: 'Validate product with paying customers',
    description: 'Find 10 initial paying customers',
    motivation: 'Establish commercial validation',
    status: GoalStatus.ACTIVE,
    timeframe: 'Q4 2026',
    startDate: '2026-10-01',
    targetDate: '2026-12-31',
    baseline: '0 customers',
    target: '10 customers',
    progress: 20,
    confidence: GoalConfidence.HIGH,
    category: GoalCategory.BUSINESS,
    dependencies: 'Stripe integration',
    risks: 'Customer churn',
    reviewCadence: GoalReviewCadence.WEEKLY,
    initiatives: [{ id: 'init-1', title: 'Launch landing page', status: 'DONE' }],
    milestones: [
      { id: 'm-1', title: 'Beta launch', completed: true, completedAt: '2026-10-10' },
      { id: 'm-2', title: 'Payment setup', completed: false },
    ],
    version: 1,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    metrics: [],
    revisions: [],
    ...overrides,
  } as Goal;
}

describe('GoalsService (Unit)', () => {
  let service: GoalsService;

  const mockGoalRepo = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  const mockMetricRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
  };

  const mockRevisionRepo = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
  };

  const mockTaskRepo = {
    find: jest.fn(),
  };

  const mockDecisionRepo = {
    find: jest.fn(),
  };

  const mockMemberRepo = {
    findOne: jest.fn(),
  };

  const mockUserRepo = {
    findOne: jest.fn(),
  };

  const mockAuditService = {
    record: jest.fn(),
  };

  const mockDataSource = {
    transaction: jest.fn(async (cb: (manager: unknown) => Promise<unknown>) => {
      const mockManager = {
        update: jest.fn(async () => ({ affected: 1 })),
        create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({
          ...data,
          id: data.id || GOAL_ID,
        })),
        save: jest.fn(async (_entity: unknown, data: unknown) => data),
      };
      return cb(mockManager);
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoalsService,
        { provide: getRepositoryToken(Goal), useValue: mockGoalRepo },
        { provide: getRepositoryToken(GoalMetric), useValue: mockMetricRepo },
        { provide: getRepositoryToken(GoalRevision), useValue: mockRevisionRepo },
        { provide: getRepositoryToken(Task), useValue: mockTaskRepo },
        { provide: getRepositoryToken(Decision), useValue: mockDecisionRepo },
        { provide: getRepositoryToken(ProjectMember), useValue: mockMemberRepo },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: AuditService, useValue: mockAuditService },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<GoalsService>(GoalsService);
  });

  describe('createGoal', () => {
    it('creates goal with initial revision and audit record', async () => {
      mockUserRepo.findOne.mockResolvedValue({ id: USER_ID, systemRole: SystemRole.USER });
      mockMemberRepo.findOne.mockResolvedValue({
        userId: USER_ID,
        projectId: PROJECT_ID,
        accessRole: ProjectRole.CONTRIBUTOR,
      });

      const result = await service.createGoal(
        USER_ID,
        {
          title: 'Validate product',
          category: GoalCategory.BUSINESS,
          target: '10 customers',
          milestones: [{ id: 'm-1', title: 'Beta test', completed: false }],
        },
        PROJECT_ID,
      );

      expect(result).toBeDefined();
      expect(result.title).toBe('Validate product');
      expect(mockAuditService.record).toHaveBeenCalled();
    });
  });

  describe('getGoal & authorization', () => {
    it('returns goal if user is the owner', async () => {
      const goal = makeGoal({ userId: USER_ID });
      mockGoalRepo.findOne.mockResolvedValue(goal);

      const found = await service.getGoal(GOAL_ID, USER_ID);
      expect(found.id).toBe(GOAL_ID);
    });

    it('throws NotFoundException if goal does not exist', async () => {
      mockGoalRepo.findOne.mockResolvedValue(null);

      await expect(service.getGoal('non-existent', USER_ID)).rejects.toThrow(NotFoundException);
    });

    it('allows access to non-owner if they are a project member', async () => {
      const goal = makeGoal({ userId: USER_ID, projectId: PROJECT_ID });
      mockGoalRepo.findOne.mockResolvedValue(goal);
      mockUserRepo.findOne.mockResolvedValue({ id: OTHER_USER_ID, systemRole: SystemRole.USER });
      mockMemberRepo.findOne.mockResolvedValue({ userId: OTHER_USER_ID, projectId: PROJECT_ID });

      const found = await service.getGoal(GOAL_ID, OTHER_USER_ID);
      expect(found.id).toBe(GOAL_ID);
    });

    it('denies access to non-owner non-member', async () => {
      const goal = makeGoal({ userId: USER_ID, projectId: PROJECT_ID });
      mockGoalRepo.findOne.mockResolvedValue(goal);
      mockUserRepo.findOne.mockResolvedValue({ id: OTHER_USER_ID, systemRole: SystemRole.USER });
      mockMemberRepo.findOne.mockResolvedValue(null);

      await expect(service.getGoal(GOAL_ID, OTHER_USER_ID)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateGoal', () => {
    it('enforces optimistic concurrency locking', async () => {
      const goal = makeGoal({ version: 2 });
      mockGoalRepo.findOne.mockResolvedValue(goal);
      mockUserRepo.findOne.mockResolvedValue({ id: USER_ID, systemRole: SystemRole.USER });
      mockMemberRepo.findOne.mockResolvedValue({
        userId: USER_ID,
        projectId: PROJECT_ID,
        accessRole: ProjectRole.CONTRIBUTOR,
      });

      await expect(
        service.updateGoal(GOAL_ID, USER_ID, { version: 1, title: 'Updated' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects goal update by a project VIEWER with 403 Forbidden', async () => {
      const goal = makeGoal({ version: 1 });
      mockGoalRepo.findOne.mockResolvedValue(goal);
      mockUserRepo.findOne.mockResolvedValue({ id: OTHER_USER_ID, systemRole: SystemRole.USER });
      mockMemberRepo.findOne.mockResolvedValue({
        userId: OTHER_USER_ID,
        projectId: PROJECT_ID,
        accessRole: ProjectRole.VIEWER,
      });

      await expect(
        service.updateGoal(GOAL_ID, OTHER_USER_ID, { version: 1, title: 'Updated' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects personal goal update by non-owner with 403 Forbidden', async () => {
      const goal = makeGoal({ version: 1, projectId: null });
      mockGoalRepo.findOne.mockResolvedValue(goal);
      mockUserRepo.findOne.mockResolvedValue({ id: OTHER_USER_ID, systemRole: SystemRole.USER });

      await expect(
        service.updateGoal(GOAL_ID, OTHER_USER_ID, { version: 1, title: 'Updated' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('metrics management', () => {
    it('adds a metric to a goal', async () => {
      const goal = makeGoal();
      mockGoalRepo.findOne.mockResolvedValue(goal);
      mockUserRepo.findOne.mockResolvedValue({ id: USER_ID, systemRole: SystemRole.USER });
      mockMemberRepo.findOne.mockResolvedValue({
        userId: USER_ID,
        projectId: PROJECT_ID,
        accessRole: ProjectRole.CONTRIBUTOR,
      });
      mockMetricRepo.create.mockImplementation((dto) => dto);
      mockMetricRepo.save.mockImplementation(async (dto) => ({ ...dto, id: METRIC_ID }));

      const metric = await service.addMetric(GOAL_ID, USER_ID, {
        name: 'Paying Customers',
        unit: 'users',
        baselineValue: 0,
        currentValue: 5,
        targetValue: 10,
      });

      expect(metric.id).toBe(METRIC_ID);
      expect(metric.currentValue).toBe(5);
      expect(mockAuditService.record).toHaveBeenCalled();
    });

    it('rejects adding metric by a project VIEWER with 403 Forbidden', async () => {
      const goal = makeGoal();
      mockGoalRepo.findOne.mockResolvedValue(goal);
      mockUserRepo.findOne.mockResolvedValue({ id: OTHER_USER_ID, systemRole: SystemRole.USER });
      mockMemberRepo.findOne.mockResolvedValue({
        userId: OTHER_USER_ID,
        projectId: PROJECT_ID,
        accessRole: ProjectRole.VIEWER,
      });

      await expect(
        service.addMetric(GOAL_ID, OTHER_USER_ID, {
          name: 'Unauthorized Metric',
          unit: 'count',
          baselineValue: 0,
          currentValue: 0,
          targetValue: 10,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('calculateMeasuredProgress', () => {
    it('calculates measured progress accurately from metrics, milestones and tasks', () => {
      const goal = makeGoal({
        progress: 10,
        milestones: [
          { id: 'm-1', title: 'Milestone 1', completed: true },
          { id: 'm-2', title: 'Milestone 2', completed: false },
        ],
      });

      const metrics: GoalMetric[] = [
        {
          id: 'met-1',
          goalId: GOAL_ID,
          name: 'Revenue',
          unit: 'USD',
          baselineValue: 0,
          currentValue: 500,
          targetValue: 1000,
          observationDate: null,
          notes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const tasks: Task[] = [
        { id: 't-1', status: TaskStatus.DONE } as Task,
        { id: 't-2', status: TaskStatus.IN_PROGRESS } as Task,
      ];

      const breakdown = service.calculateMeasuredProgress(goal, metrics, tasks);

      // metric progress: (500 - 0) / 1000 = 50%
      expect(breakdown.metricsProgress).toBe(50);
      // milestone progress: 1 / 2 = 50%
      expect(breakdown.milestonesProgress).toBe(50);
      // task progress: 1 / 2 = 50%
      expect(breakdown.tasksProgress).toBe(50);
      // combined: 50*0.5 + 50*0.3 + 50*0.2 = 50%
      expect(breakdown.measuredProgress).toBe(50);
    });

    it('falls back to manual progress when no metrics or tasks are present', () => {
      const goal = makeGoal({ progress: 42, milestones: [] });
      const breakdown = service.calculateMeasuredProgress(goal, [], []);

      expect(breakdown.measuredProgress).toBe(42);
    });
  });
  it('does not confuse completed tasks with measured outcomes', () => {
    const goal = makeGoal({
      progress: 0,
      milestones: [{ id: 'm-1', title: 'Delivered', completed: true }],
    });
    const metric = { baselineValue: 0, currentValue: 0, targetValue: 100 } as GoalMetric;
    expect(
      service.calculateMeasuredProgress(goal, [metric], [{ status: TaskStatus.DONE } as Task]),
    ).toMatchObject({
      measuredProgress: 0,
      metricsProgress: 0,
      tasksProgress: 100,
      milestonesProgress: 100,
    });
  });
  it('denies goal summaries after project membership is revoked', async () => {
    mockGoalRepo.findOne.mockResolvedValue(makeGoal());
    mockUserRepo.findOne.mockResolvedValue({ id: USER_ID, systemRole: SystemRole.USER });
    mockMemberRepo.findOne.mockResolvedValue(null);
    await expect(service.getGoalSummary(GOAL_ID, USER_ID)).rejects.toThrow(ForbiddenException);
    expect(mockTaskRepo.find).not.toHaveBeenCalled();
  });
  it('denies archived goal changes through the global service path', async () => {
    mockGoalRepo.findOne.mockResolvedValue(makeGoal());
    mockUserRepo.findOne.mockResolvedValue({ id: USER_ID, systemRole: SystemRole.USER });
    mockMemberRepo.findOne.mockResolvedValue({
      accessRole: ProjectRole.OWNER,
      project: { status: 'ARCHIVED' },
    });
    await expect(
      service.updateGoal(GOAL_ID, USER_ID, { version: 1, title: 'Changed' }),
    ).rejects.toThrow();
  });
});
