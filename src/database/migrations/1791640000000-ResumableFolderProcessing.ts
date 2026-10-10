import { MigrationInterface, QueryRunner } from 'typeorm';
export class ResumableFolderProcessing1791640000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE uploaded_folder_files ADD COLUMN resume_hash varchar(100), ADD COLUMN extraction_status varchar(20) NOT NULL DEFAULT 'PENDING', ADD COLUMN extraction_token uuid, ADD COLUMN extraction_lease_until timestamptz, ADD COLUMN extraction_attempts integer NOT NULL DEFAULT 0`,
    );
    await q.query(
      `UPDATE uploaded_folder_files SET extraction_status = CASE WHEN text_key IS NOT NULL THEN 'DONE' ELSE 'SKIPPED' END`,
    );
    await q.query(
      `CREATE INDEX idx_uploaded_extraction_queue ON uploaded_folder_files(extraction_status,extraction_lease_until)`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP INDEX idx_uploaded_extraction_queue');
    await q.query(
      'ALTER TABLE uploaded_folder_files DROP COLUMN resume_hash, DROP COLUMN extraction_status, DROP COLUMN extraction_token, DROP COLUMN extraction_lease_until, DROP COLUMN extraction_attempts',
    );
  }
}
