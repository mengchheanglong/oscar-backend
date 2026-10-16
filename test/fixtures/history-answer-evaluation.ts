import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import { AiService } from '../../src/modules/ai/ai.service';
import { CopilotMemoryService } from '../../src/modules/ai/copilot-memory.service';
import { HistoryRecallService } from '../../src/modules/ai/context/history-recall.service';
import {
  ConversationContextService,
  ConversationScope,
} from '../../src/modules/ai/context/conversation-context.service';
import { User } from '../../src/modules/users/entities/user.entity';
import { Project } from '../../src/modules/projects/entities/project.entity';
import {
  ProjectMember,
  ProjectRole,
} from '../../src/modules/projects/entities/project-member.entity';
import { Conversation, AiMode } from '../../src/modules/ai/entities/conversation.entity';
import {
  ChatMessage,
  MessageRole,
  MessageStatus,
} from '../../src/modules/ai/entities/chat-message.entity';
import { CopilotMemoryKind } from '../../src/modules/ai/entities/copilot-memory.entity';
import { ChatCompletionMessage } from '../../src/modules/ai/llm/llm-provider.interface';

export const ANSWER_CASES = [
  'same_chat_early_fact',
  'cross_chat_paraphrase',
  'current_correction',
  'later_chat_correction',
  'assistant_suggestion',
  'excluded_fact',
  'other_owner',
  'other_project',
  'updated_preference',
  'compacted_fact',
] as const;
export type AnswerCase = (typeof ANSWER_CASES)[number];
export function gradeHistoryAnswer(
  content: string,
  expected: string,
  forbidden: readonly string[],
  status: string,
  citations: number,
) {
  const words: string[] = content.toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  const forbiddenMentioned = forbidden.filter((token) => words.includes(token));
  const normalized = words.join(' ');
  const formatCorrect = normalized === expected;
  // A token mention alone must not pass negation, uncertainty or multiple answers.
  const affirmative =
    /^(?:YOUR|THE) (?:LABEL|MODE|CURRENCY|CURRENCY CODE|ALERT MODE|PREFERRED ALERT MODE) IS ([A-Z0-9]+)$/.exec(
      normalized,
    );
  const factCorrect =
    (formatCorrect || (expected !== 'UNKNOWN' && affirmative?.[1] === expected)) &&
    !forbiddenMentioned.length;
  return {
    passed: factCorrect && status === MessageStatus.COMPLETED && citations === 0,
    factCorrect,
    formatCorrect,
    forbiddenMentioned,
    citations,
    status,
  };
}
export interface AnswerEvaluationDependencies {
  ai: Pick<AiService, 'postMessage'>;
  recall: Pick<HistoryRecallService, 'indexBatch'>;
  context: Pick<ConversationContextService, 'excludeMessage'>;
  memory: Pick<CopilotMemoryService, 'create' | 'update'>;
  config: ConfigService;
  trace?: () =>
    | {
        messages: ChatCompletionMessage[];
        excerpts: number;
        compactions: number;
        estimated: number;
      }
    | undefined;
  progress?: (name: AnswerCase, passed: boolean) => void;
}

/** Synthetic data only. Real model quality is established only by the live CLI. */
export async function evaluateHistoryAnswers(
  db: DataSource,
  deps: AnswerEvaluationDependencies,
  cases: readonly AnswerCase[] = ANSWER_CASES,
) {
  const url = (db.options as { url?: string }).url;
  if (!url || !new URL(url).pathname.endsWith('_test'))
    throw new Error('EVAL_TEST_DATABASE_REQUIRED');
  if (
    !cases.length ||
    cases.length > ANSWER_CASES.length ||
    new Set(cases).size !== cases.length ||
    cases.some((c) => !ANSWER_CASES.includes(c))
  )
    throw new Error('EVAL_CASES_INVALID');
  const results = [];
  for (const name of cases) {
    const users: User[] = [],
      projects: Project[] = [];
    const originalBudget = deps.config.get<number>('AI_CONTEXT_INPUT_BUDGET', 128000);
    try {
      for (let i = 0; i < 2; i++)
        users.push(
          await db.getRepository(User).save({
            email: `${randomUUID()}@answer-eval.test`,
            displayName: 'Synthetic answer evaluation',
            passwordHash: 'synthetic-no-login',
          }),
        );
      const owner = users[0]!,
        other = users[1]!;
      for (let i = 0; i < 2; i++) {
        const p = await db.getRepository(Project).save({
          key: 'E' + randomUUID().slice(0, 7).toUpperCase(),
          name: 'Synthetic answer evaluation',
          createdBy: owner.id,
        });
        projects.push(p);
        await db.getRepository(ProjectMember).save([
          { projectId: p.id, userId: owner.id, accessRole: ProjectRole.OWNER },
          { projectId: p.id, userId: other.id, accessRole: ProjectRole.VIEWER },
        ]);
      }
      const chat = async (
        projectId = projects[0]!.id,
        userId = owner.id,
      ): Promise<ConversationScope> => {
        const c = await db.getRepository(Conversation).save({
          projectId,
          userId,
          title: 'Synthetic answer evaluation',
          defaultMode: AiMode.WORKSPACE,
        });
        return { projectId, userId, conversationId: c.id };
      };
      const put = (s: ConversationScope, content: string, role = MessageRole.USER) =>
        db
          .getRepository(ChatMessage)
          .save({ conversationId: s.conversationId, content, role, mode: AiMode.WORKSPACE });
      const target = await chat();
      let expected = 'CEDAR',
        query = 'What is my Juniper archive label?',
        forbidden: string[] = [];
      if (name === 'same_chat_early_fact') {
        await put(target, 'My personal Juniper archive label is CEDAR.');
        for (let i = 0; i < 14; i++) {
          await put(target, `Unrelated practice turn ${i}: I am discussing a typography exercise.`);
          await put(target, 'We can revisit that exercise later.', MessageRole.ASSISTANT);
        }
      } else if (name === 'cross_chat_paraphrase') {
        await put(
          await chat(),
          'I want my desk alerts to make no sound. My preferred alert mode is SILENT.',
        );
        expected = 'SILENT';
        query = 'When a notification arrives at my workstation, which alert mode do I prefer?';
        await deps.recall.indexBatch(target);
      } else if (name === 'current_correction' || name === 'later_chat_correction') {
        await put(await chat(), 'My personal Atlas planning label is ORCHID.');
        expected = 'AMBER';
        forbidden = ['ORCHID'];
        query = 'Which personal Atlas planning label do I use now?';
        if (name === 'later_chat_correction')
          await put(await chat(), 'My personal Atlas planning label is AMBER.');
        else
          query =
            'Correction: my personal Atlas planning label is now AMBER. Which label do I use now?';
        await deps.recall.indexBatch(target);
      } else if (name === 'assistant_suggestion') {
        const source = await chat();
        await put(source, 'I have not chosen my personal Willow planning label.');
        await put(
          source,
          'I suggest choosing VIOLET as your Willow planning label.',
          MessageRole.ASSISTANT,
        );
        expected = 'UNKNOWN';
        forbidden = ['VIOLET'];
        query = 'Which personal Willow planning label did I choose?';
        await deps.recall.indexBatch(target);
      } else if (name === 'excluded_fact') {
        const source = await chat();
        const m = await put(source, 'My personal Quince archive label is SCARLET.');
        await deps.recall.indexBatch(target);
        await deps.context.excludeMessage(source, m.id);
        expected = 'UNKNOWN';
        forbidden = ['SCARLET'];
        query = 'What is my personal Quince archive label?';
      } else if (name === 'other_owner' || name === 'other_project') {
        const source =
          name === 'other_owner'
            ? await chat(projects[0]!.id, other.id)
            : await chat(projects[1]!.id);
        await put(source, 'My private Nectar archive label is INDIGO.');
        await deps.recall.indexBatch(source);
        expected = 'UNKNOWN';
        forbidden = ['INDIGO'];
        query = 'What private Nectar archive label did I tell you?';
      } else if (name === 'updated_preference') {
        const memory = await deps.memory.create(target.projectId, owner.id, {
          kind: CopilotMemoryKind.PREFERENCE,
          content: 'For my personal Beacon estimates, I prefer the currency EUR.',
          idempotencyKey: randomUUID(),
          userConfirmed: true,
        });
        await deps.memory.update(target.projectId, owner.id, memory.id, {
          kind: CopilotMemoryKind.PREFERENCE,
          content: 'For my personal Beacon estimates, I prefer the currency GBP.',
          version: memory.version,
          userConfirmed: true,
        });
        expected = 'GBP';
        forbidden = ['EUR'];
        query = 'Which currency do I prefer for my personal Beacon estimates?';
      } else if (name === 'compacted_fact') {
        deps.config.set('AI_CONTEXT_INPUT_BUDGET', 16000);
        await put(
          target,
          'My personal Rowan vault label is COPPER. This is an important detail to retain.',
        );
        for (let i = 0; i < 30; i++) {
          await put(
            target,
            `Unrelated typography practice ${i}. ` +
              'We are comparing heading sizes and line spacing in a disposable example. '.repeat(5),
          );
          await put(target, 'This was only a formatting exercise.', MessageRole.ASSISTANT);
        }
        expected = 'COPPER';
        query = 'What is my personal Rowan vault label?';
      }
      const started = performance.now();
      const answer = await deps.ai.postMessage(target.projectId, owner.id, target.conversationId, {
        content: `${query} Reply with only the label, mode or currency code. If I have not supplied a chosen value in the context available to you, reply UNKNOWN.`,
        mode: AiMode.WORKSPACE,
        includeAllWorkspaces: name === 'other_project',
      });
      const grade = gradeHistoryAnswer(
        answer.assistantMessage.content,
        expected,
        forbidden,
        answer.assistantMessage.status,
        answer.assistantMessage.citations.length,
      );
      const summaries: { revision: number; through_seq: string }[] = await db.query(
        'SELECT revision,through_seq::text FROM ai_conversation_context WHERE conversation_id=$1 AND project_id=$2 AND user_id=$3',
        [target.conversationId, target.projectId, owner.id],
      );
      const compacted = name !== 'compacted_fact' || (summaries[0]?.revision ?? 0) > 0;
      const trace = deps.trace?.();
      const serialized = trace ? JSON.stringify(trace.messages) : '';
      results.push({
        name,
        expected,
        answer: answer.assistantMessage.content,
        ...grade,
        passed: grade.passed && compacted,
        elapsedMs: Math.round(performance.now() - started),
        compactionVerified: compacted,
        context: trace
          ? {
              excerpts: trace.excerpts,
              compactions: trace.compactions,
              estimated: trace.estimated,
              expectedInContext: serialized.includes(expected),
              forbiddenInContext: forbidden.filter((t) => serialized.includes(t)),
            }
          : null,
        model: answer.assistantMessage.modelName,
      });
      deps.progress?.(name, grade.passed && compacted);
    } catch (error: unknown) {
      const response = error instanceof HttpException ? error.getResponse() : null;
      const code =
        typeof response === 'object' && response && 'code' in response ? String(response.code) : '';
      results.push({
        name,
        expected: null,
        answer: null,
        passed: false,
        factCorrect: false,
        formatCorrect: false,
        forbiddenMentioned: [] as string[],
        citations: 0,
        status: 'EVAL_CASE_ERROR',
        elapsedMs: null,
        compactionVerified: false,
        context: null,
        model: null,
        error: /^(CONTEXT_[A-Z_]+|HISTORY_CHANGED|AI_[A-Z_]+)$/.test(code)
          ? code
          : 'CASE_EXECUTION_FAILED',
      });
      deps.progress?.(name, false);
    } finally {
      deps.config.set('AI_CONTEXT_INPUT_BUDGET', originalBudget);
      for (const p of projects) await db.getRepository(Project).delete(p.id);
      for (const u of users) await db.getRepository(User).delete(u.id);
    }
  }
  return {
    dataset: 'english-history-answers-v1',
    cases: results,
    summary: {
      passed: results.filter((r) => r.passed).length,
      total: results.length,
      formatPassed: results.filter((r) => r.formatCorrect).length,
      forbiddenMentions: results.reduce((n, r) => n + r.forbiddenMentioned.length, 0),
    },
    notes:
      'Small synthetic English answer evaluation through AiService; exact expected-value grading, no model judge. Does not establish general accuracy, HTTP/browser behavior or production latency.',
  };
}
