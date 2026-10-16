import 'reflect-metadata';
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../src/database/database-options';
import { AiService } from '../src/modules/ai/ai.service';
import { CopilotMemoryService } from '../src/modules/ai/copilot-memory.service';
import { HistoryRecallService } from '../src/modules/ai/context/history-recall.service';
import { ConversationContextService } from '../src/modules/ai/context/conversation-context.service';
import {
  ANSWER_CASES,
  AnswerCase,
  evaluateHistoryAnswers,
  AnswerEvaluationDependencies,
} from '../test/fixtures/history-answer-evaluation';
import { EvaluationNetworkBudget } from './lib/evaluation-network-budget';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] !== '--live' || args[1] !== '--confirm-provider-cost' || args.length > 3)
    throw new Error('EVAL_MODE_REQUIRED');
  const only = args[2];
  if (only && !only.startsWith('--only=')) throw new Error('EVAL_CASES_INVALID');
  const names = only ? only.slice(7).split(',') : ANSWER_CASES;
  if (
    names.some((name) => !ANSWER_CASES.includes(name as AnswerCase)) ||
    new Set(names).size !== names.length
  )
    throw new Error('EVAL_CASES_INVALID');
  const originalDatabase = process.env.DATABASE_URL;
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_test') || url === originalDatabase)
    throw new Error('EVAL_TEST_DATABASE_REQUIRED');
  if (
    !process.env.DEEPSEEK_API_KEY ||
    process.env.AI_CHAT_MODEL !== 'deepseek-v4-pro' ||
    process.env.AI_EMBEDDING_PROVIDER !== 'openai' ||
    !process.env.OPENAI_API_KEY
  )
    throw new Error('EVAL_PROVIDERS_REQUIRED');
  const preflight = await new DataSource(databaseOptions(url)).initialize();
  try {
    if (await preflight.showMigrations()) throw new Error('EVAL_MIGRATIONS_REQUIRED');
  } finally {
    await preflight.destroy();
  }
  // Process-local overrides only. Never change the real .env or development DB.
  Object.assign(process.env, {
    DATABASE_URL: url,
    NODE_ENV: 'test',
    AI_ENABLED: 'true',
    AI_HISTORY_AUTO_INDEX_ENABLED: 'false',
    HERMES_ENABLED: 'false',
    GITHUB_ENABLED: 'false',
    INITIAL_ADMIN_EMAIL: '',
    INITIAL_ADMIN_PASSWORD: '',
    LOG_LEVEL: 'silent',
  });
  const originalFetch = globalThis.fetch;
  const meter = new EvaluationNetworkBudget(
    `${(process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/+$/, '')}/chat/completions`,
    `${(process.env.OPENAI_EMBEDDING_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '')}/embeddings`,
    'deepseek-v4-pro',
    originalFetch,
  );
  globalThis.fetch = meter.fetch;
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;
  let trace: ReturnType<NonNullable<AnswerEvaluationDependencies['trace']>>;
  try {
    const { AppModule } = await import('../src/app.module');
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
      abortOnError: false,
    });
    const context = app.get(ConversationContextService);
    const prepare = context.prepare.bind(context);
    context.prepare = async (...params: Parameters<ConversationContextService['prepare']>) => {
      trace = undefined;
      const prepared = await prepare(...params);
      trace = {
        messages: prepared.messages,
        excerpts: prepared.excerpts.length,
        compactions: prepared.compactions,
        estimated: prepared.estimated,
      };
      return prepared;
    };
    const report = await evaluateHistoryAnswers(
      app.get(DataSource),
      {
        ai: app.get(AiService),
        recall: app.get(HistoryRecallService),
        context,
        memory: app.get(CopilotMemoryService),
        config: app.get(ConfigService),
        trace: () => trace,
        progress: (name, passed) => console.log(JSON.stringify({ case: name, passed })),
      },
      names as AnswerCase[],
    );
    await mkdir('test-results', { recursive: true });
    const file = `test-results/history-answer-eval-${Date.now()}.json`;
    await writeFile(
      file,
      JSON.stringify(
        {
          ...report,
          kind: 'live_answer_evaluation',
          limitReached: meter.limitReached,
          usage: meter.usage,
          limits: meter.limits,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(
      JSON.stringify({ file, summary: report.summary, usage: meter.usage, limits: meter.limits }),
    );
    if (meter.limitReached || report.summary.passed !== report.summary.total) process.exitCode = 2;
  } finally {
    try {
      await app?.close();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
}
void main().catch(() => {
  console.error(
    'HISTORY_ANSWER_EVAL_FAILED: check test database, migrations, provider configuration and request limits.',
  );
  process.exitCode = 1;
});
