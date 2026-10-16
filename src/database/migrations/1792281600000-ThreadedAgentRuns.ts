import { MigrationInterface, QueryRunner } from 'typeorm';
export class ThreadedAgentRuns1792281600000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE agent_runs ADD COLUMN conversation_id uuid,
      ADD COLUMN user_message_id uuid REFERENCES ai_messages(id) ON DELETE SET NULL,
      ADD COLUMN assistant_message_id uuid REFERENCES ai_messages(id) ON DELETE SET NULL,
      ADD COLUMN history_revision bigint, ADD COLUMN thread_context jsonb,
      ADD CONSTRAINT fk_agent_run_conversation FOREIGN KEY(conversation_id,project_id,user_id)
      REFERENCES ai_conversations(id,project_id,user_id) ON DELETE CASCADE`);
    await q.query(
      'CREATE INDEX idx_agent_run_conversation ON agent_runs(conversation_id,created_at)',
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE agent_runs DROP COLUMN conversation_id, DROP COLUMN user_message_id,
      DROP COLUMN assistant_message_id, DROP COLUMN history_revision, DROP COLUMN thread_context`);
  }
}
