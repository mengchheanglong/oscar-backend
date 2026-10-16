import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  PrivateMemoryScope,
  PrivateMemoryResult,
  contentHash,
  validateVectors,
} from './private-memory.contract';

const eligible = `m.project_id=$1 AND m.user_id=$2 AND m.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM project_members pm JOIN users u ON u.id=pm.user_id
    WHERE pm.project_id=m.project_id AND pm.user_id=m.user_id AND pm.removed_at IS NULL AND u.is_active=true)`;
const fields = 'm.id,m.kind,m.content,m.version';

@Injectable()
export class PrivateMemoryRepository {
  constructor(private readonly db: DataSource) {}
  async assertAccess(s: PrivateMemoryScope): Promise<void> {
    const rows: unknown[] = await this.db.query(
      `SELECT 1 FROM project_members pm JOIN users u ON u.id=pm.user_id
      WHERE pm.project_id=$1 AND pm.user_id=$2 AND pm.removed_at IS NULL AND u.is_active=true`,
      [s.projectId, s.userId],
    );
    if (!rows.length)
      throw new NotFoundException({ code: 'PROJECT_NOT_FOUND', message: 'Project not found.' });
  }
  async lexical(s: PrivateMemoryScope, query: string): Promise<PrivateMemoryResult[]> {
    return this.db.query(
      `SELECT ${fields} FROM copilot_memories m
      WHERE ${eligible} AND m.search_document @@ replace(plainto_tsquery('english',$3)::text,'&','|')::tsquery
      ORDER BY ts_rank_cd(m.search_document,replace(plainto_tsquery('english',$3)::text,'&','|')::tsquery) DESC,m.id LIMIT 32`,
      [s.projectId, s.userId, query],
    );
  }
  async hasVectors(s: PrivateMemoryScope, identity: string): Promise<boolean> {
    const rows: unknown[] = await this.db.query(
      `SELECT 1 FROM copilot_memories m JOIN private_memory_vectors v
      ON v.memory_id=m.id AND v.project_id=m.project_id AND v.user_id=m.user_id AND v.source_version=m.version
      WHERE ${eligible} AND v.embedding_identity=$3 LIMIT 1`,
      [s.projectId, s.userId, identity],
    );
    return rows.length > 0;
  }
  async semantic(
    s: PrivateMemoryScope,
    identity: string,
    vector: number[],
  ): Promise<PrivateMemoryResult[]> {
    validateVectors([vector], 1);
    return this.db.query(
      `SELECT ${fields} FROM copilot_memories m JOIN private_memory_vectors v
      ON v.memory_id=m.id AND v.project_id=m.project_id AND v.user_id=m.user_id AND v.source_version=m.version
      WHERE ${eligible} AND v.embedding_identity=$3
      ORDER BY v.embedding <=> $4::vector,m.id LIMIT 32`,
      [s.projectId, s.userId, identity, JSON.stringify(vector)],
    );
  }
  async current(
    s: PrivateMemoryScope,
    selected: PrivateMemoryResult[],
  ): Promise<PrivateMemoryResult[]> {
    if (!selected.length) return [];
    const rows: PrivateMemoryResult[] = await this.db.query(
      `SELECT ${fields} FROM copilot_memories m
      WHERE ${eligible} AND m.id=ANY($3::uuid[])`,
      [s.projectId, s.userId, selected.map((m) => m.id)],
    );
    return selected.filter((m) =>
      rows.some((r) => r.id === m.id && r.version === m.version && r.content === m.content),
    );
  }
  async pending(s: PrivateMemoryScope, identity: string): Promise<PrivateMemoryResult[]> {
    return this.db.query(
      `SELECT ${fields} FROM copilot_memories m WHERE ${eligible}
      AND NOT EXISTS (SELECT 1 FROM private_memory_vectors v WHERE v.memory_id=m.id AND v.project_id=m.project_id
        AND v.user_id=m.user_id AND v.source_version=m.version AND v.embedding_identity=$3)
      ORDER BY m.id LIMIT 32`,
      [s.projectId, s.userId, identity],
    );
  }
  async activate(
    s: PrivateMemoryScope,
    row: PrivateMemoryResult,
    identity: string,
    generation: string,
    vector: number[],
  ): Promise<void> {
    validateVectors([vector], 1);
    await this.db.query(
      `INSERT INTO private_memory_vectors(memory_id,project_id,user_id,source_version,content_hash,embedding_identity,generation_id,embedding)
      SELECT m.id,m.project_id,m.user_id,m.version,$6,$7,$8,$9::vector FROM copilot_memories m
      WHERE ${eligible} AND m.id=$3 AND m.version=$4 AND m.content=$5
      ON CONFLICT(memory_id,embedding_identity) DO UPDATE SET source_version=EXCLUDED.source_version,
        content_hash=EXCLUDED.content_hash,generation_id=EXCLUDED.generation_id,embedding=EXCLUDED.embedding
      WHERE private_memory_vectors.source_version <= EXCLUDED.source_version`,
      [
        s.projectId,
        s.userId,
        row.id,
        row.version,
        row.content,
        contentHash(row.content),
        identity,
        generation,
        JSON.stringify(vector),
      ],
    );
  }
}
