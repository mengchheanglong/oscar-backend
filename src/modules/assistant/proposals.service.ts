import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Decision } from '../decisions/entities/decision.entity';
import { Goal } from '../goals/entities/goal.entity';
import { OutboxService } from '../ingestion/outbox.service';
import { ProjectMember, ProjectRole } from '../projects/entities/project-member.entity';
import { Project } from '../projects/entities/project.entity';
import { Priority, Task, TaskStatus } from '../tasks/entities/task.entity';
import { User } from '../users/entities/user.entity';
import { Document } from '../documents/entities/document.entity';

import { ConfirmProposalDto } from './dto/confirm-proposal.dto';
import {
  TaskDraftItem,
  TaskProposalPayload,
  TaskProposalPayloadSchema,
} from './dto/task-proposal.dto';
import { UpdateProposalDto } from './dto/update-proposal.dto';
import { ProposalCommit } from './entities/proposal-commit.entity';
import { AssistantProposal, ProposalStatus, ProposalType } from './entities/proposal.entity';
import { LlmProvider } from './llm/llm-provider.interface';

@Injectable()
export class ProposalsService {
  constructor(
    @InjectRepository(AssistantProposal)
    private readonly proposalRepository: Repository<AssistantProposal>,
    @InjectRepository(ProposalCommit)
    private readonly commitRepository: Repository<ProposalCommit>,
    @InjectRepository(Decision)
    private readonly decisionRepository: Repository<Decision>,
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(ProjectMember)
    private readonly memberRepository: Repository<ProjectMember>,
    @Inject('LLM_PROVIDER')
    private readonly llmProvider: LlmProvider,
    private readonly auditService: AuditService,
    private readonly outboxService: OutboxService,
    private readonly dataSource: DataSource,
  ) {}

  async generateDecisionTaskProposal(
    projectId: string,
    userId: string,
    decisionId: string,
  ): Promise<AssistantProposal> {
    const decision = await this.decisionRepository.findOne({
      where: { id: decisionId, projectId, deletedAt: IsNull() },
    });

    if (!decision) {
      throw new NotFoundException({
        code: 'DECISION_NOT_FOUND',
        message: 'Decision not found in project.',
      });
    }

    const systemPrompt = `You are a Principal Software Architect and Project Manager. Break down the user's architectural decision into 2 to 4 actionable, specific implementation development tasks.
Respond with a JSON object matching this structure:
{
  "type": "CREATE_TASKS",
  "items": [
    {
      "itemId": "draft-item-1",
      "title": "Task title",
      "description": "Task description explaining how this implements the architectural decision",
      "priority": "LOW" | "MEDIUM" | "HIGH" | "URGENT",
      "assigneeId": null,
      "dueDate": null,
      "sourceIds": ["${decision.id}"]
    }
  ]
}`;

    const userPrompt = `Architectural Decision: ${decision.title}
Key: ADR-${decision.number}
Status: ${decision.status}
Decision Text: ${decision.decisionText}
Rationale: ${decision.rationale || 'N/A'}
Revision: ${decision.version}

Generate clear development task breakdown implementing this architectural decision.`;

    const result = await this.llmProvider.generateStructuredOutput<TaskProposalPayload>({
      systemPrompt,
      userPrompt,
      schemaDescription:
        'JSON object with "type": "CREATE_TASKS" and "items" array of tasks with itemId, title, description, priority, assigneeId, dueDate, sourceIds',
    });

    const parsedPayload = TaskProposalPayloadSchema.parse(result.data);

    // Ensure sourceIds contains the decision id
    parsedPayload.items = parsedPayload.items.map((item) => ({
      ...item,
      sourceIds: [decision.id],
    }));

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const proposal = this.proposalRepository.create({
      projectId,
      userId,
      proposalType: ProposalType.TASK_PROPOSAL,
      sourceEntityType: 'DECISION',
      sourceEntityId: decision.id,
      sourceRevision: decision.version,
      draftJson: parsedPayload,
      version: 1,
      status: ProposalStatus.PENDING,
      expiresAt,
      resultRecordIds: [],
    });

    const saved = await this.proposalRepository.save(proposal);

    await this.auditService.record({
      projectId,
      actorId: userId,
      action: 'AI_TASK_PROPOSAL_GENERATED',
      entityType: 'AI_PROPOSAL',
      entityId: saved.id,
      metadata: {
        decisionId: decision.id,
        revision: decision.version,
        itemCount: parsedPayload.items.length,
      },
    });

    return saved;
  }

  async listProposals(
    projectId: string,
    userId: string,
    status?: ProposalStatus,
  ): Promise<AssistantProposal[]> {
    const qb = this.proposalRepository
      .createQueryBuilder('proposal')
      .where('proposal.projectId = :projectId', { projectId })
      .andWhere('proposal.userId = :userId', { userId })
      .andWhere(
        'proposal.sourceEntityType = :sourceType AND proposal.proposalType = :proposalType',
        { sourceType: 'DECISION', proposalType: ProposalType.TASK_PROPOSAL },
      );

    if (status) {
      qb.andWhere('proposal.status = :status', { status });
    }

    qb.orderBy('proposal.createdAt', 'DESC');

    const proposals = await qb.getMany();
    const now = new Date();

    // Auto-mark expired proposals
    for (const p of proposals) {
      if (p.status === ProposalStatus.PENDING && p.expiresAt < now) {
        p.status = ProposalStatus.EXPIRED;
        await this.proposalRepository.save(p);
      }
    }

    return proposals;
  }

  async getProposal(
    projectId: string,
    userId: string,
    proposalId: string,
  ): Promise<AssistantProposal> {
    const proposal = await this.proposalRepository.findOne({
      where: { id: proposalId, projectId, userId },
    });

    if (!proposal) {
      throw new NotFoundException({
        code: 'PROPOSAL_NOT_FOUND',
        message: 'Proposal not found in project.',
      });
    }

    if (
      proposal.sourceEntityType !== 'DECISION' ||
      proposal.proposalType !== ProposalType.TASK_PROPOSAL
    ) {
      throw new BadRequestException({
        code: 'FEATURE_RETIRED',
        message: 'This proposal belongs to a retired feature and cannot be changed.',
      });
    }

    // Check expiry
    if (proposal.status === ProposalStatus.PENDING && proposal.expiresAt < new Date()) {
      proposal.status = ProposalStatus.EXPIRED;
      await this.proposalRepository.save(proposal);
    }

    return proposal;
  }

  async updateProposal(
    projectId: string,
    userId: string,
    proposalId: string,
    dto: UpdateProposalDto,
  ): Promise<AssistantProposal> {
    const proposal = await this.getProposal(projectId, userId, proposalId);

    if (proposal.status !== ProposalStatus.PENDING) {
      throw new BadRequestException({
        code: 'PROPOSAL_NOT_PENDING',
        message: `Cannot edit proposal with status ${proposal.status}.`,
      });
    }

    if (proposal.version !== dto.version) {
      throw new ConflictException({
        code: 'CONCURRENCY_CONFLICT',
        message: 'Proposal has been modified by another request. Please reload.',
      });
    }

    // Validate draftJson schema based on proposalType
    if (proposal.proposalType === ProposalType.TASK_PROPOSAL) {
      const validated = TaskProposalPayloadSchema.safeParse(dto.draftJson);
      if (!validated.success) {
        throw new BadRequestException({
          code: 'INVALID_PROPOSAL_DRAFT',
          message:
            'Task drafts need unique item IDs, a nonblank title of at most 500 characters, valid priority and assignee, and a description of at most 5000 characters.',
        });
      }
      const parsed = validated.data;
      const original = TaskProposalPayloadSchema.parse(proposal.draftJson);
      // Provenance is server-owned; edits cannot manufacture document citations.
      parsed.sourceReferences = original.sourceReferences;
      parsed.items = parsed.items.map((item) => ({
        ...item,
        sourceIds: [proposal.sourceEntityId],
      }));
      dto = { ...dto, draftJson: parsed };
    }

    proposal.draftJson = dto.draftJson;
    proposal.version += 1;

    return this.proposalRepository.save(proposal);
  }

  async rejectProposal(
    projectId: string,
    userId: string,
    proposalId: string,
  ): Promise<AssistantProposal> {
    const proposal = await this.getProposal(projectId, userId, proposalId);

    if (proposal.status !== ProposalStatus.PENDING) {
      throw new BadRequestException({
        code: 'PROPOSAL_NOT_PENDING',
        message: `Cannot reject proposal with status ${proposal.status}.`,
      });
    }

    proposal.status = ProposalStatus.REJECTED;
    const saved = await this.proposalRepository.save(proposal);

    await this.auditService.record({
      projectId,
      actorId: userId,
      action: 'AI_PROPOSAL_REJECTED',
      entityType: 'AI_PROPOSAL',
      entityId: saved.id,
      metadata: { proposalType: saved.proposalType },
    });

    return saved;
  }

  async confirmProposal(
    projectId: string,
    actor: User,
    proposalId: string,
    dto: ConfirmProposalDto,
    idempotencyKey: string,
  ): Promise<{
    proposal: AssistantProposal;
    resultRecordIds: Array<{ entityType: string; id: string; key?: string }>;
  }> {
    if (!idempotencyKey || !idempotencyKey.trim()) {
      throw new BadRequestException({
        code: 'MISSING_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key header is required for proposal confirmation.',
      });
    }

    const project = await this.projectRepository.findOne({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found.',
      });
    }

    // Check project write permission
    const membership = await this.memberRepository.findOne({
      where: { projectId, userId: actor.id, removedAt: IsNull() },
    });

    if (
      !membership ||
      ![ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.CONTRIBUTOR].includes(
        membership.accessRole,
      )
    ) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have write permissions to confirm proposals in this project.',
      });
    }

    const payloadHash = createHash('sha256')
      .update(JSON.stringify({ proposalId, dto }))
      .digest('hex');

    // 1. Idempotency check: look up existing commit
    const existingCommit = await this.commitRepository.findOne({
      where: { actorId: actor.id, projectId, idempotencyKey: idempotencyKey.trim() },
    });

    if (existingCommit) {
      if (existingCommit.payloadHash === payloadHash) {
        // Idempotent replay: return previous result
        const existingProposal = await this.proposalRepository.findOne({
          where: { id: existingCommit.proposalId },
        });
        return {
          proposal: existingProposal || ({} as AssistantProposal),
          resultRecordIds: existingCommit.resultRecordIds,
        };
      } else {
        throw new ConflictException({
          code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
          message: 'Idempotency key was already used with a different confirmation payload.',
        });
      }
    }

    // 2. Transactional confirmation
    return this.dataSource.transaction(async (manager) => {
      // Row lock on AssistantProposal
      const proposal = await manager.findOne(AssistantProposal, {
        where: { id: proposalId, projectId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!proposal) {
        throw new NotFoundException({
          code: 'PROPOSAL_NOT_FOUND',
          message: 'Proposal not found in project.',
        });
      }

      if (proposal.userId !== actor.id) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'This proposal is private to its creator.',
        });
      }

      if (proposal.status === ProposalStatus.CONFIRMED) {
        return { proposal, resultRecordIds: proposal.resultRecordIds };
      }

      if (proposal.status !== ProposalStatus.PENDING) {
        throw new BadRequestException({
          code: 'PROPOSAL_NOT_PENDING',
          message: `Cannot confirm proposal with status ${proposal.status}.`,
        });
      }

      if (proposal.expiresAt < new Date()) {
        proposal.status = ProposalStatus.EXPIRED;
        await manager.save(AssistantProposal, proposal);
        throw new BadRequestException({
          code: 'PROPOSAL_EXPIRED',
          message: 'This proposal has expired and cannot be confirmed.',
        });
      }

      if (proposal.version !== dto.version) {
        throw new ConflictException({
          code: 'CONCURRENCY_CONFLICT',
          message: 'Proposal version mismatch. Please reload the draft before confirming.',
        });
      }

      const resultRecordIds: Array<{ entityType: string; id: string; key?: string }> = [];

      if (
        proposal.sourceEntityType !== 'DECISION' ||
        proposal.proposalType !== ProposalType.TASK_PROPOSAL
      ) {
        throw new BadRequestException({
          code: 'FEATURE_RETIRED',
          message: 'This proposal belongs to a retired feature and cannot be changed.',
        });
      }

      // 3. Stale source check & Domain creation
      if (proposal.proposalType === ProposalType.TASK_PROPOSAL) {
        let sourceMetadata: Record<string, unknown> = { proposalId: proposal.id };
        const decision = await manager.findOne(Decision, {
          where: { id: proposal.sourceEntityId, projectId, deletedAt: IsNull() },
        });

        if (!decision) {
          throw new BadRequestException({
            code: 'SOURCE_DECISION_MISSING',
            message: 'Source architectural decision no longer exists.',
          });
        }

        if (decision.version !== proposal.sourceRevision) {
          throw new ConflictException({
            code: 'STALE_PROPOSAL',
            message: `Source decision has been updated to revision ${decision.version} (proposal based on revision ${proposal.sourceRevision}). Please regenerate tasks.`,
          });
        }

        if (decision.goalId) {
          const goal = await manager.findOne(Goal, {
            where: { id: decision.goalId, projectId, deletedAt: IsNull() },
            select: ['id'],
          });
          if (!goal)
            throw new ConflictException(
              'The linked goal is no longer available. Update the decision before confirming.',
            );
        }
        sourceMetadata = {
          ...sourceMetadata,
          decisionId: decision.id,
          decisionKey: `${project.key}-DEC-${decision.number}`,
        };
        const validated = TaskProposalPayloadSchema.safeParse(proposal.draftJson);
        if (!validated.success) {
          throw new BadRequestException({
            code: 'INVALID_PROPOSAL_DRAFT',
            message: 'Task draft validation failed. Edit or regenerate the proposal.',
          });
        }
        const draft = validated.data;
        for (const reference of draft.sourceReferences || []) {
          const document = await manager.findOne(Document, {
            where: { id: reference.sourceId, projectId, deletedAt: IsNull() },
          });
          if (!document || document.revision !== reference.revision) {
            throw new ConflictException({
              code: 'STALE_PROPOSAL',
              message: 'A supporting document changed or was removed. Please regenerate tasks.',
            });
          }
        }
        sourceMetadata = { ...sourceMetadata, sourceReferences: draft.sourceReferences || [] };
        if (dto.selectedItemIds?.some((id) => !draft.items.some((item) => item.itemId === id))) {
          throw new BadRequestException({
            code: 'INVALID_SELECTION',
            message: 'Selected item IDs must belong to this proposal.',
          });
        }
        const selectedItems =
          dto.selectedItemIds !== undefined
            ? draft.items.filter((item: TaskDraftItem) =>
                dto.selectedItemIds!.includes(item.itemId),
              )
            : draft.items;

        if (selectedItems.length === 0) {
          throw new BadRequestException({
            code: 'NO_ITEMS_SELECTED',
            message: 'No task items were selected for creation.',
          });
        }

        for (const item of selectedItems) {
          const maxRes: { max: number | null }[] = await manager.query(
            `SELECT MAX("number") as max FROM "tasks" WHERE "project_id" = $1`,
            [projectId],
          );
          const nextNumber = (maxRes[0]?.max ?? 0) + 1;

          let assigneeId: string | null = null;
          if (item.assigneeId) {
            const member = await manager.findOne(ProjectMember, {
              where: { projectId, userId: item.assigneeId, removedAt: IsNull() },
            });
            if (!member) {
              throw new BadRequestException({
                code: 'ASSIGNEE_NOT_MEMBER',
                message: 'Selected task assignee must be an active member of this project.',
              });
            }
            assigneeId = member.userId;
          }

          const task = manager.create(Task, {
            projectId,
            number: nextNumber,
            title: item.title.trim(),
            description: item.description?.trim() ?? null,
            status: TaskStatus.TODO,
            priority: item.priority ?? Priority.MEDIUM,
            assigneeId,
            dueDate: item.dueDate ? item.dueDate : null,
            requirementId: null,
            sourceMeetingId: null,
            goalId: decision.goalId ?? null,
            createdBy: actor.id,
            updatedBy: actor.id,
            version: 1,
            deletedAt: null,
          });

          const savedTask = await manager.save(Task, task);
          const taskKey = `${project.key}-TASK-${savedTask.number}`;

          await this.outboxService.emit(manager, {
            projectId,
            eventType: 'TASK_CREATED',
            payload: {
              taskId: savedTask.id,
              revision: 1,
              title: savedTask.title,
              description: savedTask.description,
              status: savedTask.status,
              priority: savedTask.priority,
            },
            dedupeKey: `task:${savedTask.id}:1:created`,
          });

          await this.auditService.record({
            projectId,
            actorId: actor.id,
            action: 'TASK_CREATED_FROM_AI_PROPOSAL',
            entityType: 'TASK',
            entityId: savedTask.id,
            metadata: { ...sourceMetadata, key: taskKey },
          });

          resultRecordIds.push({ entityType: 'TASK', id: savedTask.id, key: taskKey });
        }
      }

      // 4. Record commit and mark proposal confirmed
      const commit = manager.create(ProposalCommit, {
        proposalId: proposal.id,
        projectId,
        actorId: actor.id,
        idempotencyKey: idempotencyKey.trim(),
        payloadHash,
        resultRecordIds,
      });
      await manager.save(ProposalCommit, commit);

      proposal.status = ProposalStatus.CONFIRMED;
      proposal.confirmedBy = actor.id;
      proposal.confirmedAt = new Date();
      proposal.resultRecordIds = resultRecordIds;
      const updatedProposal = await manager.save(AssistantProposal, proposal);

      return { proposal: updatedProposal, resultRecordIds };
    });
  }
}
