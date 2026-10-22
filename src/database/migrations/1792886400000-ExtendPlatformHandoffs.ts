import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExtendPlatformHandoffs1792886400000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE t3_handoffs RENAME TO platform_handoffs;
      ALTER TABLE platform_handoffs ADD COLUMN platform_type varchar(30) NOT NULL DEFAULT 't3';
      ALTER TABLE platform_handoffs ADD COLUMN remote_agent_id varchar(255);
      ALTER TABLE platform_handoffs ADD COLUMN remote_company_id varchar(255);
      ALTER TABLE platform_handoffs ADD COLUMN external_url varchar(1000);
      ALTER TABLE platform_handoffs ALTER COLUMN remote_project_id DROP NOT NULL;`);
  }
  async down(q: QueryRunner): Promise<void> {
    // Never discard Paperclip's durable work history during a rollback.
    const rows: Array<{ count: string }> = await q.query(
      "SELECT count(*)::text AS count FROM platform_handoffs WHERE platform_type <> 't3'",
    );
    if (Number(rows[0]?.count))
      throw new Error('Export Paperclip handoffs before reverting to the T3-only schema.');
    await q.query(`ALTER TABLE platform_handoffs DROP COLUMN external_url, DROP COLUMN remote_agent_id, DROP COLUMN remote_company_id, DROP COLUMN platform_type;
      ALTER TABLE platform_handoffs ALTER COLUMN remote_project_id SET NOT NULL;
      ALTER TABLE platform_handoffs RENAME TO t3_handoffs;`);
  }
}
