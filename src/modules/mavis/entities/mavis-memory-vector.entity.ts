import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { MavisMemory } from './mavis-memory.entity';

@Entity('mavis_memory_vectors')
export class MavisMemoryVector {
  @PrimaryColumn({ name: 'memory_id', type: 'uuid' })
  memoryId!: string;

  @ManyToOne(() => MavisMemory, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'memory_id' })
  memory?: MavisMemory;

  @PrimaryColumn({ name: 'embedding_identity', type: 'varchar', length: 64 })
  embeddingIdentity!: string;

  @Column({ type: 'text' })
  embedding!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
