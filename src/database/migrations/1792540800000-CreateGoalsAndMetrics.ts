import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGoalsAndMetrics1792540800000 implements MigrationInterface {
  name = 'CreateGoalsAndMetrics1792540800000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE goals (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
        title varchar(500) NOT NULL,
        description text,
        motivation text,
        status varchar(20) NOT NULL DEFAULT 'ACTIVE',
        timeframe varchar(100),
        start_date date,
        target_date date,
        baseline text,
        target text,
        progress integer NOT NULL DEFAULT 0,
        confidence varchar(20),
        category varchar(50) NOT NULL DEFAULT 'BUSINESS',
        dependencies text,
        risks text,
        review_cadence varchar(50) NOT NULL DEFAULT 'WEEKLY',
        initiatives jsonb NOT NULL DEFAULT '[]'::jsonb,
        milestones jsonb NOT NULL DEFAULT '[]'::jsonb,
        version integer NOT NULL DEFAULT 1,
        deleted_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await q.query(`
      CREATE INDEX idx_goals_user_status ON goals (user_id, deleted_at, status);
      CREATE INDEX idx_goals_project_status ON goals (project_id, deleted_at, status);
    `);

    await q.query(`
      CREATE TABLE goal_metrics (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        goal_id uuid NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        name varchar(255) NOT NULL,
        unit varchar(50) NOT NULL,
        baseline_value numeric NOT NULL DEFAULT 0,
        current_value numeric NOT NULL DEFAULT 0,
        target_value numeric NOT NULL,
        observation_date date,
        notes text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await q.query(`
      CREATE INDEX idx_goal_metrics_goal ON goal_metrics (goal_id);
    `);

    await q.query(`
      CREATE TABLE goal_revisions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        goal_id uuid NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        version integer NOT NULL,
        title varchar(500) NOT NULL,
        status varchar(20) NOT NULL,
        progress integer NOT NULL,
        target text,
        changed_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reason text,
        snapshot jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await q.query(`
      CREATE INDEX idx_goal_revisions_goal ON goal_revisions (goal_id, version);
    `);

    await q.query(`
      ALTER TABLE tasks ADD COLUMN goal_id uuid REFERENCES goals(id) ON DELETE SET NULL;
      CREATE INDEX idx_tasks_goal ON tasks (goal_id) WHERE goal_id IS NOT NULL;
    `);

    await q.query(`
      ALTER TABLE decisions ADD COLUMN goal_id uuid REFERENCES goals(id) ON DELETE SET NULL;
      CREATE INDEX idx_decisions_goal ON decisions (goal_id) WHERE goal_id IS NOT NULL;
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP INDEX IF EXISTS idx_decisions_goal');
    await q.query('ALTER TABLE decisions DROP COLUMN IF EXISTS goal_id');

    await q.query('DROP INDEX IF EXISTS idx_tasks_goal');
    await q.query('ALTER TABLE tasks DROP COLUMN IF EXISTS goal_id');

    await q.query('DROP TABLE IF EXISTS goal_revisions');
    await q.query('DROP TABLE IF EXISTS goal_metrics');
    await q.query('DROP TABLE IF EXISTS goals');
  }
}
