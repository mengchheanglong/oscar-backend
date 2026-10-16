import {
  contextBudget,
  estimateContext,
  prepareConversationContext,
  ContextTurn,
} from '../../src/modules/ai/context/conversation-budget';

describe('Conversation context budget', () => {
  const previous = { summary: '', through: '0', revision: 0 };
  it('retains more than ten messages when they fit without calling a summarizer', async () => {
    const turns: ContextTurn[] = Array.from({ length: 31 }, (_, i) => ({
      seq: String(i + 1),
      role: i % 2 ? 'assistant' : 'user',
      content: `Message ${i}`,
    }));
    const summarize = jest.fn();
    const result = await prepareConversationContext('system', turns, previous, 16000, summarize);
    expect(result.messages).toHaveLength(32);
    expect(summarize).not.toHaveBeenCalled();
    expect(result.through).toBe('0');
  });
  it('compacts whole turns, retains the current request and bounds both calls', async () => {
    const turns: ContextTurn[] = Array.from({ length: 25 }, (_, i) => ({
      seq: String(i + 1),
      role: i % 2 ? 'assistant' : 'user',
      content: 'multilingual 文 '.repeat(55),
    }));
    turns[24]!.content = 'LATEST_REQUEST';
    const summarize = jest.fn(async (_p: string, older: ContextTurn[]) => {
      expect(older.at(-1)?.role).toBe('assistant');
      return 'A concise historical summary.';
    });
    const result = await prepareConversationContext('system', turns, previous, 16000, summarize);
    expect(result.compactions).toBeGreaterThan(0);
    expect(result.messages.at(-1)?.content).toBe('LATEST_REQUEST');
    expect(result.estimated).toBeLessThanOrEqual(16000);
    expect(previous.summary).toBe('');
    expect(result.messages[1]?.role).toBe('user');
  });
  it.each(['', 'x'.repeat(6001)])(
    'fails without mutating durable state when the summary is invalid',
    async (summary) => {
      const turns: ContextTurn[] = [
        { seq: '1', role: 'user', content: 'x'.repeat(8000) },
        { seq: '2', role: 'assistant', content: 'y'.repeat(5000) },
        { seq: '3', role: 'user', content: 'latest' },
      ];
      await expect(
        prepareConversationContext('system', turns, previous, 16000, async () => summary),
      ).rejects.toThrow();
      expect(previous).toEqual({ summary: '', through: '0', revision: 0 });
      expect(turns).toHaveLength(3);
    },
  );
  it('rejects oversized current requests and bounds unknown model capacity', async () => {
    await expect(
      prepareConversationContext(
        'system',
        [{ seq: '1', role: 'user', content: 'x'.repeat(17000) }],
        previous,
        16000,
        async () => '',
      ),
    ).rejects.toThrow();
    expect(contextBudget('unknown', 512000)).toBe(11000);
    expect(contextBudget('deepseek-v4-pro')).toBe(128000);
    expect(estimateContext([{ role: 'user', content: '文' }])).toBeGreaterThan(
      estimateContext([{ role: 'user', content: 'a' }]),
    );
  });
});
