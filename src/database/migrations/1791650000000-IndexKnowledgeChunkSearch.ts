import { MigrationInterface, QueryRunner } from 'typeorm';

export class IndexKnowledgeChunkSearch1791650000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE knowledge_chunks ADD COLUMN search_vector tsvector
      GENERATED ALWAYS AS (to_tsvector('english', coalesce(text, ''))) STORED`);
    await queryRunner.query(
      `CREATE INDEX idx_knowledge_chunks_search ON knowledge_chunks USING GIN (search_vector)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX idx_knowledge_chunks_search`);
    await queryRunner.query(`ALTER TABLE knowledge_chunks DROP COLUMN search_vector`);
  }
}
