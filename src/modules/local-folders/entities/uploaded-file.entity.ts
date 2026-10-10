import { Column, Entity, PrimaryColumn, Index } from 'typeorm';
@Entity('uploaded_folder_files')
@Index('uq_uploaded_folder_path', ['folderId', 'pathKey'], { unique: true })
export class UploadedFile {
  @PrimaryColumn('uuid') id!: string;
  @Column({ name: 'folder_id', type: 'uuid' }) folderId!: string;
  @Column({ type: 'varchar', length: 450 }) path!: string;
  @Column({ name: 'path_key', type: 'varchar', length: 450 }) pathKey!: string;
  @Column({ name: 'storage_key', type: 'varchar', length: 200 }) storageKey!: string;
  @Column({ name: 'text_key', type: 'varchar', length: 200, nullable: true }) textKey!:
    string | null;
  @Column({ type: 'bigint', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  size!: number;
  @Column({ type: 'varchar', length: 64 }) hash!: string;
  @Column({ type: 'varchar', length: 200, nullable: true }) reason!: string | null;
}
