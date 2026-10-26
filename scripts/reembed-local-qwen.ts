import 'reflect-metadata';
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../src/database/database-options';
import { validateEnvironment } from '../src/config/environment';
import { localEmbeddingProvider } from '../src/modules/ingestion/embedding/configured-embedding-provider';
import { memoryEmbedder } from '../src/modules/assistant/memory/private-memory.provider';
import { PrivateMemoryRepository } from '../src/modules/assistant/memory/private-memory.repository';
import { PrivateMemoryService } from '../src/modules/assistant/memory/private-memory.service';
import { HistoryVectorRepository } from '../src/modules/assistant/context/history-vector.repository';
import { ConversationHistoryRepository } from '../src/modules/assistant/context/conversation-history.repository';
import { HistoryRecallService } from '../src/modules/assistant/context/history-recall.service';

/** Explicit operator command: existing sources only, no generation, imports, or deletions. */
async function run() {
  const userId = process.argv[process.argv.indexOf('--user-id') + 1];
  if (!userId || !process.argv.includes('--user-id') || !/^[a-f0-9-]{36}$/i.test(userId ?? ''))
    throw new Error('USER_ID_REQUIRED');
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.port !== '43104' ||
    url.pathname !== '/oscar'
  )
    throw new Error('LOCAL_OSCAR_REQUIRED');
  const db = await new DataSource(databaseOptions(url.toString())).initialize();
  try {
    if (await db.showMigrations()) throw new Error('RUN_MIGRATIONS_FIRST');
    // The pinned revision must be explicitly configured even before local cutover.
    const config = new ConfigService(
      validateEnvironment({
        ...process.env,
        AI_EMBEDDING_PROVIDER: 'ollama',
        AI_EMBEDDING_MODEL: 'qwen3-embedding:0.6b',
        AI_EMBEDDING_DIMENSIONS: 1024,
      }),
    );
    const embedding = localEmbeddingProvider(config);
    const provider = memoryEmbedder(config)!;
    const memories = new PrivateMemoryService(new PrivateMemoryRepository(db), provider);
    const history = new HistoryRecallService(
      new ConversationHistoryRepository(db),
      new HistoryVectorRepository(db),
      provider,
    );
    const projects: Array<{ id: string }> = await db.query(
      `SELECT pm.project_id AS id FROM project_members pm JOIN users u ON u.id=pm.user_id
      JOIN projects p ON p.id=pm.project_id WHERE pm.user_id=$1 AND pm.removed_at IS NULL AND u.is_active=true AND p.status='ACTIVE'`,
      [userId],
    );
    if (!projects.length) throw new Error('USER_HAS_NO_ACTIVE_PROJECTS');
    let chunks = 0,
      memoryCount = 0,
      historyCount = 0;
    for (const project of projects) {
      const scope = { projectId: project.id, userId };
      const eligible = `s.id=c.knowledge_source_id AND s.project_id=c.project_id AND s.project_id=$1 AND s.deleted_at IS NULL
        AND s.status='INDEXED' AND c.index_version=s.active_index_version AND s.source_type NOT IN ('REQUIREMENT','MEETING')
        AND (s.owner_id IS NULL OR s.owner_id=$2) AND EXISTS(SELECT 1 FROM project_members pm JOIN users u ON u.id=pm.user_id
          WHERE pm.project_id=s.project_id AND pm.user_id=$2 AND pm.removed_at IS NULL AND u.is_active=true)`;
      for (let batch = 0; batch < 10000; batch++) {
        const rows: Array<{ id: string; text: string }> = await db.query(
          `SELECT c.id,c.text FROM knowledge_chunks c,knowledge_sources s
          WHERE ${eligible} AND (c.embedding_qwen IS NULL OR c.embedding_qwen_identity IS DISTINCT FROM $3) ORDER BY c.id LIMIT 16`,
          [project.id, userId, embedding.identity],
        );
        if (!rows.length) break;
        const vectors = await embedding.embed(rows.map((row) => row.text));
        let activated = 0;
        for (let i = 0; i < rows.length; i++) {
          const updated: Array<{ id: string }> = await db.query(
            `WITH updated AS (UPDATE knowledge_chunks c SET embedding_qwen=$4::vector,embedding_qwen_identity=$3 FROM knowledge_sources s
            WHERE ${eligible} AND c.id=$5 AND c.text=$6 RETURNING c.id) SELECT id FROM updated`,
            [
              project.id,
              userId,
              embedding.identity,
              JSON.stringify(vectors[i]),
              rows[i]!.id,
              rows[i]!.text,
            ],
          );
          activated += updated.length;
        }
        chunks += activated;
        if (!activated) throw new Error('SOURCE_CHANGED_DURING_REEMBED');
        if (batch === 9999) throw new Error('REEMBED_LIMIT_REACHED_RETRY');
      }
      for (const [service, kind] of [
        [memories, 'memory'],
        [history, 'history'],
      ] as const) {
        for (let batch = 0; batch < 10000; batch++) {
          const result = await service.indexBatch(scope);
          if (kind === 'memory') memoryCount += result.attempted;
          else historyCount += result.attempted;
          if (!result.remaining) break;
          if (!result.attempted || batch === 9999) throw new Error('REEMBED_LIMIT_REACHED_RETRY');
        }
      }
      console.log(
        JSON.stringify({
          event: 'LOCAL_REEMBED_PROGRESS',
          chunks,
          memories: memoryCount,
          history: historyCount,
        }),
      );
    }
    console.log(
      JSON.stringify({
        event: 'LOCAL_REEMBED_COMPLETE',
        projects: projects.length,
        chunks,
        memories: memoryCount,
        history: historyCount,
      }),
    );
  } finally {
    await db.destroy();
  }
}
void run().catch((error: unknown) => {
  const candidate = error instanceof Error ? error.message : '';
  const category = /^[A-Z][A-Z0-9_]{2,100}$/.test(candidate)
    ? candidate
    : error instanceof Error
      ? error.name
      : 'UNKNOWN';
  console.error(JSON.stringify({ event: 'LOCAL_REEMBED_FAILED', category }));
  console.error(
    'Local Qwen re-embedding did not complete. Existing vectors are preserved; correct the local configuration or source failure and retry.',
  );
  process.exitCode = 1;
});
