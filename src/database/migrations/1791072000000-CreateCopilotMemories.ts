import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCopilotMemories1791072000000 implements MigrationInterface {
  name = 'CreateCopilotMemories1791072000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE copilot_memories (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind varchar(20) NOT NULL CHECK (kind IN ('CONTEXT', 'PREFERENCE', 'LESSON')),
      content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 2000),
      source_message_id uuid REFERENCES ai_messages(id) ON DELETE SET NULL,
      idempotency_key uuid NOT NULL,
      payload_hash varchar(64) NOT NULL,
      version integer NOT NULL DEFAULT 1,
      deleted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_copilot_memories_retry UNIQUE (project_id, user_id, idempotency_key)
    )`);
    await queryRunner.query(`CREATE INDEX idx_copilot_memories_scope
      ON copilot_memories (project_id, user_id, deleted_at, updated_at DESC, id DESC)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE copilot_memories');
  }
}
