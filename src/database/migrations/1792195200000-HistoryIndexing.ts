import { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryIndexing1792195200000 implements MigrationInterface {
  name = 'HistoryIndexing1792195200000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE ai_history_index_jobs (
      message_id uuid NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE,
      embedding_identity varchar(1200) NOT NULL,
      content_hash varchar(64) NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
      attempts integer NOT NULL CHECK(attempts BETWEEN 1 AND 3),
      lease_id uuid NOT NULL, next_attempt_at timestamptz NOT NULL,
      PRIMARY KEY(message_id,embedding_identity,content_hash))`);
    await q.query(`CREATE TABLE ai_history_index_usage (
      day date NOT NULL, scope_key text NOT NULL,
      calls integer NOT NULL DEFAULT 0 CHECK(calls>=0),
      texts integer NOT NULL DEFAULT 0 CHECK(texts>=0),
      input_bytes integer NOT NULL DEFAULT 0 CHECK(input_bytes>=0),
      PRIMARY KEY(day,scope_key))`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE ai_history_index_jobs');
    await q.query('DROP TABLE ai_history_index_usage');
  }
}
