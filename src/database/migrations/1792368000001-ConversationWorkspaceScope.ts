import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConversationWorkspaceScope1792368000001 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'ALTER TABLE ai_conversations ADD COLUMN include_all_workspaces boolean NOT NULL DEFAULT false',
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE ai_conversations DROP COLUMN include_all_workspaces');
  }
}
