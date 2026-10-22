import 'reflect-metadata';
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../src/database/database-options';
import { memoryEmbedder } from '../src/modules/assistant/memory/private-memory.provider';
import { DEFAULT_HISTORY_MAX_DISTANCE } from '../src/modules/assistant/context/history-retrieval.contract';
import {
  evaluateHistoryRecall,
  syntheticHistoryEmbedder,
  heldOutHistoryCases,
  historyCases,
} from '../test/fixtures/history-recall-evaluation';

async function main(): Promise<void> {
  const mode = process.argv[2] ?? '--synthetic';
  if (!['--synthetic', '--live'].includes(mode)) throw new Error('Unknown evaluation mode');
  const live = mode === '--live';
  const heldout = process.argv.includes('--holdout');
  if (heldout && !live) throw new Error('Holdout requires the live embedding evaluation');
  if (live && process.argv[3] !== '--confirm-provider-cost')
    throw new Error('Explicit provider cost confirmation required');
  const provider = live
    ? memoryEmbedder(
        new ConfigService({
          ...process.env,
          AI_EMBEDDING_DIMENSIONS: Number(process.env.AI_EMBEDDING_DIMENSIONS || 1536),
        }),
      )
    : syntheticHistoryEmbedder();
  if (!provider) throw new Error('HISTORY_EVAL_REQUIRES_SEPARATE_EMBEDDING_CONFIGURATION');
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_test') || url === process.env.DATABASE_URL)
    throw new Error('Dedicated test database required');
  const db = await new DataSource(databaseOptions(url)).initialize();
  const originalFetch = globalThis.fetch;
  const reportedUsage = { responses: 0, promptTokens: 0, totalTokens: 0 };
  if (live)
    globalThis.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      if (
        response.ok &&
        String(input) === `${process.env.OPENAI_EMBEDDING_BASE_URL?.replace(/\/+$/, '')}/embeddings`
      ) {
        const body = (await response
          .clone()
          .json()
          .catch(() => null)) as {
          usage?: { prompt_tokens?: unknown; total_tokens?: unknown };
        } | null;
        const usage = body?.usage;
        if (
          typeof usage?.prompt_tokens === 'number' &&
          Number.isFinite(usage.prompt_tokens) &&
          typeof usage.total_tokens === 'number' &&
          Number.isFinite(usage.total_tokens)
        ) {
          reportedUsage.responses++;
          reportedUsage.promptTokens += usage.prompt_tokens;
          reportedUsage.totalTokens += usage.total_tokens;
        }
      }
      return response;
    };
  try {
    if (await db.showMigrations())
      throw new Error('Apply test database migrations explicitly before evaluation');
    const distance = Number(
      process.env.AI_HISTORY_MAX_COSINE_DISTANCE ?? DEFAULT_HISTORY_MAX_DISTANCE,
    );
    if (!Number.isFinite(distance) || distance < 0 || distance > 2)
      throw new Error('Invalid cosine distance');
    const report = await evaluateHistoryRecall(
      db,
      provider,
      live ? 'live_retrieval' : 'synthetic_pipeline',
      distance,
      heldout ? heldOutHistoryCases : historyCases,
    );
    await mkdir('test-results', { recursive: true });
    const file = `test-results/history-recall-eval-${Date.now()}.json`;
    await writeFile(
      file,
      JSON.stringify(
        {
          ...report,
          dataset: heldout ? 'heldout' : 'calibration',
          reportedUsage: live ? reportedUsage : null,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(
      JSON.stringify({
        file,
        kind: report.kind,
        dataset: heldout ? 'heldout' : 'calibration',
        maxDistance: report.maxDistance,
        summary: report.summary,
        usage: report.usage,
        reportedUsage: live ? reportedUsage : null,
        notes: report.notes,
      }),
    );
  } finally {
    globalThis.fetch = originalFetch;
    await db.destroy();
  }
}
void main().catch((error: unknown) => {
  const safeCode =
    error instanceof Error &&
    /^(EMBEDDING_HTTP_[0-9]+|EMBEDDING_MODEL_MISMATCH|EMBEDDING_RESPONSE_INVALID)$/.test(
      error.message,
    )
      ? error.message
      : 'CONFIGURATION_OR_EVALUATION_FAILURE';
  console.error(
    `HISTORY_EVAL_FAILED ${safeCode}: check dedicated test DB, migrations, mode and separate embedding configuration.`,
  );
  process.exitCode = 1;
});
