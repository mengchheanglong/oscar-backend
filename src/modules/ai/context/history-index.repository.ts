import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { contentHash, PrivateMemoryScope } from '../memory/private-memory.contract';
import { HistoryExcerpt, historyEligible } from './conversation-history.repository';

export interface HistoryIndexLimits {
  globalTexts: number;
  globalBytes: number;
  scopeTexts: number;
  scopeBytes: number;
}
export interface HistoryIndexBatch {
  scope: PrivateMemoryScope;
  rows: HistoryExcerpt[];
  lease: string;
  identity: string;
}
interface Usage {
  texts: number;
  input_bytes: number;
}
const scopeKey = (s: PrivateMemoryScope) => `${s.projectId}:${s.userId}`;

@Injectable()
export class HistoryIndexRepository {
  constructor(private readonly db: DataSource) {}

  /** Reservations survive failures/restarts; all replicas serialize this short transaction. */
  async claim(identity: string, limits: HistoryIndexLimits): Promise<HistoryIndexBatch | null> {
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('history-index-budget',84))");
      const days: { day: string }[] = await tx.query(
        "SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS day",
      );
      const day = days[0]!.day;
      const usage: Usage[] = await tx.query(
        'SELECT texts,input_bytes FROM ai_history_index_usage WHERE day=$1 AND scope_key=$2',
        [day, 'global'],
      );
      const global = usage[0] ?? { texts: 0, input_bytes: 0 };
      if (global.texts >= limits.globalTexts || global.input_bytes >= limits.globalBytes)
        return null;
      // Scope comes from persisted ownership, never from a model or queued payload.
      // Filters precede LIMIT, including retry eligibility and both daily budgets.
      const candidates: (HistoryExcerpt & PrivateMemoryScope)[] = await tx.query(
        `SELECT m.id AS "messageId",c.id AS "conversationId",c.project_id AS "projectId",
        c.user_id AS "userId",m.role,left(m.content,900) AS content
        FROM ai_messages m JOIN ai_conversations c ON c.id=m.conversation_id
        JOIN users u ON u.id=c.user_id AND u.is_active=true
        JOIN project_members pm ON pm.project_id=c.project_id AND pm.user_id=c.user_id AND pm.removed_at IS NULL
        LEFT JOIN ai_history_index_usage b ON b.day=$2 AND b.scope_key=c.project_id::text||':'||c.user_id::text
        WHERE c.deleted_at IS NULL AND m.context_excluded=false AND m.status='COMPLETED'
        AND m.role IN ('user','assistant') AND length(btrim(left(m.content,900)))>0
        AND NOT EXISTS(SELECT 1 FROM ai_history_vectors v WHERE v.message_id=m.id
          AND v.conversation_id=c.id AND v.project_id=c.project_id AND v.user_id=c.user_id
          AND v.embedding_identity=$1 AND v.source_excerpt=left(m.content,900))
        AND NOT EXISTS(SELECT 1 FROM ai_history_index_jobs j WHERE j.message_id=m.id
          AND j.embedding_identity=$1 AND j.content_hash=encode(sha256(convert_to(left(m.content,900),'UTF8')),'hex')
          AND (j.attempts>=3 OR j.next_attempt_at>clock_timestamp()))
        AND COALESCE(b.texts,0)<$3
        AND octet_length(left(m.content,900))<=LEAST($4-COALESCE(b.input_bytes,0),$5)
        ORDER BY COALESCE(b.texts,0),m.context_seq,m.id LIMIT 32`,
        [
          identity,
          day,
          limits.scopeTexts,
          limits.scopeBytes,
          limits.globalBytes - global.input_bytes,
        ],
      );
      const first = candidates[0];
      if (!first) return null;
      const scope = { projectId: first.projectId, userId: first.userId };
      const scoped: Usage[] = await tx.query(
        'SELECT texts,input_bytes FROM ai_history_index_usage WHERE day=$1 AND scope_key=$2',
        [day, scopeKey(scope)],
      );
      const used = scoped[0] ?? { texts: 0, input_bytes: 0 };
      const maxTexts = Math.min(
        8,
        limits.globalTexts - global.texts,
        limits.scopeTexts - used.texts,
      );
      const maxBytes = Math.min(
        limits.globalBytes - global.input_bytes,
        limits.scopeBytes - used.input_bytes,
      );
      const rows: HistoryExcerpt[] = [];
      let bytes = 0;
      for (const row of candidates) {
        if (row.projectId !== scope.projectId || row.userId !== scope.userId) continue;
        const size = Buffer.byteLength(row.content, 'utf8');
        if (rows.length >= maxTexts || bytes + size > maxBytes) continue;
        rows.push({
          messageId: row.messageId,
          conversationId: row.conversationId,
          role: row.role,
          content: row.content,
        });
        bytes += size;
      }
      if (!rows.length) return null;
      const lease = randomUUID();
      for (const row of rows)
        await tx.query(
          `INSERT INTO ai_history_index_jobs(message_id,embedding_identity,content_hash,attempts,lease_id,next_attempt_at)
        VALUES($1,$2,$3,1,$4,clock_timestamp()+interval '2 minutes')
        ON CONFLICT(message_id,embedding_identity,content_hash) DO UPDATE
        SET attempts=ai_history_index_jobs.attempts+1,lease_id=EXCLUDED.lease_id,next_attempt_at=EXCLUDED.next_attempt_at`,
          [row.messageId, identity, contentHash(row.content), lease],
        );
      for (const key of ['global', scopeKey(scope)])
        await tx.query(
          `INSERT INTO ai_history_index_usage(day,scope_key,calls,texts,input_bytes) VALUES($1,$2,1,$3,$4)
        ON CONFLICT(day,scope_key) DO UPDATE SET calls=ai_history_index_usage.calls+1,
        texts=ai_history_index_usage.texts+EXCLUDED.texts,input_bytes=ai_history_index_usage.input_bytes+EXCLUDED.input_bytes`,
          [day, key, rows.length, bytes],
        );
      return { scope, rows, lease, identity };
    });
  }

  async owns(batch: HistoryIndexBatch): Promise<boolean> {
    const rows: unknown[] = await this.db.query(
      `SELECT 1 FROM ai_history_index_jobs WHERE lease_id=$1 AND embedding_identity=$2
      AND next_attempt_at>clock_timestamp() LIMIT 1`,
      [batch.lease, batch.identity],
    );
    return rows.length > 0;
  }

  async sources(batch: HistoryIndexBatch): Promise<HistoryExcerpt[]> {
    const rows: HistoryExcerpt[] = await this.db.query(
      `SELECT m.id AS "messageId",c.id AS "conversationId",m.role,left(m.content,900) AS content
      FROM ai_messages m JOIN ai_conversations c ON c.id=m.conversation_id
      WHERE ${historyEligible} AND m.id=ANY($3::uuid[])`,
      [batch.scope.projectId, batch.scope.userId, batch.rows.map((r) => r.messageId)],
    );
    return batch.rows.filter((r) =>
      rows.some(
        (current) =>
          current.messageId === r.messageId &&
          current.conversationId === r.conversationId &&
          current.content === r.content &&
          current.role === r.role,
      ),
    );
  }

  async finish(batch: HistoryIndexBatch, failed: boolean): Promise<void> {
    await this.db.query(
      `UPDATE ai_history_index_jobs SET next_attempt_at=clock_timestamp()+
      CASE WHEN $3 THEN CASE WHEN attempts=1 THEN interval '1 minute' ELSE interval '5 minutes' END
      ELSE interval '0 seconds' END WHERE lease_id=$1 AND embedding_identity=$2`,
      [batch.lease, batch.identity, failed],
    );
  }
}
