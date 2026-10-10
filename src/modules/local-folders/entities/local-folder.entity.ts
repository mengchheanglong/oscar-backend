import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('local_folders')
export class LocalFolder {
  @PrimaryColumn('uuid') id!: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId!: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @Column({ type: 'varchar', length: 200 }) name!: string;
  @Column({ type: 'integer', default: 0 }) version!: number;
  @Column({ name: 'storage_mode', type: 'varchar', length: 20, default: 'SNAPSHOT' })
  storageMode!: string;
  @Column({ type: 'varchar', length: 20, default: 'READY' }) status!: string;
  @Column({ name: 'expected_files', type: 'integer', nullable: true }) expectedFiles!:
    number | null;
  @Column({ name: 'synced_at', type: 'timestamptz', nullable: true }) syncedAt!: Date | null;
}
