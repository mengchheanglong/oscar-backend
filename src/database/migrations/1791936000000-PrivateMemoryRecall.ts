import { MigrationInterface, QueryRunner } from 'typeorm';

export class PrivateMemoryRecall1791936000000 implements MigrationInterface {
  name = 'PrivateMemoryRecall1791936000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name='vector') THEN
        RAISE EXCEPTION 'pgvector is required for private memory recall; install the extension before migrating';
      END IF;
    END $$`);
    await q.query('CREATE EXTENSION IF NOT EXISTS vector');
    await q.query(
      `ALTER TABLE copilot_memories ADD CONSTRAINT uq_memory_scope UNIQUE (id, project_id, user_id)`,
    );
    await q.query(`ALTER TABLE copilot_memories ADD COLUMN search_document tsvector
      GENERATED ALWAYS AS (to_tsvector('english', content)) STORED`);
    await q.query(
      `CREATE INDEX idx_memory_search ON copilot_memories USING gin(search_document) WHERE deleted_at IS NULL`,
    );
    await q.query(`CREATE TABLE private_memory_vectors (
      memory_id uuid NOT NULL, project_id uuid NOT NULL, user_id uuid NOT NULL,
      source_version integer NOT NULL CHECK(source_version > 0),
      content_hash varchar(64) NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
      embedding_identity varchar(64) NOT NULL CHECK(embedding_identity ~ '^[0-9a-f]{64}$'),
      generation_id uuid NOT NULL,
      embedding vector(1536) NOT NULL CHECK(vector_norm(embedding) > 0),
      PRIMARY KEY(memory_id, embedding_identity),
      FOREIGN KEY(memory_id, project_id, user_id) REFERENCES copilot_memories(id, project_id, user_id) ON DELETE CASCADE
    )`);
    await q.query(
      `CREATE INDEX idx_private_memory_vectors_scope ON private_memory_vectors(project_id,user_id,embedding_identity)`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE private_memory_vectors');
    await q.query('ALTER TABLE copilot_memories DROP COLUMN search_document');
    await q.query('ALTER TABLE copilot_memories DROP CONSTRAINT uq_memory_scope');
  }
}
