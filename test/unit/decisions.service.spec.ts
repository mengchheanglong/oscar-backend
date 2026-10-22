import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DecisionsService } from '../../src/modules/decisions/decisions.service';
import { Decision, DecisionStatus } from '../../src/modules/decisions/entities/decision.entity';
import { DecisionRevision } from '../../src/modules/decisions/entities/decision-revision.entity';
import { Project } from '../../src/modules/projects/entities/project.entity';
import { ProjectRole } from '../../src/modules/projects/entities/project-member.entity';
import { Goal } from '../../src/modules/goals/entities/goal.entity';
import { AuditService } from '../../src/modules/audit/audit.service';
import { OutboxService } from '../../src/modules/ingestion/outbox.service';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const ACTOR_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_USER = '33333333-3333-3333-3333-333333333333';
const DEC_ID = '44444444-4444-4444-4444-444444444444';
const DEC_ID_2 = '55555555-5555-5555-5555-555555555555';

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  const now = new Date();
  return {
    id: DEC_ID,
    projectId: PROJECT_ID,
    number: 1,
    title: 'Test decision',
    decisionText: 'We decided X',
    rationale: 'Because Y',
    status: DecisionStatus.PROPOSED,
    decidedAt: null,
    decidedBy: null,
    requirementId: null,
    sourceMeetingId: null,
    supersedesDecisionId: null,
    createdBy: ACTOR_ID,
    updatedBy: ACTOR_ID,
    version: 1,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Decision;
}

describe('DecisionsService', () => {
  let service: DecisionsService;

  const mockDecisionRepo = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  const mockRevisionRepo = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
  };

  const mockProjectRepo = {
    findOne: jest.fn(),
  };

  const mockAuditService = {
    record: jest.fn().mockResolvedValue(undefined),
  };

  const mockOutboxService = {
    emit: jest.fn().mockResolvedValue({}),
  };

  const mockGoalRepo = {
    findOne: jest.fn(),
  };

  const mockTransactionManager = {
    query: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockDataSource = {
    transaction: jest.fn((cb: (manager: typeof mockTransactionManager) => Promise<unknown>) =>
      cb(mockTransactionManager),
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DecisionsService,
        { provide: getRepositoryToken(Decision), useValue: mockDecisionRepo },
        { provide: getRepositoryToken(DecisionRevision), useValue: mockRevisionRepo },
        { provide: getRepositoryToken(Project), useValue: mockProjectRepo },
        { provide: getRepositoryToken(Goal), useValue: mockGoalRepo },
        { provide: AuditService, useValue: mockAuditService },
        { provide: OutboxService, useValue: mockOutboxService },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get(DecisionsService);
  });

  describe('create', () => {
    it('should allocate number and create decision with revision', async () => {
      mockTransactionManager.query.mockResolvedValue([{ max: 2 }]);
      const saved = makeDecision({ number: 3 });
      mockTransactionManager.create.mockReturnValueOnce(saved).mockReturnValueOnce({});
      mockTransactionManager.save.mockResolvedValueOnce(saved).mockResolvedValueOnce({});

      const result = await service.create(PROJECT_ID, ACTOR_ID, {
        title: 'Test decision',
        decisionText: 'We decided X',
      });

      expect(result.number).toBe(3);
      expect(mockTransactionManager.save).toHaveBeenCalledTimes(2);
      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DECISION_CREATED' }),
      );
    });

    it('should validate same-project supersedes link', async () => {
      mockDecisionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create(PROJECT_ID, ACTOR_ID, {
          title: 'Dec',
          decisionText: 'Text',
          supersedesDecisionId: DEC_ID_2,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject when goalId does not belong to the project', async () => {
      mockGoalRepo.findOne.mockResolvedValue({ id: 'goal-other', projectId: 'other-project' });

      await expect(
        service.create(PROJECT_ID, ACTOR_ID, {
          title: 'Dec',
          decisionText: 'Text',
          goalId: 'goal-other',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject when goalId is not found', async () => {
      mockGoalRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create(PROJECT_ID, ACTOR_ID, {
          title: 'Dec',
          decisionText: 'Text',
          goalId: 'nonexistent-goal',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getById', () => {
    it('should return decision when found', async () => {
      const dec = makeDecision();
      mockDecisionRepo.findOne.mockResolvedValue(dec);

      const result = await service.getById(PROJECT_ID, DEC_ID);
      expect(result.id).toBe(DEC_ID);
    });

    it('should throw NotFoundException when not found', async () => {
      mockDecisionRepo.findOne.mockResolvedValue(null);
      await expect(service.getById(PROJECT_ID, DEC_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should create revision and apply updates', async () => {
      const dec = makeDecision({ version: 1 });
      mockDecisionRepo.findOne.mockResolvedValue(dec);
      mockRevisionRepo.create.mockReturnValue({});
      mockRevisionRepo.save.mockResolvedValue({});
      mockDecisionRepo.save.mockImplementation(async (entity: Decision) => ({
        ...entity,
        version: entity.version + 1,
      }));

      const result = await service.update(PROJECT_ID, DEC_ID, ACTOR_ID, {
        version: 1,
        title: 'Updated title',
      });

      expect(result.title).toBe('Updated title');
      expect(mockRevisionRepo.save).toHaveBeenCalledTimes(1);
    });

    it('should throw ConflictException on version mismatch', async () => {
      const dec = makeDecision({ version: 3 });
      mockDecisionRepo.findOne.mockResolvedValue(dec);

      await expect(
        service.update(PROJECT_ID, DEC_ID, ACTOR_ID, { version: 1, title: 'New' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should set decidedAt and decidedBy when status changes to ACCEPTED', async () => {
      const dec = makeDecision({ version: 1 });
      mockDecisionRepo.findOne.mockResolvedValue(dec);
      mockRevisionRepo.create.mockReturnValue({});
      mockRevisionRepo.save.mockResolvedValue({});
      mockDecisionRepo.save.mockImplementation(async (entity: Decision) => ({
        ...entity,
        version: entity.version + 1,
      }));

      const result = await service.update(PROJECT_ID, DEC_ID, ACTOR_ID, {
        version: 1,
        status: DecisionStatus.ACCEPTED,
      });

      expect(result.status).toBe(DecisionStatus.ACCEPTED);
      expect(result.decidedAt).not.toBeNull();
      expect(result.decidedBy).toBe(ACTOR_ID);
    });

    it('should audit as ACCEPTED_DECISION_UPDATED when modifying accepted decision', async () => {
      const dec = makeDecision({ version: 1, status: DecisionStatus.ACCEPTED });
      mockDecisionRepo.findOne.mockResolvedValue(dec);
      mockRevisionRepo.create.mockReturnValue({});
      mockRevisionRepo.save.mockResolvedValue({});
      mockDecisionRepo.save.mockImplementation(async (entity: Decision) => ({
        ...entity,
        version: entity.version + 1,
      }));

      await service.update(PROJECT_ID, DEC_ID, ACTOR_ID, {
        version: 1,
        title: 'Changed accepted',
      });

      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ACCEPTED_DECISION_UPDATED' }),
      );
    });

    it('should reject update if goalId belongs to another project', async () => {
      const dec = makeDecision({ version: 1 });
      mockDecisionRepo.findOne.mockResolvedValue(dec);
      mockGoalRepo.findOne.mockResolvedValue({ id: 'goal-other', projectId: 'other-project' });

      await expect(
        service.update(PROJECT_ID, DEC_ID, ACTOR_ID, {
          version: 1,
          goalId: 'goal-other',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow updating goalId when valid', async () => {
      const dec = makeDecision({ version: 1 });
      mockDecisionRepo.findOne.mockResolvedValue(dec);
      mockGoalRepo.findOne.mockResolvedValue({ id: 'goal-same', projectId: PROJECT_ID });
      mockRevisionRepo.create.mockReturnValue({});
      mockRevisionRepo.save.mockResolvedValue({});
      mockDecisionRepo.save.mockImplementation(async (entity: Decision) => ({
        ...entity,
        version: entity.version + 1,
      }));

      const result = await service.update(PROJECT_ID, DEC_ID, ACTOR_ID, {
        version: 1,
        goalId: 'goal-same',
      });

      expect(result.goalId).toBe('goal-same');
    });
  });

  describe('softDelete', () => {
    it('should allow Owner to delete any decision', async () => {
      const dec = makeDecision({ createdBy: OTHER_USER });
      mockDecisionRepo.findOne.mockResolvedValue(dec);
      mockDecisionRepo.save.mockResolvedValue(dec);

      await service.softDelete(PROJECT_ID, DEC_ID, ACTOR_ID, ProjectRole.OWNER);

      expect(dec.deletedAt).not.toBeNull();
    });

    it('should allow Contributor to delete own decision', async () => {
      const dec = makeDecision({ createdBy: ACTOR_ID });
      mockDecisionRepo.findOne.mockResolvedValue(dec);
      mockDecisionRepo.save.mockResolvedValue(dec);

      await service.softDelete(PROJECT_ID, DEC_ID, ACTOR_ID, ProjectRole.CONTRIBUTOR);
      expect(dec.deletedAt).not.toBeNull();
    });

    it('should forbid Contributor from deleting others decision', async () => {
      const dec = makeDecision({ createdBy: OTHER_USER });
      mockDecisionRepo.findOne.mockResolvedValue(dec);

      await expect(
        service.softDelete(PROJECT_ID, DEC_ID, ACTOR_ID, ProjectRole.CONTRIBUTOR),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('supersession cycle detection', () => {
    it('should reject self-supersession', async () => {
      // Setup: decision exists in project
      mockDecisionRepo.findOne.mockResolvedValue(makeDecision({ version: 1 }));
      mockRevisionRepo.create.mockReturnValue({});
      mockRevisionRepo.save.mockResolvedValue({});

      await expect(
        service.update(PROJECT_ID, DEC_ID, ACTOR_ID, {
          version: 1,
          supersedesDecisionId: DEC_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject cycle A -> B -> A', async () => {
      // getById returns decision A, validateDecisionInProject passes
      // Then checkSupersessionCycle walks B -> finds A
      const decA = makeDecision({ id: DEC_ID, version: 1 });
      mockDecisionRepo.findOne
        .mockResolvedValueOnce(decA) // getById
        .mockResolvedValueOnce({ id: DEC_ID_2 }) // validateDecisionInProject
        .mockResolvedValueOnce({ id: DEC_ID_2, supersedesDecisionId: DEC_ID }); // cycle check: B points to A

      mockRevisionRepo.create.mockReturnValue({});
      mockRevisionRepo.save.mockResolvedValue({});

      await expect(
        service.update(PROJECT_ID, DEC_ID, ACTOR_ID, {
          version: 1,
          supersedesDecisionId: DEC_ID_2,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listRevisions', () => {
    it('should return revisions for valid decision', async () => {
      mockDecisionRepo.findOne.mockResolvedValue(makeDecision());
      const revisions = [{ id: 'rev1', version: 1 }];
      mockRevisionRepo.find.mockResolvedValue(revisions);

      const result = await service.listRevisions(PROJECT_ID, DEC_ID);
      expect(result).toEqual(revisions);
    });
  });

  describe('getProjectKey', () => {
    it('should return project key', async () => {
      mockProjectRepo.findOne.mockResolvedValue({ key: 'AIW' });
      const key = await service.getProjectKey(PROJECT_ID);
      expect(key).toBe('AIW');
    });
  });
});
