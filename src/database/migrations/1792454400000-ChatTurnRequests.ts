import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChatTurnRequests1792454400000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'ALTER TABLE ai_messages ADD COLUMN client_request_id uuid, ADD COLUMN request_fingerprint varchar(64)',
    );
    await q.query(
      'CREATE UNIQUE INDEX idx_ai_messages_request_role ON ai_messages (conversation_id, client_request_id, role)',
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP INDEX idx_ai_messages_request_role');
    await q.query(
      'ALTER TABLE ai_messages DROP COLUMN client_request_id, DROP COLUMN request_fingerprint',
    );
  }
}
