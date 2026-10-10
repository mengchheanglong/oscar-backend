import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLocalFolders1791590400000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE local_folders (
      id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name varchar(200) NOT NULL, version integer NOT NULL DEFAULT 0,
      synced_at timestamptz
    )`);
    await q.query('CREATE INDEX idx_local_folders_owner ON local_folders(project_id, user_id)');
    await q.query(`ALTER TABLE knowledge_sources
      ADD COLUMN owner_id uuid REFERENCES users(id) ON DELETE CASCADE,
      ADD COLUMN local_folder_id uuid REFERENCES local_folders(id) ON DELETE CASCADE`);
    await q.query(`ALTER TABLE knowledge_sources ADD CONSTRAINT ck_local_source_owner
      CHECK (source_type <> 'LOCAL_FILE' OR (owner_id IS NOT NULL AND local_folder_id IS NOT NULL))`);
    await q.query(
      'CREATE UNIQUE INDEX uq_local_folder_path ON knowledge_sources(local_folder_id, title) WHERE local_folder_id IS NOT NULL',
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DELETE FROM knowledge_sources WHERE local_folder_id IS NOT NULL');
    await q.query(
      'ALTER TABLE knowledge_sources DROP CONSTRAINT ck_local_source_owner, DROP COLUMN local_folder_id, DROP COLUMN owner_id',
    );
    await q.query('DROP TABLE local_folders');
  }
}
