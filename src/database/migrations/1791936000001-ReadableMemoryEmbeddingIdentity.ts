import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReadableMemoryEmbeddingIdentity1791936000001 implements MigrationInterface {
  name = 'ReadableMemoryEmbeddingIdentity1791936000001';
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'ALTER TABLE private_memory_vectors DROP CONSTRAINT private_memory_vectors_embedding_identity_check',
    );
    await q.query('ALTER TABLE private_memory_vectors ALTER COLUMN embedding_identity TYPE text');
    await q.query(`ALTER TABLE private_memory_vectors ADD CONSTRAINT private_memory_vectors_embedding_identity_check
      CHECK(length(embedding_identity) BETWEEN 1 AND 1000)`);
  }
  async down(): Promise<void> {
    throw new Error(
      'Readable model identities cannot be truncated safely; retain this additive migration.',
    );
  }
}
