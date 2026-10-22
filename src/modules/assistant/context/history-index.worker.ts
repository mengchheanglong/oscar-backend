import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MEMORY_EMBEDDER } from '../memory/private-memory.service';
import { MemoryEmbeddingProvider, validateVectors } from '../memory/private-memory.contract';
import { historyEmbeddingIdentity } from './history-retrieval.contract';
import { HistoryVectorRepository } from './history-vector.repository';
import { HistoryIndexRepository } from './history-index.repository';

@Injectable()
export class HistoryIndexWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HistoryIndexWorker.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<number>;
  private stopped = false;
  constructor(
    private readonly config: ConfigService,
    private readonly jobs: HistoryIndexRepository,
    private readonly vectors: HistoryVectorRepository,
    @Inject(MEMORY_EMBEDDER) private readonly provider: MemoryEmbeddingProvider | null,
  ) {}
  onModuleInit(): void {
    if (!this.enabled()) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, 15000);
    this.timer.unref();
  }
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
  private enabled(): boolean {
    return (
      this.config.get<boolean>('AI_HISTORY_AUTO_INDEX_ENABLED', false) === true &&
      this.config.get<boolean>('AI_ENABLED', false) === true &&
      Boolean(this.provider)
    );
  }
  async tick(): Promise<number> {
    if (this.stopped || this.running || !this.enabled()) return 0;
    this.running = this.process().catch(() => {
      this.logger.warn({ event: 'HISTORY_INDEX_UNAVAILABLE' });
      return 0;
    });
    try {
      return await this.running;
    } finally {
      this.running = undefined;
    }
  }
  private async process(): Promise<number> {
    const batch = await this.jobs.claim(historyEmbeddingIdentity(this.provider!.identity), {
      globalTexts: this.config.get<number>('AI_HISTORY_INDEX_DAILY_TEXTS', 256),
      globalBytes: this.config.get<number>('AI_HISTORY_INDEX_DAILY_BYTES', 512000),
      scopeTexts: this.config.get<number>('AI_HISTORY_INDEX_SCOPE_DAILY_TEXTS', 64),
      scopeBytes: this.config.get<number>('AI_HISTORY_INDEX_SCOPE_DAILY_BYTES', 128000),
    });
    if (!batch) return 0;
    try {
      await this.vectors.assertAccess(batch.scope);
      batch.rows = await this.jobs.sources(batch);
      if (!batch.rows.length || !(await this.jobs.owns(batch))) {
        await this.jobs.finish(batch, false);
        return 0;
      }
      const result = await this.provider!.embed(batch.rows.map((r) => r.content));
      validateVectors(result, batch.rows.length);
      await this.vectors.assertAccess(batch.scope);
      if (!(await this.jobs.owns(batch))) return 0;
      for (let i = 0; i < batch.rows.length; i++)
        await this.vectors.activate(
          batch.scope,
          batch.rows[i]!,
          batch.identity,
          batch.lease,
          result[i]!,
        );
      await this.jobs.finish(batch, false);
      this.logger.debug({ event: 'HISTORY_INDEX_BATCH', attempted: batch.rows.length });
      return batch.rows.length;
    } catch {
      await this.jobs.finish(batch, true);
      this.logger.warn({ event: 'HISTORY_INDEX_RETRY' });
      return 0;
    }
  }
}
