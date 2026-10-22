import 'reflect-metadata';
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { z } from 'zod';
import { databaseOptions } from '../src/database/database-options';
import { memoryEmbedder } from '../src/modules/assistant/memory/private-memory.provider';
import { PrivateMemoryRepository } from '../src/modules/assistant/memory/private-memory.repository';
import { PrivateMemoryService } from '../src/modules/assistant/memory/private-memory.service';

async function main(): Promise<void> {
  const [projectId, userId, confirmation] = process.argv.slice(2);
  const scope = z
    .object({ projectId: z.string().uuid(), userId: z.string().uuid() })
    .parse({ projectId, userId });
  if (confirmation !== '--confirm-provider-cost')
    throw new Error('Explicit provider-cost confirmation required');
  if (!process.env.DATABASE_URL) throw new Error('Database configuration required');
  const provider = memoryEmbedder(
    new ConfigService({
      ...process.env,
      AI_EMBEDDING_DIMENSIONS: Number(process.env.AI_EMBEDDING_DIMENSIONS || 1536),
    }),
  );
  if (!provider) throw new Error('Embedding provider configuration required');
  const db = await new DataSource(databaseOptions(process.env.DATABASE_URL)).initialize();
  try {
    const result = await new PrivateMemoryService(
      new PrivateMemoryRepository(db),
      provider,
    ).indexBatch(scope);
    console.log(JSON.stringify(result));
  } finally {
    await db.destroy();
  }
}
void main().catch(() => {
  console.error('PRIVATE_MEMORY_INDEX_FAILED: check scope, migration and embedding configuration.');
  process.exitCode = 1;
});
