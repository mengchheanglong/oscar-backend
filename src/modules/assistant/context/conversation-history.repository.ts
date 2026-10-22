import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { ConversationScope } from './conversation-context.service';

export interface HistoryExcerpt {
  messageId: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  /** Canonical saved-message order; optional only for legacy/scripted sources. */
  sequence?: string;
}

export const historyOwner = `c.project_id=$1 AND c.user_id=$2 AND c.deleted_at IS NULL
  AND EXISTS(SELECT 1 FROM project_members pm JOIN users u ON u.id=pm.user_id
    WHERE pm.project_id=c.project_id AND pm.user_id=c.user_id
    AND pm.removed_at IS NULL AND u.is_active=true)`;
const owner = historyOwner;
export const historyEligible = `${historyOwner} AND m.context_excluded=false AND m.status='COMPLETED'
  AND m.role IN ('user','assistant')`;

@Injectable()
export class ConversationHistoryRepository {
  constructor(private readonly db: DataSource) {}

  async revision(s: ConversationScope): Promise<string> {
    await this.db.query(
      `INSERT INTO ai_history_scope(project_id,user_id) VALUES($1,$2)
      ON CONFLICT DO NOTHING`,
      [s.projectId, s.userId],
    );
    const rows: { revision: string }[] = await this.db.query(
      'SELECT revision::text FROM ai_history_scope WHERE project_id=$1 AND user_id=$2',
      [s.projectId, s.userId],
    );
    return rows[0]!.revision;
  }

  async lockRevision(tx: EntityManager, s: ConversationScope, expected: string): Promise<void> {
    const rows: { revision: string }[] = await tx.query(
      'SELECT revision::text FROM ai_history_scope WHERE project_id=$1 AND user_id=$2 FOR UPDATE',
      [s.projectId, s.userId],
    );
    if (rows[0]?.revision !== expected)
      throw new ConflictException({
        code: 'HISTORY_CHANGED',
        message: 'History changed. Retry your request.',
      });
  }

  async recall(
    s: ConversationScope,
    query: string,
    through: string,
    maxBytes = 6000,
  ): Promise<HistoryExcerpt[]> {
    const rows = await this.lexical(s, query, through);
    const selected: HistoryExcerpt[] = [];
    for (const row of rows) {
      if (selected.length === 6) break;
      if (Buffer.byteLength(JSON.stringify([...selected, row]), 'utf8') > maxBytes) continue;
      selected.push(row);
    }
    return selected;
  }

  async lexical(s: ConversationScope, query: string, through: string): Promise<HistoryExcerpt[]> {
    if (!query.trim()) return [];
    const rows: HistoryExcerpt[] = await this.db.query(
      `SELECT m.id AS "messageId",c.id AS "conversationId",m.role,left(m.content,900) AS content,m.context_seq::text AS sequence
      FROM ai_messages m JOIN ai_conversations c ON c.id=m.conversation_id,
      (SELECT replace(plainto_tsquery('english',$4)::text,'&','|')::tsquery AS terms) q
      WHERE ${historyEligible} AND (c.id<>$3 OR m.context_seq<=$5)
      AND m.history_search @@ q.terms
      ORDER BY ts_rank_cd(m.history_search,q.terms) DESC,m.context_seq DESC,m.id LIMIT 32`,
      [s.projectId, s.userId, s.conversationId, query.slice(0, 2000), through],
    );
    return rows;
  }

  async record(tx: EntityManager, s: ConversationScope, excerpts: HistoryExcerpt[]): Promise<void> {
    const sources = [...new Set(excerpts.map((e) => e.conversationId))].filter(
      (id) => id !== s.conversationId,
    );
    for (const id of sources)
      await tx.query(
        `INSERT INTO ai_history_dependencies(project_id,user_id,conversation_id,source_conversation_id)
        VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [s.projectId, s.userId, s.conversationId, id],
      );
  }

  async exclude(s: ConversationScope, messageId?: string): Promise<void> {
    await this.revision(s);
    await this.db.transaction(async (tx) => {
      // Serializes privacy changes against every in-flight answer commit in this scope.
      await tx.query(
        'SELECT 1 FROM ai_history_scope WHERE project_id=$1 AND user_id=$2 FOR UPDATE',
        [s.projectId, s.userId],
      );
      const found: unknown[] = await tx.query(
        `SELECT 1 FROM ai_conversations c WHERE ${owner} AND c.id=$3`,
        [s.projectId, s.userId, s.conversationId],
      );
      if (!found.length) throw new NotFoundException('Conversation not found.');
      if (messageId) {
        const messages: { context_excluded: boolean }[] = await tx.query(
          'SELECT context_excluded FROM ai_messages WHERE id=$1 AND conversation_id=$2',
          [messageId, s.conversationId],
        );
        if (!messages.length) throw new NotFoundException('Message not found.');
        if (messages[0]!.context_excluded) return;
      }
      // Conversation-level dependency closure is deliberately conservative: all
      // assistant replies in affected chats may repeat the excluded source.
      const affected: { id: string }[] = await tx.query(
        `WITH RECURSIVE affected(id) AS (
        SELECT $3::uuid UNION SELECT d.conversation_id FROM ai_history_dependencies d
        JOIN affected a ON d.source_conversation_id=a.id WHERE d.project_id=$1 AND d.user_id=$2)
        SELECT id FROM affected`,
        [s.projectId, s.userId, s.conversationId],
      );
      const ids = affected.map((r) => r.id);
      await tx.query(
        `UPDATE ai_messages m SET context_excluded=true FROM ai_conversations c
        WHERE m.conversation_id=c.id AND c.project_id=$1 AND c.user_id=$2
        AND c.id=ANY($3::uuid[]) AND (m.role='assistant' OR m.id=$4)`,
        [s.projectId, s.userId, ids, messageId ?? null],
      );
      await tx.query(
        'DELETE FROM ai_conversation_context WHERE project_id=$1 AND user_id=$2 AND conversation_id=ANY($3::uuid[])',
        [s.projectId, s.userId, ids],
      );
      await tx.query(
        `DELETE FROM ai_history_vectors v USING ai_messages m
        WHERE v.message_id=m.id AND v.project_id=$1 AND v.user_id=$2
        AND v.conversation_id=ANY($3::uuid[]) AND (m.context_excluded=true OR m.conversation_id=$4)`,
        [s.projectId, s.userId, ids, messageId ? null : s.conversationId],
      );
      if (!messageId)
        await tx.query(
          'UPDATE ai_conversations SET deleted_at=now() WHERE id=$1 AND project_id=$2 AND user_id=$3',
          [s.conversationId, s.projectId, s.userId],
        );
      await tx.query(
        'UPDATE ai_history_scope SET revision=revision+1 WHERE project_id=$1 AND user_id=$2',
        [s.projectId, s.userId],
      );
    });
  }
}
