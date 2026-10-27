import { MigrationInterface, QueryRunner } from 'typeorm';

export class EvidenceSnapshots1793140000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE ai_messages ADD COLUMN evidence_snapshot jsonb');
  }

  async down(): Promise<void> {
    throw new Error(
      'Preserve historical evidence snapshots; roll back application configuration instead.',
    );
  }
}
