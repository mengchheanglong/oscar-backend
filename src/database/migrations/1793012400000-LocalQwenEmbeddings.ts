import { MigrationInterface, QueryRunner } from 'typeorm';

export class LocalQwenEmbeddings1793012400000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // Original document vectors stay in their original columns for instant rollback.
    await q.query(
      `ALTER TABLE knowledge_chunks ADD COLUMN embedding_qwen vector(1024), ADD COLUMN embedding_qwen_identity text`,
    );
    await q.query(`ALTER TABLE knowledge_chunks ADD CONSTRAINT knowledge_qwen_identity CHECK
      ((embedding_qwen IS NULL AND embedding_qwen_identity IS NULL) OR
       (embedding_qwen IS NOT NULL AND embedding_qwen_identity IS NOT NULL AND length(embedding_qwen_identity) BETWEEN 1 AND 1000 AND vector_norm(embedding_qwen)>0))`);
    // These tables already key rows by model identity; remove only the fixed typmod.
    for (const table of ['private_memory_vectors', 'ai_history_vectors']) {
      await q.query(
        `ALTER TABLE ${table} ALTER COLUMN embedding TYPE vector USING embedding::vector`,
      );
      await q.query(
        `ALTER TABLE ${table} ADD CONSTRAINT ${table}_dimensions CHECK(vector_dims(embedding) IN (1024,1536) AND vector_norm(embedding)>0)`,
      );
    }
  }
  async down(): Promise<void> {
    throw new Error(
      'Preserve model-specific vectors. Roll back the provider configuration instead of removing embedding data.',
    );
  }
}
