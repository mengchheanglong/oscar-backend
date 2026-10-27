import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChatAttachments1793090000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE chat_attachments (
      id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id),
      user_id uuid NOT NULL REFERENCES users(id), conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
      filename varchar(500) NOT NULL, mime_type varchar(255) NOT NULL, storage_key text NOT NULL,
      size_bytes bigint NOT NULL, chunks jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz, promoted_document_id uuid REFERENCES documents(id)
    )`);
    await q.query(
      'CREATE INDEX idx_chat_attachments_scope ON chat_attachments(conversation_id,user_id)',
    );
    await q.query(
      'ALTER TABLE ai_conversations ADD COLUMN has_private_attachments boolean NOT NULL DEFAULT false',
    );
    await q.query(
      'ALTER TABLE copilot_memories ADD COLUMN source_attachment_id uuid REFERENCES chat_attachments(id) ON DELETE SET NULL',
    );
  }
  async down(): Promise<void> {
    throw new Error(
      'Preserve attachments and their provenance; roll back application configuration instead.',
    );
  }
}
