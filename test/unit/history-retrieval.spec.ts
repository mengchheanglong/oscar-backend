import {
  fuseHistory,
  historyEmbeddingIdentity,
} from '../../src/modules/ai/context/history-retrieval.contract';
import { HistoryExcerpt } from '../../src/modules/ai/context/conversation-history.repository';

const row = (id: string, content = 'Synthetic excerpt.'): HistoryExcerpt => ({
  messageId: id,
  conversationId: 'chat',
  role: 'user',
  content,
});
describe('History retrieval fusion', () => {
  it('deduplicates both lists and ranks agreement above a single retriever', () => {
    const a = row('a'),
      b = row('b'),
      c = row('c');
    expect(fuseHistory([a, b, b], [c, b]).map((r) => r.messageId)).toEqual(['b', 'a', 'c']);
  });
  it('uses UTF-8 byte limits and skips oversized candidates instead of hiding smaller matches', () => {
    const selected = fuseHistory([row('a', '文'.repeat(500)), row('b')], [], 500);
    expect(selected.map((r) => r.messageId)).toEqual(['b']);
    expect(Buffer.byteLength(JSON.stringify(selected), 'utf8')).toBeLessThanOrEqual(500);
    expect(
      fuseHistory(
        Array.from({ length: 40 }, (_, i) => row(String(i))),
        [],
      ),
    ).toHaveLength(6);
  });
  it('keeps model and format identities separate', () => {
    expect(historyEmbeddingIdentity('model-a')).not.toBe(historyEmbeddingIdentity('model-b'));
    expect(historyEmbeddingIdentity('model-a')).not.toBe('model-a');
    expect(() => historyEmbeddingIdentity('x'.repeat(1200))).toThrow();
  });
});
