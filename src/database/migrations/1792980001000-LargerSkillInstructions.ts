import { MigrationInterface, QueryRunner } from 'typeorm';
export class LargerSkillInstructions1792980001000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE skills DROP CONSTRAINT skills_instructions_check');
    await q.query(
      'ALTER TABLE skills ADD CONSTRAINT skills_instructions_check CHECK(length(instructions)<=12000)',
    );
  }
  async down(q: QueryRunner): Promise<void> {
    // PostgreSQL rejects this rollback if longer instructions exist; never truncate user skills.
    await q.query('ALTER TABLE skills DROP CONSTRAINT skills_instructions_check');
    await q.query(
      'ALTER TABLE skills ADD CONSTRAINT skills_instructions_check CHECK(length(instructions)<=4000)',
    );
  }
}
