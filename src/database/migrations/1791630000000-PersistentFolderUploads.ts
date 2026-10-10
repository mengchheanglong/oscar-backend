import { MigrationInterface, QueryRunner } from 'typeorm';
export class PersistentFolderUploads1791630000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE local_folders ADD COLUMN storage_mode varchar(20) NOT NULL DEFAULT 'SNAPSHOT', ADD COLUMN status varchar(20) NOT NULL DEFAULT 'READY', ADD COLUMN expected_files integer`,
    );
    await q.query(`CREATE TABLE uploaded_folder_files (
      id uuid PRIMARY KEY, folder_id uuid NOT NULL REFERENCES local_folders(id) ON DELETE CASCADE,
      path varchar(450) NOT NULL, path_key varchar(450) NOT NULL, storage_key varchar(200) NOT NULL,
      text_key varchar(200), size bigint NOT NULL CHECK(size >= 0), hash varchar(64) NOT NULL,
      reason varchar(200), CONSTRAINT uq_uploaded_folder_path UNIQUE(folder_id,path_key)
    )`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM local_folders WHERE storage_mode = 'UPLOAD'`);
    await q.query('DROP TABLE uploaded_folder_files');
    await q.query(
      'ALTER TABLE local_folders DROP COLUMN storage_mode, DROP COLUMN status, DROP COLUMN expected_files',
    );
  }
}
