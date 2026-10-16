import { HistoryExcerpt } from './conversation-history.repository';
export const DEFAULT_HISTORY_MAX_DISTANCE = 0.65;
export const HISTORY_MAX_DISTANCE = 'HISTORY_MAX_DISTANCE';

// The input format is part of the identity. Head excerpts never share a vector
// namespace with full-memory embeddings, even when their model is the same.
export function historyEmbeddingIdentity(providerIdentity: string): string {
  const identity = JSON.stringify([providerIdentity, 'history-head-900-v1']);
  if (identity.length > 1200) throw new Error('HISTORY_EMBEDDING_IDENTITY_INVALID');
  return identity;
}

export function fuseHistory(
  lexical: HistoryExcerpt[],
  semantic: HistoryExcerpt[],
  maxBytes = 6000,
): HistoryExcerpt[] {
  const ranked = new Map<string, { row: HistoryExcerpt; score: number }>();
  for (const rows of [lexical, semantic]) {
    const seen = new Set<string>();
    rows.forEach((row, i) => {
      if (seen.has(row.messageId)) return;
      seen.add(row.messageId);
      const old = ranked.get(row.messageId);
      ranked.set(row.messageId, { row, score: (old?.score ?? 0) + 1 / (61 + i) });
    });
  }
  const selected: HistoryExcerpt[] = [];
  for (const { row } of [...ranked.values()].sort(
    (a, b) => b.score - a.score || a.row.messageId.localeCompare(b.row.messageId),
  )) {
    if (selected.length === 6) break;
    if (Buffer.byteLength(JSON.stringify([...selected, row]), 'utf8') <= maxBytes)
      selected.push(row);
  }
  return selected;
}
