import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TasksService } from '../../src/modules/tasks/tasks.service';
import { Task, TaskStatus, Priority } from '../../src/modules/tasks/entities/task.entity';
import { Project } from '../../src/modules/projects/entities/project.entity';
import {
  ProjectMember,
  ProjectRole,
} from '../../src/modules/projects/entities/project-member.entity';
import { AuditService } from '../../src/modules/audit/audit.service';
import { OutboxService } from '../../src/modules/ingestion/outbox.service';
import { AIProposal, ProposalStatus } from '../../src/modules/ai/entities/proposal.entity';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const ACTOR_ID = '22222222-2222-2222-2222-222222222222';
const ASSIGNEE_ID = '33333333-3333-3333-3333-333333333333';
const OTHER_USER = '44444444-4444-4444-4444-444444444444';
const TASK_ID = '55555555-5555-5555-5555-555555555555';

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date();
  return {
    id: TASK_ID,
    projectId: PROJECT_ID,
    number: 1,
    title: 'Test task',
    description: 'Task description',
    status: TaskStatus.TODO,
    priority: Priority.MEDIUM,
    assigneeId: null,
    dueDate: null,
    requirementId: null,
    sourceMeetingId: null,
    createdBy: ACTOR_ID,
    updatedBy: ACTOR_ID,
    version: 1,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Task;
}

describe('TasksService', () => {
  let service: TasksService;

  const mockTaskRepo = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  const mockProjectRepo = {
    findOne: jest.fn(),
  };

  const mockMemberRepo = {
    findOne: jest.fn(),
  };

  const mockAuditService = {
    record: jest.fn().mockResolvedValue(undefined),
  };

  const mockOutboxService = {
    emit: jest.fn().mockResolvedValue({}),
  };

  const mockTransactionManager = {
    query: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockDataSource = {
    getRepository: jest.fn(),
    transaction: jest.fn((cb: (manager: typeof mockTransactionManager) => Promise<unknown>) =>
      cb(mockTransactionManager),
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: getRepositoryToken(Task), useValue: mockTaskRepo },
        { provide: getRepositoryToken(Project), useValue: mockProjectRepo },
        { provide: getRepositoryToken(ProjectMember), useValue: mockMemberRepo },
        { provide: AuditService, useValue: mockAuditService },
        { provide: OutboxService, useValue: mockOutboxService },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get(TasksService);
  });

  describe('AI source traceability', () => {
    it('loads only confirmed records in the requested project and omits private draft text', async () => {
      const findOne = jest.fn().mockResolvedValue({
        id: 'proposal-id',
        sourceEntityType: 'DECISION',
        sourceEntityId: TASK_ID,
        sourceRevision: 2,
        draftJson: {
          type: 'CREATE_TASKS',
          items: [{ itemId: 'one', title: 'Private draft text' }],
          sourceReferences: [],
        },
      });
      mockDataSource.getRepository.mockReturnValue({ findOne });
      const result = await service.getAiProvenance(PROJECT_ID, TASK_ID);
      expect(mockDataSource.getRepository).toHaveBeenCalledWith(AIProposal);
      expect(findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: PROJECT_ID,
            status: ProposalStatus.CONFIRMED,
          }),
        }),
      );
      expect(result).toEqual({
        proposalId: 'proposal-id',
        sourceEntityType: 'DECISION',
        sourceEntityId: TASK_ID,
        sourceRevision: 2,
        sourceReferences: [],
      });
      expect(JSON.stringify(result)).not.toContain('Private draft text');
    });
    it('returns no AI sources for ordinary tasks', async () => {
      mockDataSource.getRepository.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });
      expect(await service.getAiProvenance(PROJECT_ID, TASK_ID)).toBeNull();
    });
  });

  describe('create', () => {
    it('should allocate project-local number and create task with audit log', async () => {
      mockTransactionManager.query.mockResolvedValue([{ max: 7 }]);
      const saved = makeTask({ number: 8 });
      mockTransactionManager.create.mockReturnValue(saved);
      mockTransactionManager.save.mockResolvedValue(saved);

      const result = await service.create(PROJECT_ID, ACTOR_ID, {
        title: 'New Task',
        priority: Priority.HIGH,
      });

      expect(result.number).toBe(8);
      expect(mockTransactionManager.save).toHaveBeenCalledTimes(1);
      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'TASK_CREATED' }),
      );
    });

    it('should validate assignee is active project member', async () => {
      mockMemberRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create(PROJECT_ID, ACTOR_ID, {
          title: 'New Task',
          assigneeId: ASSIGNEE_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should record TASK_ASSIGNED audit event when task created with assignee', async () => {
      mockMemberRepo.findOne.mockResolvedValue({ id: 'mem1', userId: ASSIGNEE_ID });
      mockTransactionManager.query.mockResolvedValue([{ max: 0 }]);
      const saved = makeTask({ number: 1, assigneeId: ASSIGNEE_ID });
      mockTransactionManager.create.mockReturnValue(saved);
      mockTransactionManager.save.mockResolvedValue(saved);

      await service.create(PROJECT_ID, ACTOR_ID, {
        title: 'Assigned Task',
        assigneeId: ASSIGNEE_ID,
      });

      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'TASK_ASSIGNED' }),
      );
    });
  });

  describe('getById', () => {
    it('should return task when found', async () => {
      const task = makeTask();
      mockTaskRepo.findOne.mockResolvedValue(task);

      const result = await service.getById(PROJECT_ID, TASK_ID);
      expect(result.id).toBe(TASK_ID);
    });

    it('should throw NotFoundException when task not found', async () => {
      mockTaskRepo.findOne.mockResolvedValue(null);
      await expect(service.getById(PROJECT_ID, TASK_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update task and increment version', async () => {
      const task = makeTask({ version: 1 });
      mockTaskRepo.findOne.mockResolvedValue(task);
      mockTaskRepo.save.mockImplementation(async (entity: Task) => ({
        ...entity,
        version: entity.version + 1,
      }));

      const result = await service.update(PROJECT_ID, TASK_ID, ACTOR_ID, {
        version: 1,
        title: 'Updated title',
        status: TaskStatus.IN_PROGRESS,
      });

      expect(result.title).toBe('Updated title');
      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'TASK_STATUS_CHANGED' }),
      );
      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'TASK_UPDATED' }),
      );
    });

    it('should throw ConflictException on version mismatch', async () => {
      const task = makeTask({ version: 2 });
      mockTaskRepo.findOne.mockResolvedValue(task);

      await expect(
        service.update(PROJECT_ID, TASK_ID, ACTOR_ID, { version: 1, title: 'Stale' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('softDelete', () => {
    it('should allow Owner to delete any task', async () => {
      const task = makeTask({ createdBy: OTHER_USER });
      mockTaskRepo.findOne.mockResolvedValue(task);
      mockTaskRepo.save.mockResolvedValue(task);

      await service.softDelete(PROJECT_ID, TASK_ID, ACTOR_ID, ProjectRole.OWNER);
      expect(task.deletedAt).not.toBeNull();
    });

    it('should allow Contributor to delete own task', async () => {
      const task = makeTask({ createdBy: ACTOR_ID });
      mockTaskRepo.findOne.mockResolvedValue(task);
      mockTaskRepo.save.mockResolvedValue(task);

      await service.softDelete(PROJECT_ID, TASK_ID, ACTOR_ID, ProjectRole.CONTRIBUTOR);
      expect(task.deletedAt).not.toBeNull();
    });

    it('should forbid Contributor from deleting others task', async () => {
      const task = makeTask({ createdBy: OTHER_USER });
      mockTaskRepo.findOne.mockResolvedValue(task);

      await expect(
        service.softDelete(PROJECT_ID, TASK_ID, ACTOR_ID, ProjectRole.CONTRIBUTOR),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getProjectKey', () => {
    it('should return project key', async () => {
      mockProjectRepo.findOne.mockResolvedValue({ key: 'AIW' });
      const key = await service.getProjectKey(PROJECT_ID);
      expect(key).toBe('AIW');
    });

    it('should throw NotFoundException if project not found', async () => {
      mockProjectRepo.findOne.mockResolvedValue(null);
      await expect(service.getProjectKey(PROJECT_ID)).rejects.toThrow(NotFoundException);
    });
  });
});
