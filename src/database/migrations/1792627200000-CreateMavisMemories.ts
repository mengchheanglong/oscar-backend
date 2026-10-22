import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMavisMemories1792627200000 implements MigrationInterface {
  name = 'CreateMavisMemories1792627200000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE mavis_memories (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        scope_type varchar(20) NOT NULL,
        type varchar(30) NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'PROPOSED',
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
        goal_id uuid REFERENCES goals(id) ON DELETE SET NULL,
        statement text NOT NULL,
        rationale text,
        source_platform varchar(50) NOT NULL DEFAULT 'continuum',
        source_type varchar(50) NOT NULL DEFAULT 'MANUAL',
        source_id varchar(255),
        source_metadata jsonb,
        valid_from timestamptz,
        valid_until timestamptz,
        reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at timestamptz,
        supersedes_id uuid REFERENCES mavis_memories(id) ON DELETE SET NULL,
        superseded_by_id uuid REFERENCES mavis_memories(id) ON DELETE SET NULL,
        idempotency_key uuid,
        version integer NOT NULL DEFAULT 1,
        search_document tsvector GENERATED ALWAYS AS (to_tsvector('english', statement)) STORED,
        deleted_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await q.query(`
      CREATE INDEX idx_mavis_memories_scope_personal ON mavis_memories (user_id, deleted_at, status);
      CREATE INDEX idx_mavis_memories_scope_project ON mavis_memories (project_id, deleted_at, status) WHERE project_id IS NOT NULL;
      CREATE INDEX idx_mavis_memories_scope_goal ON mavis_memories (goal_id, deleted_at, status) WHERE goal_id IS NOT NULL;
      CREATE INDEX idx_mavis_memories_status ON mavis_memories (status, deleted_at);
      CREATE INDEX idx_mavis_memories_search ON mavis_memories USING gin(search_document) WHERE deleted_at IS NULL;
      CREATE UNIQUE INDEX uq_mavis_memories_retry ON mavis_memories (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
    `);

    await q.query(`
      CREATE TABLE mavis_memory_vectors (
        memory_id uuid NOT NULL REFERENCES mavis_memories(id) ON DELETE CASCADE,
        embedding_identity varchar(64) NOT NULL,
        embedding text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (memory_id, embedding_identity)
      )
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS mavis_memory_vectors');
    await q.query('DROP TABLE IF EXISTS mavis_memories');
  }
}
