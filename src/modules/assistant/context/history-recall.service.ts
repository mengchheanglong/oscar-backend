import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MEMORY_EMBEDDER } from '../memory/private-memory.service';
import {
  MemoryEmbeddingProvider,
  PrivateMemoryScope,
  validateVectors,
} from '../memory/private-memory.contract';
import type { ConversationScope } from './conversation-context.service';
import { ConversationHistoryRepository, HistoryExcerpt } from './conversation-history.repository';
import { HistoryVectorRepository } from './history-vector.repository';
import {
  fuseHistory,
  historyEmbeddingIdentity,
  DEFAULT_HISTORY_MAX_DISTANCE,
  HISTORY_MAX_DISTANCE,
} from './history-retrieval.contract';

@Injectable()
export class HistoryRecallService {
  private readonly logger = new Logger(HistoryRecallService.name);
  constructor(
    private readonly history: ConversationHistoryRepository,
    private readonly vectors: HistoryVectorRepository,
    @Inject(MEMORY_EMBEDDER) private readonly provider: MemoryEmbeddingProvider | null,
    @Inject(HISTORY_MAX_DISTANCE) private readonly maxDistance = DEFAULT_HISTORY_MAX_DISTANCE,
  ) {}

  async select(
    s: ConversationScope,
    text: string,
    through: string,
    maxBytes = 6000,
  ): Promise<HistoryExcerpt[]> {
    await this.vectors.assertAccess(s);
    const query = text.trim().slice(0, 2000);
    if (!query) return [];
    const lexical = await this.history.lexical(s, query, through);
    let semantic: HistoryExcerpt[] = [],
      mode = 'keyword';
    if (this.provider) {
      const identity = historyEmbeddingIdentity(this.provider.identity);
      if (await this.vectors.hasVectors(s, identity, through)) {
        let vector: number[] | undefined;
        try {
          const result = await this.provider.embed([query]);
          validateVectors(result, 1);
          vector = result[0];
        } catch {
          mode = 'keyword_embedding_unavailable';
        }
        await this.vectors.assertAccess(s);
        if (vector) {
          semantic = await this.vectors.semantic(s, identity, through, vector, this.maxDistance);
          mode = 'hybrid';
        }
      }
    }
    await this.vectors.assertAccess(s);
    // Revalidate all candidates after external work before ranking and byte packing.
    const current = await this.vectors.current(s, through, [...lexical, ...semantic]);
    const isCurrent = (row: HistoryExcerpt) =>
      current.some(
        (r) =>
          r.messageId === row.messageId &&
          r.content === row.content &&
          r.role === row.role &&
          r.sequence === row.sequence &&
          r.conversationId === row.conversationId,
      );
    const selected = fuseHistory(lexical.filter(isCurrent), semantic.filter(isCurrent), maxBytes);
    this.logger.debug({
      event: 'HISTORY_RECALL',
      mode,
      selected: selected.map((r) => r.messageId),
    });
    return selected;
  }

  /** Operator batch; automatic indexing uses its own durable reservations and retry limits. */
  async indexBatch(s: PrivateMemoryScope): Promise<{ attempted: number; remaining: boolean }> {
    await this.vectors.assertAccess(s);
    if (!this.provider) throw new Error('HISTORY_EMBEDDING_UNAVAILABLE');
    const identity = historyEmbeddingIdentity(this.provider.identity);
    const rows = await this.vectors.pending(s, identity);
    if (!rows.length) return { attempted: 0, remaining: false };
    const vectors = await this.provider.embed(rows.map((r) => r.content));
    validateVectors(vectors, rows.length);
    await this.vectors.assertAccess(s);
    const generation = randomUUID();
    for (let i = 0; i < rows.length; i++)
      await this.vectors.activate(s, rows[i]!, identity, generation, vectors[i]!);
    await this.vectors.assertAccess(s);
    return {
      attempted: rows.length,
      remaining: (await this.vectors.pending(s, identity)).length > 0,
    };
  }
}
