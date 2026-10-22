import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { createHash } from 'node:crypto';
import { ChiefPreferences } from './entities/chief-preferences.entity';
import { ExecutionReview } from './entities/execution-review.entity';
import { ChiefPreferencesDto, ReviewExecutionDto } from './chief.dto';
import { nextBriefing } from './briefing-schedule';
import { AgentRun } from '../assistant/entities/agent-run.entity';
import { PlatformHandoff } from '../assistant/entities/platform-handoff.entity';
import { Conversation } from '../assistant/entities/conversation.entity';
import { ChatMessage } from '../assistant/entities/chat-message.entity';
import { Goal } from '../goals/entities/goal.entity';
import { measureGoalProgress } from '../goals/goal-progress';
import { ProjectMember, ProjectRole } from '../projects/entities/project-member.entity';
import { ProjectStatus } from '../projects/entities/project.entity';
import {
  MavisMemory,
  MavisMemoryScopeType,
  MavisMemoryStatus,
  MavisMemoryType,
  MavisSourceType,
} from '../mavis/entities/mavis-memory.entity';

type Platform = 'hermes' | 't3' | 'paperclip';
// Rechecked on every read: deleted chats and removed memberships never leak through reviews or snapshots.
const accessible = `EXISTS (SELECT 1 FROM project_members pm JOIN users u ON u.id = pm.user_id
  WHERE pm.project_id = r.project_id AND pm.user_id = $1 AND pm.removed_at IS NULL AND u.is_active = true)
  AND (r.conversation_id IS NULL OR EXISTS (SELECT 1 FROM ai_conversations c WHERE c.id = r.conversation_id
    AND c.project_id = r.project_id AND c.user_id = $1 AND c.deleted_at IS NULL))`;
const workSql = `SELECT id, project_id, goal_id, conversation_id, status, created_at, updated_at, 'hermes'::text AS platform FROM agent_runs r
  WHERE r.user_id = $1 AND ${accessible}
  UNION ALL SELECT id, project_id, goal_id, conversation_id, status, created_at, updated_at, platform_type AS platform FROM platform_handoffs r
  WHERE r.user_id = $1 AND ${accessible}`;

@Injectable()
export class ChiefService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChiefService.name);
  private timer?: NodeJS.Timeout;
  private ticking = false;
  constructor(private readonly db: DataSource) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.generateDueBriefings().catch(() =>
        this.logger.warn('Scheduled briefings could not refresh; the next tick will retry.'),
      );
    }, 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async preferences(userId: string) {
    return (
      (await this.db.getRepository(ChiefPreferences).findOneBy({ userId })) ?? {
        userId,
        cadence: 'OFF' as const,
        hourUtc: 2,
        monthlyBudgetUsd: null,
        nextBriefingAt: null,
        lastBriefingAt: null,
      }
    );
  }
  async savePreferences(userId: string, dto: ChiefPreferencesDto) {
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,62))', [userId]);
      const existing = await tx.getRepository(ChiefPreferences).findOneBy({ userId });
      return tx.getRepository(ChiefPreferences).save({
        userId,
        cadence: dto.cadence,
        hourUtc: dto.hourUtc,
        monthlyBudgetUsd: dto.monthlyBudgetUsd === null ? null : String(dto.monthlyBudgetUsd),
        lastBriefingAt: existing?.lastBriefingAt ?? null,
        nextBriefingAt:
          existing?.cadence === dto.cadence && existing.hourUtc === dto.hourUtc
            ? existing.nextBriefingAt
            : nextBriefing(new Date(), dto.cadence, dto.hourUtc),
      });
    });
  }
  async briefing(userId: string, projectId?: string) {
    if (projectId) await this.membership(this.db.manager, userId, projectId, false);
    const preferences = await this.preferences(userId);
    const goals = await this.db
      .getRepository(Goal)
      .createQueryBuilder('g')
      .leftJoinAndSelect('g.metrics', 'metric')
      .where('g.deletedAt IS NULL AND g.status IN (:...statuses)', {
        statuses: ['ACTIVE', 'PLANNED'],
      })
      .andWhere(
        `(g.projectId IS NULL AND g.userId = :userId OR EXISTS (SELECT 1 FROM project_members pm
        JOIN projects p ON p.id = pm.project_id JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id = g.project_id AND pm.user_id = :userId AND pm.removed_at IS NULL AND p.status = 'ACTIVE' AND u.is_active = true))`,
        { userId },
      )
      .andWhere(projectId ? 'g.projectId = :projectId' : 'TRUE', { projectId })
      .orderBy('g.updatedAt', 'DESC')
      .take(100)
      .getMany();
    const tasks: Array<{
      id: string;
      projectId: string;
      title: string;
      status: string;
      dueDate: string | null;
    }> = await this.db.query(
      `
      SELECT t.id, t.project_id AS "projectId", t.title, t.status, t.due_date AS "dueDate" FROM tasks t
      JOIN projects p ON p.id = t.project_id WHERE t.deleted_at IS NULL AND p.status = 'ACTIVE'
      AND t.status IN ('BLOCKED','IN_REVIEW','IN_PROGRESS','TODO')
      AND EXISTS(SELECT 1 FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id = t.project_id
        AND pm.user_id = $1 AND pm.removed_at IS NULL AND u.is_active = true)
      AND ($2::uuid IS NULL OR t.project_id = $2)
      ORDER BY (t.status = 'BLOCKED') DESC, t.due_date ASC NULLS LAST, t.updated_at DESC LIMIT 50`,
      [userId, projectId ?? null],
    );
    const work: Array<{
      id: string;
      projectId: string;
      goalId: string | null;
      conversationId: string | null;
      platform: Platform;
      status: string;
      review: { verdict: string; observation: string; memoryId: string | null } | null;
    }> = await this.db.query(
      `
      SELECT w.id, w.project_id AS "projectId", w.goal_id AS "goalId", w.conversation_id AS "conversationId", w.platform, w.status,
      CASE WHEN v.id IS NOT NULL THEN json_build_object('verdict',v.verdict,'observation',v.observation,'memoryId',v.memory_id) ELSE NULL END AS review
      FROM (${workSql}) w LEFT JOIN execution_reviews v ON v.run_id = w.id AND v.platform = w.platform AND v.user_id = $1
      WHERE ($2::uuid IS NULL OR w.project_id = $2) ORDER BY w.updated_at DESC LIMIT 50`,
      [userId, projectId ?? null],
    );
    const period = new Date().toISOString().slice(0, 7);
    const budgetRows: Array<{ reportedUsd: string; unknownRuns: string; trackedRuns: string }> =
      await this.db.query(
        `
      SELECT COALESCE(sum(v.reported_cost_usd),0)::text AS "reportedUsd",
        count(*) FILTER(WHERE v.reported_cost_usd IS NULL)::text AS "unknownRuns", count(*)::text AS "trackedRuns"
      FROM (${workSql}) w LEFT JOIN execution_reviews v ON v.run_id = w.id AND v.platform = w.platform AND v.user_id = $1
      WHERE w.created_at >= $2::timestamptz AND w.created_at < $2::timestamptz + interval '1 month'
      `,
        [userId, `${period}-01T00:00:00.000Z`],
      );
    const budget = budgetRows[0]!;
    return {
      generatedAt: new Date().toISOString(),
      preferences,
      goals: goals.map((g) => ({
        id: g.id,
        projectId: g.projectId,
        title: g.title,
        targetDate: g.targetDate,
        risks: g.risks,
        ...measureGoalProgress(g, g.metrics),
      })),
      tasks,
      work,
      budget: {
        period,
        currency: 'USD',
        reportedUsd: Number(budget.reportedUsd),
        unknownRuns: Number(budget.unknownRuns),
        trackedRuns: Number(budget.trackedRuns),
        monthlyBudgetUsd:
          preferences.monthlyBudgetUsd === null ? null : Number(preferences.monthlyBudgetUsd),
        overBudget:
          preferences.monthlyBudgetUsd !== null &&
          Number(budget.reportedUsd) > Number(preferences.monthlyBudgetUsd),
        scope: 'workspace',
        costSource: 'user_reported',
        notice:
          'User-reported costs for tracked runs started this month (UTC). Unknown costs are not zero. Provider invoices, OSCAR chat, embeddings and external work are not included. This threshold does not stop spending.',
      },
    };
  }
  private async membership(tx: EntityManager, userId: string, projectId: string, write: boolean) {
    const m = await tx.getRepository(ProjectMember).findOne({
      where: { userId, projectId, removedAt: IsNull() },
      relations: ['project', 'user'],
    });
    if (
      !m?.user?.isActive ||
      !m.project ||
      (write &&
        (m.project.status === ProjectStatus.ARCHIVED ||
          ![ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.CONTRIBUTOR].includes(
            m.accessRole,
          )))
    ) {
      throw new NotFoundException('Project unavailable for this operation.');
    }
  }
  private async source(
    tx: EntityManager,
    userId: string,
    platform: Platform,
    id: string,
    write = true,
  ) {
    const run =
      platform === 'hermes'
        ? await tx.getRepository(AgentRun).findOneBy({ id, userId })
        : await tx.getRepository(PlatformHandoff).findOneBy({ id, userId, platformType: platform });
    if (!run) throw new NotFoundException('Execution not found.');
    await this.membership(tx, userId, run.projectId, write);
    if (
      run.conversationId &&
      !(await tx.getRepository(Conversation).findOneBy({
        id: run.conversationId,
        userId,
        projectId: run.projectId,
        deletedAt: IsNull(),
      }))
    ) {
      throw new NotFoundException('Execution chat is unavailable.');
    }
    return run;
  }
  async getReview(userId: string, platform: Platform, id: string) {
    await this.source(this.db.manager, userId, platform, id, false);
    return this.db.getRepository(ExecutionReview).findOneBy({ userId, platform, runId: id });
  }
  async review(userId: string, platform: Platform, id: string, dto: ReviewExecutionDto) {
    const observation = dto.observation.trim(),
      lesson = dto.lesson?.trim() || null;
    if (!observation || (dto.lesson !== undefined && !lesson))
      throw new BadRequestException('Enter your observation and a nonempty lesson.');
    const hash = createHash('sha256')
      .update(
        JSON.stringify([
          platform,
          id,
          dto.verdict,
          observation,
          lesson,
          dto.reportedCostUsd ?? null,
        ]),
      )
      .digest('hex');
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,63))', [
        userId + dto.idempotencyKey,
      ]);
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,64))', [
        userId + platform + id,
      ]);
      const run = await this.source(tx, userId, platform, id);
      const repo = tx.getRepository(ExecutionReview);
      const previous = await repo
        .createQueryBuilder('v')
        .addSelect('v.payloadHash')
        .where('v.userId = :userId AND v.idempotencyKey = :key', {
          userId,
          key: dto.idempotencyKey,
        })
        .getOne();
      if (previous) {
        if (previous.payloadHash !== hash)
          throw new ConflictException('This retry key belongs to a different review.');
        return previous;
      }
      if (await repo.findOneBy({ userId, platform, runId: id }))
        throw new ConflictException('This execution has already been reviewed.');
      if (!['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(run.status))
        throw new BadRequestException('Wait for the execution to finish before reviewing it.');
      if ((dto.verdict === 'ACCEPTED' || lesson) && run.status !== 'SUCCEEDED')
        throw new BadRequestException(
          'Only a completed successful execution can be accepted or saved as a lesson.',
        );
      if (lesson && dto.verdict !== 'ACCEPTED')
        throw new BadRequestException('Accept the checked outcome before proposing a lesson.');
      const goal = run.goalId
        ? await tx
            .getRepository(Goal)
            .findOneBy({ id: run.goalId, projectId: run.projectId, deletedAt: IsNull() })
        : null;
      const review = await repo.save(
        repo.create({
          userId,
          projectId: run.projectId,
          platform,
          runId: id,
          goalId: goal?.id ?? null,
          verdict: dto.verdict,
          observation,
          reportedCostUsd: dto.reportedCostUsd == null ? null : String(dto.reportedCostUsd),
          idempotencyKey: dto.idempotencyKey,
          payloadHash: hash,
          memoryId: null,
        }),
      );
      if (lesson) {
        if (platform !== 'hermes') {
          const message = run.assistantMessageId
            ? await tx.getRepository(ChatMessage).findOneBy({
                id: run.assistantMessageId,
                conversationId: run.conversationId!,
                contextExcluded: false,
              })
            : null;
          if (!message)
            throw new BadRequestException(
              'Wait for OSCAR to publish the result before saving a lesson.',
            );
        }
        const memory = await tx.getRepository(MavisMemory).save({
          userId,
          projectId: run.projectId,
          goalId: goal?.id ?? null,
          scopeType: goal ? MavisMemoryScopeType.GOAL : MavisMemoryScopeType.PROJECT,
          type: MavisMemoryType.LESSON,
          status: MavisMemoryStatus.PROPOSED,
          statement: lesson,
          rationale: observation,
          sourcePlatform: platform,
          sourceType:
            platform === 'hermes' ? MavisSourceType.AGENT_RUN : MavisSourceType.CHAT_MESSAGE,
          sourceId: platform === 'hermes' ? run.id : run.assistantMessageId,
          sourceMetadata: {
            executionId: run.id,
            reviewId: review.id,
            conversationId: run.conversationId,
            verification: 'user_reviewed',
          },
          validFrom: new Date(),
          version: 1,
        });
        review.memoryId = memory.id;
        await repo.save(review);
      }
      // Goal measurements and approved memory remain separate, explicit human operations.
      return review;
    });
  }
  async generateDueBriefings(now = new Date()): Promise<number> {
    if (this.ticking) return 0;
    this.ticking = true;
    let generated = 0;
    try {
      await this.db.query(
        `DELETE FROM chief_briefings WHERE scheduled_at < $1::timestamptz - interval '31 days'`,
        [now],
      );
      const due: Array<{ userId: string }> = await this.db.query(
        `SELECT p.user_id AS "userId" FROM chief_preferences p JOIN users u ON u.id = p.user_id
        WHERE p.cadence <> 'OFF' AND p.next_briefing_at <= $1 AND u.is_active = true ORDER BY p.next_briefing_at LIMIT 25`,
        [now],
      );
      for (const { userId } of due) {
        await this.db.transaction(async (tx) => {
          const [lock] = (await tx.query(
            'SELECT pg_try_advisory_xact_lock(hashtextextended($1,62)) AS locked',
            [userId],
          )) as Array<{ locked: boolean }>;
          if (!lock?.locked) return;
          const prefs = await tx.getRepository(ChiefPreferences).findOneBy({ userId });
          if (!prefs?.nextBriefingAt || prefs.cadence === 'OFF' || prefs.nextBriefingAt > now)
            return;
          const snapshot = await this.briefing(userId);
          await tx.query(
            `INSERT INTO chief_briefings(user_id,scheduled_at,snapshot) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
            [userId, prefs.nextBriefingAt, JSON.stringify(snapshot)],
          );
          prefs.lastBriefingAt = now;
          prefs.nextBriefingAt = nextBriefing(now, prefs.cadence, prefs.hourUtc);
          await tx.getRepository(ChiefPreferences).save(prefs);
          generated++;
        });
      }
    } finally {
      this.ticking = false;
    }
    return generated;
  }
}
