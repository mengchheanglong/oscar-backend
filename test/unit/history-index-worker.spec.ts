import { ConfigService } from '@nestjs/config';
import { HistoryIndexWorker } from '../../src/modules/assistant/context/history-index.worker';
import {
  HistoryIndexRepository,
  HistoryIndexBatch,
} from '../../src/modules/assistant/context/history-index.repository';
import { HistoryVectorRepository } from '../../src/modules/assistant/context/history-vector.repository';

describe('Automatic history indexing lifecycle', () => {
  const config = new ConfigService({ AI_ENABLED: true, AI_HISTORY_AUTO_INDEX_ENABLED: true });
  const batch: HistoryIndexBatch = {
    scope: { projectId: 'project', userId: 'owner' },
    identity: 'identity',
    lease: 'lease',
    rows: [
      {
        messageId: 'message',
        conversationId: 'conversation',
        role: 'user',
        content: 'Synthetic fact.',
      },
    ],
  };
  function setup(options = config) {
    const jobs = {
      claim: jest.fn().mockResolvedValue({ ...batch, rows: [...batch.rows] }),
      sources: jest.fn().mockResolvedValue(batch.rows),
      owns: jest.fn().mockResolvedValue(true),
      finish: jest.fn().mockResolvedValue(undefined),
    };
    const vectors = {
      assertAccess: jest.fn().mockResolvedValue(undefined),
      activate: jest.fn().mockResolvedValue(undefined),
    };
    const provider = {
      identity: 'synthetic',
      embed: jest.fn().mockResolvedValue([[1, ...Array<number>(1535).fill(0)]]),
    };
    const worker = new HistoryIndexWorker(
      options,
      jobs as unknown as HistoryIndexRepository,
      vectors as unknown as HistoryVectorRepository,
      provider,
    );
    return { jobs, vectors, provider, worker };
  }
  it('does no database or provider work while disabled', async () => {
    const s = setup(new ConfigService({ AI_ENABLED: true }));
    s.worker.onModuleInit();
    expect(await s.worker.tick()).toBe(0);
    expect(s.jobs.claim).not.toHaveBeenCalled();
    await s.worker.onModuleDestroy();
  });
  it('skips excluded sources and expired claims before sending text', async () => {
    for (const kind of ['excluded', 'lease']) {
      const s = setup();
      if (kind === 'excluded') s.jobs.sources.mockResolvedValue([]);
      else s.jobs.owns.mockResolvedValue(false);
      expect(await s.worker.tick()).toBe(0);
      expect(s.provider.embed).not.toHaveBeenCalled();
    }
  });
  it('suppresses overlapping ticks and drains active work on shutdown', async () => {
    const s = setup();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    s.provider.embed.mockImplementation(async () => {
      await wait;
      return [[1, ...Array<number>(1535).fill(0)]];
    });
    const active = s.worker.tick();
    expect(await s.worker.tick()).toBe(0);
    let stopped = false;
    const stop = s.worker.onModuleDestroy().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    expect(await active).toBe(1);
    await stop;
    expect(await s.worker.tick()).toBe(0);
    expect(s.vectors.activate).toHaveBeenCalledTimes(1);
  });
  it('records a safe retry for malformed output and does not activate vectors', async () => {
    const s = setup();
    s.provider.embed.mockResolvedValue([[1, 0]]);
    expect(await s.worker.tick()).toBe(0);
    expect(s.jobs.finish).toHaveBeenCalledWith(expect.anything(), true);
    expect(s.vectors.activate).not.toHaveBeenCalled();
  });
  it('rechecks access after delayed provider work', async () => {
    const s = setup();
    s.vectors.assertAccess
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('revoked'));
    expect(await s.worker.tick()).toBe(0);
    expect(s.vectors.activate).not.toHaveBeenCalled();
    expect(s.jobs.finish).toHaveBeenCalledWith(expect.anything(), true);
  });
});
