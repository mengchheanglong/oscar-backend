import { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryRecall1792108800000 implements MigrationInterface {
  name = 'HistoryRecall1792108800000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE ai_messages ADD COLUMN context_excluded boolean NOT NULL DEFAULT false,
      ADD COLUMN history_search tsvector GENERATED ALWAYS AS
      (to_tsvector('english',left(content,100000))) STORED`);
    await q.query(`CREATE INDEX idx_message_history_search ON ai_messages USING gin(history_search)
      WHERE context_excluded=false AND status='COMPLETED'`);
    await q.query(`CREATE TABLE ai_history_scope (
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      revision bigint NOT NULL DEFAULT 0, PRIMARY KEY(project_id,user_id))`);
    await q.query(`CREATE TABLE ai_history_dependencies (
      project_id uuid NOT NULL, user_id uuid NOT NULL,
      conversation_id uuid NOT NULL, source_conversation_id uuid NOT NULL,
      PRIMARY KEY(conversation_id,source_conversation_id),
      CHECK(conversation_id<>source_conversation_id),
      FOREIGN KEY(conversation_id,project_id,user_id)
        REFERENCES ai_conversations(id,project_id,user_id) ON DELETE CASCADE,
      FOREIGN KEY(source_conversation_id,project_id,user_id)
        REFERENCES ai_conversations(id,project_id,user_id) ON DELETE CASCADE)`);
    await q.query(`CREATE INDEX idx_history_dependency_source
      ON ai_history_dependencies(project_id,user_id,source_conversation_id)`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE ai_history_dependencies');
    await q.query('DROP TABLE ai_history_scope');
    await q.query(
      'ALTER TABLE ai_messages DROP COLUMN history_search, DROP COLUMN context_excluded',
    );
  }
}
