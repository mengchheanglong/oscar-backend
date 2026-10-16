import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrivateMemoryRepository } from './private-memory.repository';
import {
  MemoryEmbeddingProvider,
  PrivateMemoryResult,
  PrivateMemoryScope,
  validateVectors,
} from './private-memory.contract';

export const MEMORY_EMBEDDER = 'MEMORY_EMBEDDER';

@Injectable()
export class PrivateMemoryService {
  private readonly logger = new Logger(PrivateMemoryService.name);
  constructor(
    private readonly repository: PrivateMemoryRepository,
    @Inject(MEMORY_EMBEDDER) private readonly provider: MemoryEmbeddingProvider | null,
  ) {}

  async select(projectId: string, userId: string, text: string): Promise<PrivateMemoryResult[]> {
    const scope = { projectId, userId };
    await this.repository.assertAccess(scope);
    const query = text.trim().slice(0, 2000);
    if (!query) return [];
    const lexical = await this.repository.lexical(scope, query);
    let semantic: PrivateMemoryResult[] = [];
    let mode = 'keyword';
    if (this.provider && (await this.repository.hasVectors(scope, this.provider.identity))) {
      let vector: number[] | undefined;
      try {
        const vectors = await this.provider.embed([query]);
        validateVectors(vectors, 1);
        vector = vectors[0];
      } catch {
        mode = 'keyword_embedding_unavailable';
      }
      await this.repository.assertAccess(scope);
      if (vector) {
        semantic = await this.repository.semantic(scope, this.provider.identity, vector);
        mode = 'hybrid';
      }
    }
    const ranked = new Map<string, { row: PrivateMemoryResult; score: number }>();
    for (const list of [lexical, semantic])
      list.forEach((row, i) => {
        const old = ranked.get(row.id);
        ranked.set(row.id, { row, score: (old?.score ?? 0) + 1 / (61 + i) });
      });
    await this.repository.assertAccess(scope);
    const memories = await this.repository.current(
      scope,
      [...ranked.values()]
        .sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id))
        .map((r) => r.row),
    );
    const selected: PrivateMemoryResult[] = [];
    for (const row of memories) {
      if (selected.length === 8) break;
      if (JSON.stringify([...selected, row]).length <= 4000) selected.push(row);
    }
    this.logger.debug({
      event: 'PRIVATE_MEMORY_RECALL',
      mode,
      selected: selected.map(({ id, version }) => ({ id, version })),
    });
    return selected;
  }

  /** Explicit bounded batch; never called from startup, CRUD or chat. */
  async indexBatch(scope: PrivateMemoryScope): Promise<{ attempted: number; remaining: boolean }> {
    await this.repository.assertAccess(scope);
    if (!this.provider) throw new Error('MEMORY_EMBEDDING_UNAVAILABLE');
    const rows = await this.repository.pending(scope, this.provider.identity);
    if (!rows.length) return { attempted: 0, remaining: false };
    const vectors = await this.provider.embed(rows.map((r) => r.content));
    validateVectors(vectors, rows.length);
    await this.repository.assertAccess(scope);
    const generation = randomUUID();
    for (let i = 0; i < rows.length; i++)
      await this.repository.activate(
        scope,
        rows[i]!,
        this.provider.identity,
        generation,
        vectors[i]!,
      );
    return {
      attempted: rows.length,
      remaining: (await this.repository.pending(scope, this.provider.identity)).length > 0,
    };
  }
}
