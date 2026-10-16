import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../../src/database/database-options';
import { evaluateHistoryAnswers } from '../fixtures/history-answer-evaluation';

describe('Answer evaluation fixture lifecycle', () => {
  let db: DataSource;
  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (process.env.NODE_ENV !== 'test' || !url || !new URL(url).pathname.endsWith('_test'))
      throw new Error('Dedicated test DB required');
    db = await new DataSource(databaseOptions(url)).initialize();
    await db.runMigrations({ transaction: 'all' });
  });
  afterAll(async () => {
    await db?.destroy();
  });
  it('cleans synthetic rows and restores the context budget when generation throws', async () => {
    const counts = async () =>
      db.query(`SELECT (SELECT count(*) FROM users) AS users,
      (SELECT count(*) FROM projects) AS projects,(SELECT count(*) FROM ai_conversations) AS conversations,
      (SELECT count(*) FROM ai_messages) AS messages`);
    const before = await counts();
    const config = new ConfigService({ AI_CONTEXT_INPUT_BUDGET: 128000 });
    const unused = async (): Promise<never> => {
      throw new Error('Not called');
    };
    const report = await evaluateHistoryAnswers(
      db,
      {
        config,
        ai: {
          postMessage: async () => {
            expect(config.get('AI_CONTEXT_INPUT_BUDGET')).toBe(16000);
            throw new Error('Synthetic provider failure');
          },
        },
        recall: { indexBatch: unused },
        context: { excludeMessage: unused },
        memory: { create: unused, update: unused },
      },
      ['compacted_fact'],
    );
    expect(report.summary).toMatchObject({ passed: 0, total: 1 });
    expect(report.cases[0]).toMatchObject({ error: 'CASE_EXECUTION_FAILED' });
    expect(JSON.stringify(report)).not.toContain('Synthetic provider failure');
    expect(config.get('AI_CONTEXT_INPUT_BUDGET')).toBe(128000);
    expect(await counts()).toEqual(before);
  });
});
