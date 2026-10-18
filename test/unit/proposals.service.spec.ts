import { Priority } from '../../src/common/enums/priority.enum';
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ProposalsService } from '../../src/modules/ai/proposals.service';
import {
  AIProposal,
  ProposalStatus,
  ProposalType,
} from '../../src/modules/ai/entities/proposal.entity';
import { ProposalCommit } from '../../src/modules/ai/entities/proposal-commit.entity';
import { Task } from '../../src/modules/tasks/entities/task.entity';
import { Decision, DecisionStatus } from '../../src/modules/decisions/entities/decision.entity';
import { Project, ProjectStatus } from '../../src/modules/projects/entities/project.entity';
import { ProjectRole } from '../../src/modules/projects/entities/project-member.entity';
import { User, SystemRole } from '../../src/modules/users/entities/user.entity';
import { MockLlmProvider } from '../../src/modules/ai/llm/mock-llm-provider';

import { Document } from '../../src/modules/documents/entities/document.entity';

describe('ProposalsService', () => {
  let service: ProposalsService;
  let mockProposalRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let mockCommitRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let mockTaskRepo: {
    create: jest.Mock;
    save: jest.Mock;
  };
  let mockDecisionRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
  };
  let mockProjectRepo: {
    findOne: jest.Mock;
  };
  let mockMemberRepo: {
    findOne: jest.Mock;
  };
  let mockLlmProvider: MockLlmProvider;
  let mockAuditService: {
    record: jest.Mock;
  };
  let mockOutboxService: {
    emit: jest.Mock;
  };
  let mockDataSource: {
    transaction: jest.Mock;
  };

  const mockProjectId = '11111111-1111-1111-1111-111111111111';
  const mockUserId = '22222222-2222-2222-2222-222222222222';
  const mockActor = {
    id: mockUserId,
    email: 'alice@example.com',
    displayName: 'Alice Test',
    passwordHash: 'hash',
    systemRole: SystemRole.USER,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as User;

  const mockProject = {
    id: mockProjectId,
    name: 'Alpha Workspace',
    key: 'AIW',
    description: 'Test project',
    status: ProjectStatus.ACTIVE,
    createdBy: mockUserId,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Project;

  const mockDecision: Decision = {
    id: '55555555-5555-5555-5555-555555555555',
    projectId: mockProjectId,
    number: 1,
    title: 'Adopt PostgreSQL Vector Store',
    decisionText: 'We will use pgvector for document semantic search.',
    rationale: 'Reduces operational overhead.',
    status: DecisionStatus.ACCEPTED,
    decidedAt: new Date(),
    decidedBy: mockUserId,
    sourceMeetingId: null,
    requirementId: null,
    supersedesDecisionId: null,
    createdBy: mockUserId,
    updatedBy: mockUserId,
    version: 1,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockProposalRepo = {
      create: jest.fn((dto: unknown) => ({
        id: 'prop-123',
        ...(dto as object),
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      save: jest.fn((entity: { id?: string }) =>
        Promise.resolve({ id: entity.id || 'prop-123', ...entity }),
      ),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };

    mockCommitRepo = {
      findOne: jest.fn(),
      create: jest.fn((dto: unknown) => ({ id: 'commit-123', ...(dto as object) })),
      save: jest.fn((entity: unknown) => Promise.resolve(entity)),
    };

    mockTaskRepo = {
      create: jest.fn((dto: unknown) => ({ id: 'task-123', ...(dto as object) })),
      save: jest.fn((entity: unknown) => Promise.resolve(entity)),
    };

    mockDecisionRepo = {
      create: jest.fn((dto: unknown) => ({ id: 'dec-123', ...(dto as object) })),
      save: jest.fn((entity: unknown) => Promise.resolve(entity)),
      findOne: jest.fn(),
    };

    mockProjectRepo = {
      findOne: jest.fn().mockResolvedValue(mockProject),
    };

    mockMemberRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'mem-1',
        projectId: mockProjectId,
        userId: mockUserId,
        accessRole: ProjectRole.MANAGER,
        removedAt: null,
      }),
    };

    mockLlmProvider = new MockLlmProvider();

    mockAuditService = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    mockOutboxService = {
      emit: jest.fn().mockResolvedValue(undefined),
    };

    mockDataSource = {
      transaction: jest.fn(async (callback: (manager: unknown) => Promise<unknown>) => {
        const mockManager = {
          findOne: jest.fn(),
          query: jest.fn().mockResolvedValue([{ max: 0 }]),
          create: jest.fn((_entityClass: unknown, plainObject: object) => ({
            id: 'generated-uuid-1',
            ...plainObject,
          })),
          save: jest.fn((_entityClass: unknown, plainObject: object) =>
            Promise.resolve({ id: 'saved-uuid-1', ...plainObject }),
          ),
          createQueryBuilder: jest.fn(() => ({
            innerJoinAndSelect: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            getOne: jest.fn().mockResolvedValue(null),
          })),
        };
        return callback(mockManager);
      }),
    };
    service = new ProposalsService(
      mockProposalRepo as never,
      mockCommitRepo as never,
      mockDecisionRepo as never,
      mockProjectRepo as never,
      mockMemberRepo as never,
      mockLlmProvider,
      mockAuditService as never,
      mockOutboxService as never,
      mockDataSource as never,
    );
  });

  it('rejects a stored proposal from a retired feature without saving it', async () => {
    mockProposalRepo.findOne.mockResolvedValue({
      id: 'legacy',
      sourceEntityType: 'MEETING',
      proposalType: 'MEETING_ANALYSIS',
    });
    await expect(service.getProposal(mockProjectId, mockUserId, 'legacy')).rejects.toMatchObject({
      response: { code: 'FEATURE_RETIRED' },
    });
    expect(mockProposalRepo.save).not.toHaveBeenCalled();
  });
  describe('generateDecisionTaskProposal', () => {
    it('should generate structured task proposals from an architectural decision', async () => {
      mockDecisionRepo.findOne.mockResolvedValue(mockDecision);

      const result = await service.generateDecisionTaskProposal(
        mockProjectId,
        mockUserId,
        mockDecision.id,
      );

      expect(result).toBeDefined();
      expect(result.proposalType).toBe(ProposalType.TASK_PROPOSAL);
      expect(result.sourceEntityType).toBe('DECISION');
      expect(result.sourceEntityId).toBe(mockDecision.id);
      expect(result.sourceRevision).toBe(mockDecision.version);
      expect(result.status).toBe(ProposalStatus.PENDING);
      expect(result.draftJson).toHaveProperty('type', 'CREATE_TASKS');
      expect(result.draftJson).toHaveProperty('items');
      const draft = result.draftJson as { items: Array<{ sourceIds: string[] }> };
      expect(draft.items.length).toBeGreaterThan(0);
      expect(draft.items[0]!.sourceIds).toContain(mockDecision.id);

      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'AI_TASK_PROPOSAL_GENERATED',
          projectId: mockProjectId,
        }),
      );
    });

    it('should throw NotFoundException if decision does not exist', async () => {
      mockDecisionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.generateDecisionTaskProposal(mockProjectId, mockUserId, 'non-existent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProposal', () => {
    it('should update draft items and increment proposal version', async () => {
      const existingProposal = {
        id: 'prop-123',
        projectId: mockProjectId,
        userId: mockUserId,
        proposalType: ProposalType.TASK_PROPOSAL,
        sourceEntityType: 'DECISION',
        sourceEntityId: mockDecision.id,
        sourceRevision: mockDecision.version,
        draftJson: {
          type: 'CREATE_TASKS',
          items: [
            {
              itemId: 'draft-item-1',
              title: 'Original Title',
              priority: Priority.MEDIUM,
              sourceIds: [],
            },
          ],
        },
        version: 1,
        status: ProposalStatus.PENDING,
        expiresAt: new Date(Date.now() + 100000),
        confirmedBy: null,
        confirmedAt: null,
        resultRecordIds: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as AIProposal;

      mockProposalRepo.findOne.mockResolvedValue(existingProposal);

      const updated = await service.updateProposal(mockProjectId, mockUserId, 'prop-123', {
        version: 1,
        draftJson: {
          type: 'CREATE_TASKS',
          items: [
            {
              itemId: 'draft-item-1',
              title: 'Updated Task Title',
              priority: Priority.HIGH,
              sourceIds: [],
            },
          ],
        },
      });

      expect(updated.version).toBe(2);
      const draft = updated.draftJson as { items: Array<{ title: string }> };
      expect(draft.items[0]!.title).toBe('Updated Task Title');
    });

    it('should throw ConflictException on version mismatch (optimistic locking)', async () => {
      const existingProposal = {
        id: 'prop-123',
        projectId: mockProjectId,
        userId: mockUserId,
        proposalType: ProposalType.TASK_PROPOSAL,
        sourceEntityType: 'DECISION',
        sourceEntityId: mockDecision.id,
        sourceRevision: mockDecision.version,
        draftJson: { type: 'CREATE_TASKS', items: [] },
        version: 2,
        status: ProposalStatus.PENDING,
        expiresAt: new Date(Date.now() + 100000),
        confirmedBy: null,
        confirmedAt: null,
        resultRecordIds: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as AIProposal;

      mockProposalRepo.findOne.mockResolvedValue(existingProposal);

      await expect(
        service.updateProposal(mockProjectId, mockUserId, 'prop-123', {
          version: 1, // Stale version
          draftJson: { type: 'CREATE_TASKS', items: [] },
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('rejectProposal', () => {
    it('should set status to REJECTED without modifying domain tables', async () => {
      const existingProposal = {
        id: 'prop-123',
        projectId: mockProjectId,
        userId: mockUserId,
        proposalType: ProposalType.TASK_PROPOSAL,
        sourceEntityType: 'DECISION',
        sourceEntityId: mockDecision.id,
        sourceRevision: mockDecision.version,
        draftJson: { type: 'CREATE_TASKS', items: [] },
        version: 1,
        status: ProposalStatus.PENDING,
        expiresAt: new Date(Date.now() + 100000),
        confirmedBy: null,
        confirmedAt: null,
        resultRecordIds: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as AIProposal;

      mockProposalRepo.findOne.mockResolvedValue(existingProposal);

      const rejected = await service.rejectProposal(mockProjectId, mockUserId, 'prop-123');
      expect(rejected.status).toBe(ProposalStatus.REJECTED);
      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AI_PROPOSAL_REJECTED' }),
      );
    });
  });

  describe('confirmProposal', () => {
    const reference = {
      sourceId: '77777777-7777-4777-8777-777777777777',
      chunkId: '88888888-8888-4888-8888-888888888888',
      sourceType: 'DOCUMENT',
      title: 'SRS',
      revision: 1,
      locator: 'Page 4',
    };

    function pending() {
      return {
        id: 'prop-123',
        projectId: mockProjectId,
        userId: mockUserId,
        proposalType: ProposalType.TASK_PROPOSAL,
        sourceEntityType: 'DECISION',
        sourceEntityId: mockDecision.id,
        sourceRevision: mockDecision.version,
        draftJson: {
          type: 'CREATE_TASKS',
          items: [
            {
              itemId: 'one',
              title: 'Reviewed task',
              priority: Priority.HIGH,
              sourceIds: [mockDecision.id],
            },
          ],
          sourceReferences: [reference],
        },
        version: 1,
        status: ProposalStatus.PENDING,
        expiresAt: new Date(Date.now() + 100000),
        confirmedBy: null,
        confirmedAt: null,
        resultRecordIds: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as AIProposal;
    }

    it.each(['creator', 'document', 'selection', 'assignee'] as const)(
      'rejects invalid %s without any domain write',
      async (failure) => {
        const proposal = pending();
        if (failure === 'creator') proposal.userId = 'another-user';
        if (failure === 'assignee')
          Object.assign((proposal.draftJson.items as object[])[0]!, {
            assigneeId: '99999999-9999-4999-8999-999999999999',
          });
        const manager = {
          findOne: jest.fn((entity: unknown) =>
            Promise.resolve(
              entity === AIProposal
                ? proposal
                : entity === Decision
                  ? mockDecision
                  : entity === Document
                    ? { revision: failure === 'document' ? 2 : 1 }
                    : null,
            ),
          ),
          query: jest.fn().mockResolvedValue([{ max: 0 }]),
          create: jest.fn(),
          save: jest.fn(),
        };
        mockDataSource.transaction.mockImplementation(
          (callback: (value: unknown) => Promise<unknown>) => callback(manager),
        );
        await expect(
          service.confirmProposal(
            mockProjectId,
            mockActor,
            proposal.id,
            {
              version: 1,
              selectedItemIds: [failure === 'selection' ? 'unknown' : 'one'],
            },
            'negative-test',
          ),
        ).rejects.toThrow(
          failure === 'creator'
            ? ForbiddenException
            : failure === 'document'
              ? ConflictException
              : BadRequestException,
        );
        expect(manager.save).not.toHaveBeenCalled();
        expect(mockOutboxService.emit).not.toHaveBeenCalled();
      },
    );

    it('preserves trusted document references during edits and creates no tasks', async () => {
      const proposal = pending();
      mockProposalRepo.findOne.mockResolvedValue(proposal);
      const result = await service.updateProposal(mockProjectId, mockUserId, proposal.id, {
        version: 1,
        draftJson: {
          ...proposal.draftJson,
          sourceReferences: [{ ...reference, title: 'Forged source' }],
        },
      });
      expect(result.draftJson.sourceReferences).toEqual([reference]);
      expect(mockTaskRepo.save).not.toHaveBeenCalled();
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it.each(['blank title', 'invalid date', 'duplicate IDs'])(
      'rejects %s as a validation error rather than a provider failure',
      async (invalid) => {
        const proposal = pending();
        mockProposalRepo.findOne.mockResolvedValue(proposal);
        await expect(
          service.updateProposal(mockProjectId, mockUserId, proposal.id, {
            version: 1,
            draftJson: {
              ...proposal.draftJson,
              items:
                invalid === 'duplicate IDs'
                  ? [
                      { itemId: 'one', title: 'First' },
                      { itemId: 'one', title: 'Second' },
                    ]
                  : [
                      {
                        itemId: 'one',
                        title: invalid === 'blank title' ? '  ' : 'Valid title',
                        priority: Priority.HIGH,
                        dueDate: invalid === 'invalid date' ? '2026-02-30' : null,
                      },
                    ],
            },
          }),
        ).rejects.toThrow(BadRequestException);
        expect(mockProposalRepo.save).not.toHaveBeenCalled();
      },
    );

    it('should replay result on identical idempotency key', async () => {
      const existingCommit: ProposalCommit = {
        id: 'commit-1',
        proposalId: 'prop-123',
        projectId: mockProjectId,
        actorId: mockUserId,
        idempotencyKey: 'idem-key-abc',
        payloadHash: '4ba4fdf24df39c14828ce3722a45d7d3c01c0cf9a9cb84e1bba92fd6b50937c4',
        resultRecordIds: [{ entityType: 'TASK', id: 'task-1', key: 'AIW-TSK-1' }],
        createdAt: new Date(),
      };

      mockCommitRepo.findOne.mockImplementation(
        ({ where }: { where: { idempotencyKey?: string } }) => {
          if (where.idempotencyKey === 'idem-key-abc') {
            const hash = createHash('sha256')
              .update(JSON.stringify({ proposalId: 'prop-123', dto: { version: 1 } }))
              .digest('hex');
            return Promise.resolve({ ...existingCommit, payloadHash: hash });
          }
          return Promise.resolve(null);
        },
      );

      mockProposalRepo.findOne.mockResolvedValue({
        id: 'prop-123',
        status: ProposalStatus.CONFIRMED,
      });

      const res = await service.confirmProposal(
        mockProjectId,
        mockActor,
        'prop-123',
        { version: 1 },
        'idem-key-abc',
      );

      expect(res.resultRecordIds).toEqual(existingCommit.resultRecordIds);
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('should reject viewer role from confirming proposals', async () => {
      mockMemberRepo.findOne.mockResolvedValue({
        id: 'mem-1',
        projectId: mockProjectId,
        userId: mockUserId,
        accessRole: ProjectRole.VIEWER,
        removedAt: null,
      });

      await expect(
        service.confirmProposal(mockProjectId, mockActor, 'prop-123', { version: 1 }, 'key-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject confirmation with ConflictException if source decision revision changed', async () => {
      const pendingProposal = {
        id: 'prop-123',
        projectId: mockProjectId,
        userId: mockUserId,
        proposalType: ProposalType.TASK_PROPOSAL,
        sourceEntityType: 'DECISION',
        sourceEntityId: mockDecision.id,
        sourceRevision: 1, // Proposal was based on revision 1
        draftJson: {
          type: 'CREATE_TASKS',
          items: [
            {
              itemId: 'draft-item-1',
              title: 'Task 1',
              priority: Priority.MEDIUM,
              sourceIds: [],
            },
          ],
        },
        version: 1,
        status: ProposalStatus.PENDING,
        expiresAt: new Date(Date.now() + 100000),
        confirmedBy: null,
        confirmedAt: null,
        resultRecordIds: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as AIProposal;

      mockDataSource.transaction = jest.fn(
        async (
          cb: (manager: {
            findOne: (entityClass: unknown) => Promise<unknown>;
          }) => Promise<unknown>,
        ) => {
          const mockManager = {
            findOne: jest.fn((entityClass: unknown) => {
              if (entityClass === AIProposal) return Promise.resolve(pendingProposal);
              if (entityClass === Decision) return Promise.resolve({ ...mockDecision, version: 3 }); // Requirement evolved to version 3!
              return Promise.resolve(null);
            }),
          };
          return cb(mockManager);
        },
      );

      await expect(
        service.confirmProposal(mockProjectId, mockActor, 'prop-123', { version: 1 }, 'key-new'),
      ).rejects.toThrow(ConflictException);
    });

    it.each([null, '44444444-4444-4444-4444-444444444444'])(
      'creates selected tasks retaining source meeting %s and commits the proposal',
      async (sourceMeetingId) => {
        const pendingProposal = {
          id: 'prop-123',
          projectId: mockProjectId,
          userId: mockUserId,
          proposalType: ProposalType.TASK_PROPOSAL,
          sourceEntityType: 'DECISION',
          sourceEntityId: mockDecision.id,
          sourceRevision: mockDecision.version,
          draftJson: {
            type: 'CREATE_TASKS',
            items: [
              {
                itemId: 'draft-item-1',
                title: 'Implement feature backend',
                description: 'REST API implementation',
                priority: Priority.HIGH,
                sourceIds: [mockDecision.id],
              },
            ],
          },
          version: 1,
          status: ProposalStatus.PENDING,
          expiresAt: new Date(Date.now() + 100000),
          confirmedBy: null,
          confirmedAt: null,
          resultRecordIds: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        } as AIProposal;

        let capturedTask: Task | null = null;
        let capturedCommit: ProposalCommit | null = null;

        mockDataSource.transaction = jest.fn(
          async (
            cb: (manager: {
              findOne: (entityClass: unknown) => Promise<unknown>;
              query: () => Promise<unknown>;
              create: (entityClass: unknown, plainObject: unknown) => unknown;
              save: (entityClass: unknown, plainObject: unknown) => Promise<unknown>;
            }) => Promise<unknown>,
          ) => {
            const mockManager = {
              findOne: jest.fn((entityClass: unknown) => {
                if (entityClass === AIProposal) return Promise.resolve(pendingProposal);
                if (entityClass === Decision)
                  return Promise.resolve({ ...mockDecision, sourceMeetingId });
                return Promise.resolve(null);
              }),
              query: jest.fn().mockResolvedValue([{ max: 5 }]),
              create: jest.fn((_entityClass: unknown, plainObject: unknown) => ({
                id: 'gen-uuid',
                ...(plainObject as object),
              })),
              save: jest.fn((entityClass: unknown, plainObject: unknown) => {
                if (entityClass === Task) capturedTask = plainObject as Task;
                if (entityClass === ProposalCommit) capturedCommit = plainObject as ProposalCommit;
                return Promise.resolve({ id: 'saved-id', ...(plainObject as object) });
              }),
            };
            return cb(mockManager);
          },
        );

        const res = await service.confirmProposal(
          mockProjectId,
          mockActor,
          'prop-123',
          { version: 1 },
          'key-create-task',
        );

        expect(res.resultRecordIds).toHaveLength(1);
        expect(res.resultRecordIds[0]!.entityType).toBe('TASK');
        expect(res.resultRecordIds[0]!.key).toBe('AIW-TASK-6'); // nextNumber was 6
        expect(capturedTask).not.toBeNull();
        expect(capturedTask!.number).toBe(6);
        expect(capturedTask!.title).toBe('Implement feature backend');
        expect(capturedTask!.requirementId).toBeNull();
        expect(capturedTask!.sourceMeetingId).toBeNull();
        expect(capturedCommit).not.toBeNull();
        expect(capturedCommit!.idempotencyKey).toBe('key-create-task');
        expect(mockOutboxService.emit).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ eventType: 'TASK_CREATED' }),
        );
      },
    );

    it('should transactionally create tasks from architectural decision proposal on valid confirmation', async () => {
      const pendingDecisionProposal = {
        id: 'prop-dec-123',
        projectId: mockProjectId,
        userId: mockUserId,
        proposalType: ProposalType.TASK_PROPOSAL,
        sourceEntityType: 'DECISION',
        sourceEntityId: mockDecision.id,
        sourceRevision: 1,
        draftJson: {
          type: 'CREATE_TASKS',
          items: [
            {
              itemId: 'item-dec-1',
              title: 'Setup PostgreSQL pgvector extension',
              description: 'Install and configure pgvector in Supabase database',
              priority: Priority.HIGH,
              assigneeId: null,
              dueDate: '2026-10-15',
              sourceIds: [mockDecision.id],
            },
          ],
        },
        version: 1,
        status: ProposalStatus.PENDING,
        expiresAt: new Date(Date.now() + 86400000),
        confirmedBy: null,
        confirmedAt: null,
        resultRecordIds: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as AIProposal;

      let capturedTask: Task | null = null;
      let capturedCommit: ProposalCommit | null = null;

      mockDataSource.transaction = jest.fn(
        async (
          cb: (manager: {
            findOne: (entityClass: unknown) => Promise<unknown>;
            query: () => Promise<unknown>;
            create: (entityClass: unknown, plainObject: unknown) => unknown;
            save: (entityClass: unknown, plainObject: unknown) => Promise<unknown>;
          }) => Promise<unknown>,
        ) => {
          const mockManager = {
            findOne: jest.fn((entityClass: unknown) => {
              if (entityClass === AIProposal) return Promise.resolve(pendingDecisionProposal);
              if (entityClass === Decision) return Promise.resolve(mockDecision);
              return Promise.resolve(null);
            }),
            query: jest.fn().mockResolvedValue([{ max: 8 }]),
            create: jest.fn((_entityClass: unknown, plainObject: unknown) => ({
              id: 'gen-uuid',
              ...(plainObject as object),
            })),
            save: jest.fn((entityClass: unknown, plainObject: unknown) => {
              if (entityClass === Task) capturedTask = plainObject as Task;
              if (entityClass === ProposalCommit) capturedCommit = plainObject as ProposalCommit;
              return Promise.resolve({ id: 'saved-id', ...(plainObject as object) });
            }),
          };
          return cb(mockManager);
        },
      );

      const res = await service.confirmProposal(
        mockProjectId,
        mockActor,
        'prop-dec-123',
        { version: 1 },
        'key-create-dec-task',
      );

      expect(res.resultRecordIds).toHaveLength(1);
      expect(res.resultRecordIds[0]!.entityType).toBe('TASK');
      expect(res.resultRecordIds[0]!.key).toBe('AIW-TASK-9'); // nextNumber was 9
      expect(capturedTask).not.toBeNull();
      expect(capturedTask!.number).toBe(9);
      expect(capturedTask!.title).toBe('Setup PostgreSQL pgvector extension');
      expect(capturedCommit).not.toBeNull();
      expect(capturedCommit!.idempotencyKey).toBe('key-create-dec-task');
      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'TASK_CREATED_FROM_AI_PROPOSAL',
          entityType: 'TASK',
          metadata: expect.objectContaining({
            decisionId: mockDecision.id,
            decisionKey: 'AIW-DEC-1',
          }),
        }),
      );
    });

    it('should throw ConflictException if idempotency key is reused with mismatched payload hash', async () => {
      const existingCommit: ProposalCommit = {
        id: 'commit-diff',
        proposalId: 'prop-123',
        projectId: mockProjectId,
        actorId: mockUserId,
        idempotencyKey: 'key-reused',
        payloadHash: 'hash-of-original-payload',
        resultRecordIds: [{ entityType: 'TASK', id: 'task-orig', key: 'AIW-TSK-1' }],
        createdAt: new Date(),
      };

      mockCommitRepo.findOne.mockResolvedValue(existingCommit);

      await expect(
        service.confirmProposal(
          mockProjectId,
          mockActor,
          'prop-123',
          { version: 1, selectedItemIds: ['different-item'] },
          'key-reused',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should confirm edited draft tasks with modified title, priority, and selected items', async () => {
      // Step 1: Draft proposal exists with version 2 after being edited
      const editedProposal = {
        id: 'prop-edited-123',
        projectId: mockProjectId,
        userId: mockUserId,
        proposalType: ProposalType.TASK_PROPOSAL,
        sourceEntityType: 'DECISION',
        sourceEntityId: mockDecision.id,
        sourceRevision: mockDecision.version,
        draftJson: {
          type: 'CREATE_TASKS',
          items: [
            {
              itemId: 'edited-item-1',
              title: 'Refined Task Title: Custom Stream Parser',
              description: 'Refined task description with edge-case handling',
              priority: Priority.URGENT,
              dueDate: '2026-10-15',
              sourceIds: [mockDecision.id],
            },
            {
              itemId: 'edited-item-2',
              title: 'Unselected Task',
              description: 'Will not be confirmed',
              priority: Priority.LOW,
              sourceIds: [],
            },
          ],
        },
        version: 2, // version was bumped after edit
        status: ProposalStatus.PENDING,
        expiresAt: new Date(Date.now() + 100000),
        confirmedBy: null,
        confirmedAt: null,
        resultRecordIds: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as AIProposal;

      let capturedTask: Task | null = null;

      mockDataSource.transaction = jest.fn(
        async (
          cb: (manager: {
            findOne: (entityClass: unknown) => Promise<unknown>;
            query: () => Promise<unknown>;
            create: (entityClass: unknown, plainObject: unknown) => unknown;
            save: (entityClass: unknown, plainObject: unknown) => Promise<unknown>;
          }) => Promise<unknown>,
        ) => {
          const mockManager = {
            findOne: jest.fn((entityClass: unknown) => {
              if (entityClass === AIProposal) return Promise.resolve(editedProposal);
              if (entityClass === Decision) return Promise.resolve(mockDecision);
              return Promise.resolve(null);
            }),
            query: jest.fn().mockResolvedValue([{ max: 10 }]),
            create: jest.fn((_entityClass: unknown, plainObject: unknown) => ({
              id: 'gen-task-id',
              ...(plainObject as object),
            })),
            save: jest.fn((entityClass: unknown, plainObject: unknown) => {
              if (entityClass === Task) capturedTask = plainObject as Task;
              return Promise.resolve({ id: 'saved-id', ...(plainObject as object) });
            }),
          };
          return cb(mockManager);
        },
      );

      // Confirm only 'edited-item-1' with version 2
      const res = await service.confirmProposal(
        mockProjectId,
        mockActor,
        'prop-edited-123',
        { version: 2, selectedItemIds: ['edited-item-1'] },
        'key-edited-confirm',
      );

      // Verify only 1 task created, matching edited fields
      expect(res.resultRecordIds).toHaveLength(1);
      expect(capturedTask).not.toBeNull();
      expect(capturedTask!.title).toBe('Refined Task Title: Custom Stream Parser');
      expect(capturedTask!.description).toBe('Refined task description with edge-case handling');
      expect(capturedTask!.priority).toBe(Priority.URGENT);
      expect(capturedTask!.dueDate).toBe('2026-10-15');
      expect(capturedTask!.requirementId).toBeNull();
      expect(capturedTask!.sourceMeetingId).toBeNull();
    });
  });
});
