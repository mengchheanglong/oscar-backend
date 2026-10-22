import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChiefOfStaffContinuity1792972800000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE agent_runs ADD COLUMN goal_id uuid REFERENCES goals(id) ON DELETE SET NULL;
      ALTER TABLE platform_handoffs ADD COLUMN goal_id uuid REFERENCES goals(id) ON DELETE SET NULL;
      CREATE INDEX idx_agent_runs_goal ON agent_runs(goal_id);
      CREATE INDEX idx_handoffs_goal ON platform_handoffs(goal_id);
      CREATE TABLE chief_preferences (
        user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        cadence varchar(10) NOT NULL DEFAULT 'OFF' CHECK (cadence IN ('OFF','DAILY','WEEKLY')),
        hour_utc integer NOT NULL DEFAULT 2 CHECK (hour_utc BETWEEN 0 AND 23),
        monthly_budget_usd numeric(12,4) CHECK (monthly_budget_usd >= 0),
        next_briefing_at timestamptz, last_briefing_at timestamptz
      );
      CREATE TABLE chief_briefings (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        scheduled_at timestamptz NOT NULL, generated_at timestamptz NOT NULL DEFAULT now(),
        snapshot jsonb NOT NULL, PRIMARY KEY(user_id, scheduled_at)
      );
      CREATE TABLE execution_reviews (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        platform varchar(15) NOT NULL CHECK(platform IN ('hermes','t3','paperclip')), run_id uuid NOT NULL,
        goal_id uuid REFERENCES goals(id) ON DELETE SET NULL,
        verdict varchar(20) NOT NULL CHECK(verdict IN ('ACCEPTED','NEEDS_WORK','REJECTED')),
        observation text NOT NULL, reported_cost_usd numeric(12,4) CHECK(reported_cost_usd >= 0),
        memory_id uuid REFERENCES mavis_memories(id) ON DELETE SET NULL,
        idempotency_key uuid NOT NULL, payload_hash varchar(64) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,platform,run_id), UNIQUE(user_id,idempotency_key)
      );
    `);
  }
  async down(): Promise<void> {
    throw new Error('Export briefing and outcome history before reverting this migration.');
  }
}
