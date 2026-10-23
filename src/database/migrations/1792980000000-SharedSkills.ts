import { MigrationInterface, QueryRunner } from 'typeorm';
export class SharedSkills1792980000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE skills(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,slug varchar(48) NOT NULL,name varchar(80) NOT NULL,description varchar(300) NOT NULL DEFAULT '',instructions text NOT NULL CHECK(length(instructions)<=4000),version integer NOT NULL DEFAULT 1,UNIQUE(user_id,slug))`,
    );
    await q.query(
      `CREATE TABLE conversation_skills(conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,skill_id uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,snapshot jsonb NOT NULL,PRIMARY KEY(conversation_id,skill_id))`,
    );
    for (const table of ['ai_messages', 'agent_runs', 'platform_handoffs'])
      await q.query(
        `ALTER TABLE ${table} ADD COLUMN skill_context jsonb NOT NULL DEFAULT '[]'::jsonb`,
      );
  }
  async down(q: QueryRunner): Promise<void> {
    for (const table of ['ai_messages', 'agent_runs', 'platform_handoffs'])
      await q.query(`ALTER TABLE ${table} DROP COLUMN skill_context`);
    await q.query('DROP TABLE conversation_skills');
    await q.query('DROP TABLE skills');
  }
}
