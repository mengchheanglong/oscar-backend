import 'reflect-metadata';
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { z } from 'zod';
import { databaseOptions } from '../src/database/database-options';
import { memoryEmbedder } from '../src/modules/assistant/memory/private-memory.provider';
import { ConversationHistoryRepository } from '../src/modules/assistant/context/conversation-history.repository';
import { HistoryVectorRepository } from '../src/modules/assistant/context/history-vector.repository';
import { HistoryRecallService } from '../src/modules/assistant/context/history-recall.service';

async function main(): Promise<void> {
  const [projectId, userId, confirmation] = process.argv.slice(2);
  const scope = z
    .object({ projectId: z.string().uuid(), userId: z.string().uuid() })
    .parse({ projectId, userId });
  if (confirmation !== '--confirm-provider-cost')
    throw new Error('Explicit provider-cost confirmation required');
  const provider = memoryEmbedder(
    new ConfigService({
      ...process.env,
      AI_EMBEDDING_DIMENSIONS: Number(process.env.AI_EMBEDDING_DIMENSIONS || 1536),
    }),
  );
  if (!provider || !process.env.DATABASE_URL)
    throw new Error('Separate embedding configuration and database required');
  const db = await new DataSource(databaseOptions(process.env.DATABASE_URL)).initialize();
  try {
    console.log(
      JSON.stringify(
        await new HistoryRecallService(
          new ConversationHistoryRepository(db),
          new HistoryVectorRepository(db),
          provider,
        ).indexBatch(scope),
      ),
    );
  } finally {
    await db.destroy();
  }
}
void main().catch(() => {
  console.error(
    'HISTORY_INDEX_FAILED: check scope, migration and separate embedding configuration.',
  );
  process.exitCode = 1;
});
