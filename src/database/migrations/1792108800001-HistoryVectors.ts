import { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryVectors1792108800001 implements MigrationInterface {
  name = 'HistoryVectors1792108800001';
  async up(q: QueryRunner): Promise<void> {
    try {
      await q.query('CREATE EXTENSION IF NOT EXISTS vector');
    } catch {
      throw new Error('HISTORY_RECALL_REQUIRES_POSTGRESQL_PGVECTOR');
    }
    await q.query(
      'ALTER TABLE ai_messages ADD CONSTRAINT uq_history_message_scope UNIQUE(id,conversation_id)',
    );
    await q.query(`CREATE TABLE ai_history_vectors (
      message_id uuid NOT NULL, conversation_id uuid NOT NULL,
      project_id uuid NOT NULL, user_id uuid NOT NULL,
      embedding_identity varchar(1200) NOT NULL,
      source_excerpt text NOT NULL CHECK(length(source_excerpt)<=900),
      content_hash varchar(64) NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
      generation_id uuid NOT NULL, embedding vector(1536) NOT NULL,
      PRIMARY KEY(message_id,embedding_identity),
      FOREIGN KEY(message_id,conversation_id) REFERENCES ai_messages(id,conversation_id) ON DELETE CASCADE,
      FOREIGN KEY(conversation_id,project_id,user_id) REFERENCES ai_conversations(id,project_id,user_id) ON DELETE CASCADE)`);
    await q.query(
      'CREATE INDEX idx_history_vectors_scope ON ai_history_vectors(project_id,user_id,embedding_identity)',
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE ai_history_vectors');
    await q.query('ALTER TABLE ai_messages DROP CONSTRAINT uq_history_message_scope');
  }
}
