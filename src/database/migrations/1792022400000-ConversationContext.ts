import { MigrationInterface, QueryRunner } from 'typeorm';
export class ConversationContext1792022400000 implements MigrationInterface {
  name = 'ConversationContext1792022400000';
  async up(q: QueryRunner): Promise<void> {
    await q.query('CREATE SEQUENCE ai_message_context_seq');
    await q.query('ALTER TABLE ai_messages ADD COLUMN context_seq bigint');
    await q.query(`WITH ordered AS (SELECT id,row_number() OVER(ORDER BY created_at,id) AS seq FROM ai_messages)
      UPDATE ai_messages m SET context_seq=o.seq FROM ordered o WHERE o.id=m.id`);
    await q.query(
      `SELECT setval('ai_message_context_seq',COALESCE((SELECT max(context_seq) FROM ai_messages),0)+1,false)`,
    );
    await q.query(
      `ALTER TABLE ai_messages ALTER COLUMN context_seq SET DEFAULT nextval('ai_message_context_seq'), ALTER COLUMN context_seq SET NOT NULL`,
    );
    await q.query('ALTER SEQUENCE ai_message_context_seq OWNED BY ai_messages.context_seq');
    await q.query('CREATE UNIQUE INDEX uq_message_context_seq ON ai_messages(context_seq)');
    await q.query('CREATE INDEX idx_message_context ON ai_messages(conversation_id,context_seq)');
    await q.query(
      'ALTER TABLE ai_conversations ADD CONSTRAINT uq_conversation_context_scope UNIQUE(id,project_id,user_id)',
    );
    await q.query(`CREATE TABLE ai_conversation_context (
      conversation_id uuid PRIMARY KEY, project_id uuid NOT NULL,user_id uuid NOT NULL,
      summary text NOT NULL DEFAULT '' CHECK(length(summary)<=6000),
      through_seq bigint NOT NULL DEFAULT 0 CHECK(through_seq>=0),
      revision integer NOT NULL DEFAULT 0, model varchar(100) NOT NULL,
      summary_prompt_tokens bigint NOT NULL DEFAULT 0, summary_completion_tokens bigint NOT NULL DEFAULT 0,
      FOREIGN KEY(conversation_id,project_id,user_id) REFERENCES ai_conversations(id,project_id,user_id) ON DELETE CASCADE
    )`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE ai_conversation_context');
    await q.query('ALTER TABLE ai_conversations DROP CONSTRAINT uq_conversation_context_scope');
    await q.query('ALTER TABLE ai_messages DROP COLUMN context_seq');
  }
}
