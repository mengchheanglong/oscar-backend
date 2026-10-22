import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePlatformIntegrations1792713600000 implements MigrationInterface {
  name = 'CreatePlatformIntegrations1792713600000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE platform_connections (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
        platform_type varchar(30) NOT NULL,
        name varchar(255) NOT NULL,
        base_url varchar(500) NOT NULL,
        auth_type varchar(30) NOT NULL DEFAULT 'bearer',
        auth_token text,
        status varchar(30) NOT NULL DEFAULT 'HEALTHY',
        capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
        version_info jsonb NOT NULL DEFAULT '{}'::jsonb,
        last_health_check_at timestamptz,
        health_error text,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await q.query(`
      CREATE INDEX idx_platform_connections_user ON platform_connections (user_id, status);
      CREATE INDEX idx_platform_connections_project ON platform_connections (project_id, status) WHERE project_id IS NOT NULL;
      CREATE INDEX idx_platform_connections_platform ON platform_connections (platform_type);
    `);

    await q.query(`
      CREATE TABLE external_links (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        connection_id uuid NOT NULL REFERENCES platform_connections(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
        goal_id uuid REFERENCES goals(id) ON DELETE SET NULL,
        platform_type varchar(30) NOT NULL,
        external_entity_type varchar(50) NOT NULL,
        external_id varchar(255) NOT NULL,
        external_title varchar(500) NOT NULL,
        external_url varchar(1000) NOT NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await q.query(`
      CREATE INDEX idx_external_links_connection ON external_links (connection_id);
      CREATE INDEX idx_external_links_user ON external_links (user_id);
      CREATE INDEX idx_external_links_project ON external_links (project_id) WHERE project_id IS NOT NULL;
      CREATE INDEX idx_external_links_goal ON external_links (goal_id) WHERE goal_id IS NOT NULL;
      CREATE INDEX idx_external_links_external ON external_links (platform_type, external_entity_type, external_id);
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS external_links');
    await q.query('DROP TABLE IF EXISTS platform_connections');
  }
}
