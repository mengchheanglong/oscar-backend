import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../../src/database/database-options';
import { RemoveMockEmbeddings1790985600000 } from '../../src/database/migrations/1790985600000-RemoveMockEmbeddings';
import { LocalQwenEmbeddings1793012400000 } from '../../src/database/migrations/1793012400000-LocalQwenEmbeddings';

describe('PostgreSQL foundation migrations', () => {
  let database: DataSource;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (process.env.NODE_ENV !== 'test' || !url || !new URL(url).pathname.endsWith('_test')) {
      throw new Error(
        'Integration tests require a dedicated _test database. Use pnpm test:integration.',
      );
    }
    database = await new DataSource(databaseOptions(url)).initialize();
  });

  afterAll(async () => {
    if (database?.isInitialized) await database.destroy();
  });

  it('applies migrations, supports pgvector, and has no pending migrations on replay', async () => {
    await database.runMigrations({ transaction: 'all' });
    const extensions: { extname: string }[] = await database.query(
      "SELECT extname FROM pg_extension WHERE extname = 'vector'",
    );
    expect(extensions).toEqual([{ extname: 'vector' }]);
    const rows: { distance: number }[] = await database.query(
      "SELECT '[1,2,3]'::vector <-> '[1,2,3]'::vector AS distance",
    );
    expect(rows[0]?.distance).toBe(0);
    expect(await database.showMigrations()).toBe(false);
    expect(await database.runMigrations()).toEqual([]);
  });

  it('removes only synthetic vectors while retaining source text and real embeddings', async () => {
    const runner = database.createQueryRunner();
    await runner.startTransaction();
    try {
      await runner.query(`CREATE TEMP TABLE knowledge_chunks (
        id integer, text text, embedding vector(1536) NOT NULL,
        embedding_model text, embedding_dimensions integer) ON COMMIT DROP`);
      const vector = `[${Array(1536).fill(0.1).join(',')}]`;
      await runner.query(
        `INSERT INTO knowledge_chunks VALUES
        (1, 'Real source text with synthetic vector', $1, 'mock-embedding-3-small', 1536),
        (2, 'Real source text with real vector', $1, 'text-embedding-3-small', 1536)`,
        [vector],
      );
      await new RemoveMockEmbeddings1790985600000().up(runner);
      const rows: {
        id: number;
        text: string;
        embedding: string | null;
        embedding_model: string;
      }[] = await runner.query('SELECT * FROM knowledge_chunks ORDER BY id');
      expect(rows[0]).toMatchObject({
        text: 'Real source text with synthetic vector',
        embedding: null,
        embedding_model: 'keyword-only',
      });
      expect(rows[1]).toMatchObject({
        text: 'Real source text with real vector',
        embedding_model: 'text-embedding-3-small',
      });
      expect(rows[1]?.embedding).not.toBeNull();
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });

  it('preserves legacy vectors while adding isolated 1024-dimensional storage and refuses destructive rollback', async () => {
    const q = database.createQueryRunner();
    await q.startTransaction();
    try {
      for (const table of ['knowledge_chunks', 'private_memory_vectors', 'ai_history_vectors']) {
        await q.query(
          `CREATE TEMP TABLE ${table}(id integer, embedding vector(1536)) ON COMMIT DROP`,
        );
        await q.query(`INSERT INTO ${table} VALUES(1,$1::vector)`, [
          JSON.stringify([1, ...Array<number>(1535).fill(0)]),
        ]);
      }
      const before = await q.query('SELECT embedding::text AS value FROM knowledge_chunks');
      const migration = new LocalQwenEmbeddings1793012400000();
      await migration.up(q);
      expect(await q.query('SELECT embedding::text AS value FROM knowledge_chunks')).toEqual(
        before,
      );
      for (const table of ['private_memory_vectors', 'ai_history_vectors']) {
        expect(await q.query(`SELECT embedding::text AS value FROM ${table}`)).toEqual(before);
        await q.query(`INSERT INTO ${table} VALUES(2,$1::vector)`, [
          JSON.stringify([1, ...Array<number>(1023).fill(0)]),
        ]);
        expect(
          (
            await q.query(`SELECT vector_dims(embedding) AS dimensions FROM ${table} ORDER BY id`)
          ).map((row: { dimensions: number }) => row.dimensions),
        ).toEqual([1536, 1024]);
      }
      await q.query(
        `UPDATE knowledge_chunks SET embedding_qwen=$1::vector,embedding_qwen_identity='synthetic-qwen'`,
        [JSON.stringify([1, ...Array<number>(1023).fill(0)])],
      );
      expect(await q.query('SELECT embedding::text AS value FROM knowledge_chunks')).toEqual(
        before,
      );
      await expect(migration.down()).rejects.toThrow('Preserve model-specific vectors');
    } finally {
      await q.rollbackTransaction();
      await q.release();
    }
  });
});
