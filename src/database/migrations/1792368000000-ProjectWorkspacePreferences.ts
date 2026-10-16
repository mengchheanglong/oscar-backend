import { MigrationInterface, QueryRunner } from 'typeorm';
export class ProjectWorkspacePreferences1792368000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE projects ADD COLUMN icon varchar(32), ADD COLUMN instructions text');
    await q.query(
      'ALTER TABLE ai_conversations ADD COLUMN is_pinned boolean NOT NULL DEFAULT false',
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE ai_conversations DROP COLUMN is_pinned');
    await q.query('ALTER TABLE projects DROP COLUMN icon, DROP COLUMN instructions');
  }
}
