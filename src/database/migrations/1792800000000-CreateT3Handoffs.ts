import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateT3Handoffs1792800000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE t3_handoffs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
      connection_id uuid REFERENCES platform_connections(id) ON DELETE SET NULL,
      connection_origin varchar(500) NOT NULL,
      idempotency_key uuid NOT NULL,
      remote_project_id varchar(255) NOT NULL, prompt text NOT NULL,
      status varchar(20) NOT NULL, model_selection jsonb,
      thread_id varchar(255), run_id varchar(255), remote_status varchar(100),
      result text, notice text,
      assistant_message_id uuid REFERENCES ai_messages(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, idempotency_key)
    )`);
    await q.query(
      'CREATE INDEX idx_t3_handoffs_conversation ON t3_handoffs(conversation_id, created_at)',
    );
    await q.query(
      "CREATE INDEX idx_t3_handoffs_active ON t3_handoffs(updated_at) WHERE status IN ('QUEUED','DISPATCHING','RUNNING','WAITING')",
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE t3_handoffs');
  }
}
