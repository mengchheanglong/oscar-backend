import { NotFoundException } from '@nestjs/common';
import { SearchService } from '../../src/modules/search/search.service';
import { SearchEntityType } from '../../src/modules/search/dto/search.dto';

describe('SearchService (Unit)', () => {
  let service: SearchService;
  let mockProjectRepo: { findOneBy: jest.Mock };
  let mockDecRepo: { createQueryBuilder: jest.Mock };
  let mockTaskRepo: { createQueryBuilder: jest.Mock };
  let mockDocRepo: { createQueryBuilder: jest.Mock };
  let mockGoalRepo: { createQueryBuilder: jest.Mock };

  const mockProjectId = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    mockProjectRepo = {
      findOneBy: jest.fn(),
    };

    interface MockQb<T> {
      where: (clause?: string, params?: Record<string, unknown>) => MockQb<T>;
      andWhere: (clause?: string, params?: Record<string, unknown>) => MockQb<T>;
      leftJoinAndSelect: () => MockQb<T>;
      getMany: () => Promise<T[]>;
    }

    const createMockQb = <T>(items: T[]): MockQb<T> => {
      const qb: MockQb<T> = {
        where: jest.fn(() => qb),
        andWhere: jest.fn(() => qb),
        leftJoinAndSelect: jest.fn(() => qb),
        getMany: jest.fn(async () => items),
      };
      return qb;
    };

    mockDecRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(
        createMockQb([
          {
            id: 'dec-1',
            number: 1,
            title: 'Adopt NestJS Architecture',
            decisionText: 'Build as modular monolith',
            rationale: 'High velocity',
            status: 'ACCEPTED',
            decidedAt: new Date('2026-09-15T10:00:00Z'),
            decidedBy: 'user-1',
            updatedAt: new Date('2026-09-15T11:00:00Z'),
            supersedesDecisionId: null,
          },
        ]),
      ),
    };

    mockTaskRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(
        createMockQb([
          {
            id: 'task-1',
            number: 1,
            title: 'Implement Search Controller',
            description: 'Add keyword search endpoint',
            status: 'IN_PROGRESS',
            priority: 'HIGH',
            dueDate: '2026-09-30',
            assigneeId: 'user-1',
            assignee: { displayName: 'Alice' },
            requirementId: 'req-1',
            updatedAt: new Date('2026-09-15T13:00:00Z'),
          },
        ]),
      ),
    };

    mockDocRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(
        createMockQb([
          {
            id: 'doc-1',
            title: 'Architecture Document',
            description: 'Detailed system diagram',
            originalFilename: 'arch.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 2048,
            revision: 1,
            processingStatus: 'COMPLETED',
            updatedAt: new Date('2026-09-13T10:00:00Z'),
          },
        ]),
      ),
    };

    mockGoalRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(createMockQb([])),
    };

    service = new SearchService(
      mockProjectRepo as unknown as import('typeorm').Repository<
        import('../../src/modules/projects/entities/project.entity').Project
      >,
      mockDecRepo as unknown as import('typeorm').Repository<
        import('../../src/modules/decisions/entities/decision.entity').Decision
      >,
      mockTaskRepo as unknown as import('typeorm').Repository<
        import('../../src/modules/tasks/entities/task.entity').Task
      >,
      mockDocRepo as unknown as import('typeorm').Repository<
        import('../../src/modules/documents/entities/document.entity').Document
      >,
      {
        retrieve: jest.fn().mockResolvedValue([]),
      } as unknown as import('../../src/modules/mavis/retrieval/retrieval.service').RetrievalService,
      { query: jest.fn().mockResolvedValue([]) } as unknown as import('typeorm').DataSource,
      mockGoalRepo as unknown as import('typeorm').Repository<
        import('../../src/modules/goals/entities/goal.entity').Goal
      >,
    );
  });

  it('throws NotFoundException when project does not exist', async () => {
    mockProjectRepo.findOneBy.mockResolvedValue(null);

    await expect(service.search(mockProjectId, { q: 'auth' }, 'actor')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('searches across all 3 active entities when type is omitted and returns formatted results', async () => {
    mockProjectRepo.findOneBy.mockResolvedValue({
      id: mockProjectId,
      key: 'AIW',
    });

    const result = await service.search(mockProjectId, { q: 'search' }, 'actor');

    expect(result.data).toHaveLength(3);
    expect(result.meta.total).toBe(3);
    expect(result.meta.countsByType).toEqual({
      DECISION: 1,
      TASK: 1,
      DOCUMENT: 1,
      GITHUB_ISSUE: 0,
      GITHUB_PR: 0,
      GITHUB_CODE: 0,
      GOAL: 0,
    });

    // Verify ordering: newest updatedAt first (task-1 at 13:00, req-1 at 12:00, etc.)
    expect(result.data[0]!.id).toBe('task-1');
    expect(result.data[0]!.key).toBe('AIW-TSK-1');
    expect(result.data[0]!.type).toBe(SearchEntityType.TASK);
    expect(result.data[0]!.metadata?.assigneeName).toBe('Alice');

    const decItem = result.data.find((item) => item.type === SearchEntityType.DECISION);
    expect(decItem?.key).toBe('AIW-DEC-1');
  });

  it('filters by entity type when type filter is provided', async () => {
    mockProjectRepo.findOneBy.mockResolvedValue({
      id: mockProjectId,
      key: 'AIW',
    });

    const result = await service.search(
      mockProjectId,
      {
        q: 'auth',
        type: SearchEntityType.DOCUMENT,
      },
      'actor',
    );

    expect(mockDocRepo.createQueryBuilder).toHaveBeenCalled();
    expect(mockTaskRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(mockDecRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.type).toBe(SearchEntityType.DOCUMENT);
    expect(result.meta.countsByType.DOCUMENT).toBe(1);
    expect(result.meta.countsByType.TASK).toBe(0);
  });

  it('filters and scopes goal search to project and actor personal goals', async () => {
    mockProjectRepo.findOneBy.mockResolvedValue({
      id: mockProjectId,
      key: 'AIW',
    });

    const mockGoalQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        {
          id: 'goal-1',
          projectId: mockProjectId,
          userId: 'actor',
          title: 'Reach $100K ARR',
          description: 'Scale subscription revenue',
          motivation: 'Achieve profitability',
          target: '$100K',
          status: 'IN_PROGRESS',
          category: 'BUSINESS',
          progress: 50,
          updatedAt: new Date('2026-09-15T15:00:00Z'),
        },
      ]),
    };
    mockGoalRepo.createQueryBuilder.mockReturnValue(mockGoalQb);

    const result = await service.search(
      mockProjectId,
      {
        q: 'revenue',
        type: SearchEntityType.GOAL,
      },
      'actor-123',
    );

    expect(mockGoalRepo.createQueryBuilder).toHaveBeenCalled();
    expect(mockGoalQb.where).toHaveBeenCalledWith(
      '(goal.projectId = :projectId OR (goal.projectId IS NULL AND goal.userId = :actorId))',
      { projectId: mockProjectId, actorId: 'actor-123' },
    );
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.type).toBe(SearchEntityType.GOAL);
    expect(result.data[0]!.title).toBe('Reach $100K ARR');
    expect(result.meta.countsByType.GOAL).toBe(1);
  });
});
