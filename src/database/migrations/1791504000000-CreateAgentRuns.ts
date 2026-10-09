import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgentRuns1791504000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE agent_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      prompt text NOT NULL CHECK (char_length(btrim(prompt)) BETWEEN 1 AND 4000),
      status varchar(20) NOT NULL CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
      model varchar(100) NOT NULL, runtime_revision varchar(40) NOT NULL,
      idempotency_key uuid NOT NULL, payload_hash varchar(64) NOT NULL,
      events jsonb NOT NULL DEFAULT '[]', evidence jsonb NOT NULL DEFAULT '[]',
      artifact text CHECK (char_length(artifact) <= 24000),
      proposal_id uuid REFERENCES ai_proposals(id) ON DELETE SET NULL,
      error_code varchar(50), deadline_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_agent_runs_retry UNIQUE (project_id, user_id, idempotency_key)
    )`);
    await q.query(
      'CREATE INDEX idx_agent_runs_scope ON agent_runs(project_id, user_id, created_at DESC)',
    );
    await q.query(
      "CREATE UNIQUE INDEX uq_agent_runs_active ON agent_runs(project_id, user_id) WHERE status IN ('QUEUED','RUNNING')",
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE agent_runs');
  }
}
