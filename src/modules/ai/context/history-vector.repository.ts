import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  contentHash,
  PrivateMemoryScope,
  validateVectors,
} from '../memory/private-memory.contract';
import type { ConversationScope } from './conversation-context.service';
import { HistoryExcerpt, historyEligible } from './conversation-history.repository';
import { DEFAULT_HISTORY_MAX_DISTANCE } from './history-retrieval.contract';

const fields =
  'm.id AS "messageId",c.id AS "conversationId",m.role,left(m.content,900) AS content,m.context_seq::text AS sequence';
const join = `JOIN ai_history_vectors v ON v.message_id=m.id AND v.conversation_id=c.id
  AND v.project_id=c.project_id AND v.user_id=c.user_id AND v.source_excerpt=left(m.content,900)`;

@Injectable()
export class HistoryVectorRepository {
  constructor(private readonly db: DataSource) {}

  async assertAccess(s: PrivateMemoryScope): Promise<void> {
    const rows: unknown[] = await this.db.query(
      `SELECT 1 FROM project_members pm JOIN users u ON u.id=pm.user_id
      WHERE pm.project_id=$1 AND pm.user_id=$2 AND pm.removed_at IS NULL AND u.is_active=true`,
      [s.projectId, s.userId],
    );
    if (!rows.length) throw new NotFoundException('Project not found.');
  }

  async hasVectors(s: ConversationScope, identity: string, through: string): Promise<boolean> {
    const rows: unknown[] = await this.db.query(
      `SELECT 1 FROM ai_messages m JOIN ai_conversations c ON c.id=m.conversation_id ${join}
      WHERE ${historyEligible} AND (c.id<>$3 OR m.context_seq<=$5) AND v.embedding_identity=$4 LIMIT 1`,
      [s.projectId, s.userId, s.conversationId, identity, through],
    );
    return rows.length > 0;
  }

  async semantic(
    s: ConversationScope,
    identity: string,
    through: string,
    vector: number[],
    maxDistance = DEFAULT_HISTORY_MAX_DISTANCE,
  ): Promise<HistoryExcerpt[]> {
    validateVectors([vector], 1);
    return this.db.query(
      `SELECT ${fields} FROM ai_messages m JOIN ai_conversations c ON c.id=m.conversation_id ${join}
      WHERE ${historyEligible} AND (c.id<>$3 OR m.context_seq<=$5) AND v.embedding_identity=$4
      AND (v.embedding <=> $6::vector)<=$7
      ORDER BY v.embedding <=> $6::vector,m.id LIMIT 32`,
      [
        s.projectId,
        s.userId,
        s.conversationId,
        identity,
        through,
        JSON.stringify(vector),
        maxDistance,
      ],
    );
  }

  async current(
    s: ConversationScope,
    through: string,
    selected: HistoryExcerpt[],
  ): Promise<HistoryExcerpt[]> {
    if (!selected.length) return [];
    const rows: HistoryExcerpt[] = await this.db.query(
      `SELECT ${fields} FROM ai_messages m JOIN ai_conversations c ON c.id=m.conversation_id
      WHERE ${historyEligible} AND (c.id<>$3 OR m.context_seq<=$5) AND m.id=ANY($4::uuid[])`,
      [s.projectId, s.userId, s.conversationId, selected.map((r) => r.messageId), through],
    );
    return selected.filter((row) =>
      rows.some(
        (r) =>
          r.messageId === row.messageId &&
          r.content === row.content &&
          r.role === row.role &&
          r.sequence === row.sequence &&
          r.conversationId === row.conversationId,
      ),
    );
  }

  async pending(s: PrivateMemoryScope, identity: string): Promise<HistoryExcerpt[]> {
    return this.db.query(
      `SELECT ${fields} FROM ai_messages m JOIN ai_conversations c ON c.id=m.conversation_id
      WHERE ${historyEligible} AND length(btrim(left(m.content,900)))>0 AND NOT EXISTS
      (SELECT 1 FROM ai_history_vectors v WHERE v.message_id=m.id AND v.conversation_id=c.id
        AND v.project_id=c.project_id AND v.user_id=c.user_id AND v.embedding_identity=$3 AND v.source_excerpt=left(m.content,900))
      ORDER BY m.context_seq,m.id LIMIT 32`,
      [s.projectId, s.userId, identity],
    );
  }

  async activate(
    s: PrivateMemoryScope,
    row: HistoryExcerpt,
    identity: string,
    generation: string,
    vector: number[],
  ): Promise<void> {
    validateVectors([vector], 1);
    // A changed, excluded, deleted or newly inaccessible source cannot activate.
    await this.db.transaction(async (tx) => {
      // Share the privacy-change lock: an exclusion either deletes a vector
      // inserted first, or commits before this source is rechecked for insertion.
      await tx.query(
        'INSERT INTO ai_history_scope(project_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [s.projectId, s.userId],
      );
      await tx.query(
        'SELECT 1 FROM ai_history_scope WHERE project_id=$1 AND user_id=$2 FOR UPDATE',
        [s.projectId, s.userId],
      );
      await tx.query(
        `INSERT INTO ai_history_vectors(message_id,conversation_id,project_id,user_id,
      source_excerpt,content_hash,embedding_identity,generation_id,embedding)
      SELECT m.id,c.id,c.project_id,c.user_id,$5,$6,$7,$8,$9::vector
      FROM ai_messages m JOIN ai_conversations c ON c.id=m.conversation_id
      WHERE ${historyEligible} AND m.id=$3 AND c.id=$4 AND left(m.content,900)=$5
      ON CONFLICT(message_id,embedding_identity) DO UPDATE SET source_excerpt=EXCLUDED.source_excerpt,
        content_hash=EXCLUDED.content_hash,generation_id=EXCLUDED.generation_id,embedding=EXCLUDED.embedding`,
        [
          s.projectId,
          s.userId,
          row.messageId,
          row.conversationId,
          row.content,
          contentHash(row.content),
          identity,
          generation,
          JSON.stringify(vector),
        ],
      );
    });
  }
}
