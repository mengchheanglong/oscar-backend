import { MessageStatus } from '../../src/modules/assistant/entities/chat-message.entity';
import { gradeHistoryAnswer } from '../fixtures/history-answer-evaluation';
import { EvaluationNetworkBudget } from '../../scripts/lib/evaluation-network-budget';

describe('History answer evaluation scoring and spend boundaries', () => {
  it('requires the corrected value without accepting the old value or invented citations', () => {
    const grade = (s: string, citations = 0) =>
      gradeHistoryAnswer(s, 'AMBER', ['ORCHID'], MessageStatus.COMPLETED, citations);
    expect(grade('**AMBER**').passed).toBe(true);
    expect(grade('AMBER, previously ORCHID').passed).toBe(false);
    expect(grade('AMBER', 1).passed).toBe(false);
    expect(grade('AMBERISH').passed).toBe(false);
    expect(grade('Your label is not AMBER.').passed).toBe(false);
    expect(grade('Maybe AMBER.').passed).toBe(false);
    expect(gradeHistoryAnswer('AMBER', 'AMBER', [], MessageStatus.FAILED, 0).passed).toBe(false);
  });
  it('separates answer correctness from short-output formatting and unknown abstention', () => {
    const verbose = gradeHistoryAnswer(
      'Your label is AMBER.',
      'AMBER',
      [],
      MessageStatus.COMPLETED,
      0,
    );
    expect(verbose.passed).toBe(true);
    expect(verbose.formatCorrect).toBe(false);
    expect(
      gradeHistoryAnswer('UNKNOWN', 'UNKNOWN', ['INDIGO'], MessageStatus.COMPLETED, 0).passed,
    ).toBe(true);
    expect(
      gradeHistoryAnswer('UNKNOWN or INDIGO', 'UNKNOWN', ['INDIGO'], MessageStatus.COMPLETED, 0)
        .passed,
    ).toBe(false);
  });
  const generation = 'https://generation.test/chat/completions',
    embedding = 'https://embedding.test/embeddings';
  it('rejects unsupported endpoints, models, output caps and excessive requests before networking', async () => {
    const request = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response('{}', { status: 200 }));
    const meter = new EvaluationNetworkBudget(generation, embedding, 'deepseek-v4-pro', request);
    const body = {
      model: 'deepseek-v4-pro',
      messages: [{ content: 'Synthetic' }],
      max_tokens: 3000,
    };
    for (const [endpoint, payload] of [
      ['https://other.test/', body],
      [generation, { ...body, model: 'other' }],
      [generation, { ...body, max_tokens: 5000 }],
    ] as const)
      await expect(meter.fetch(endpoint, { body: JSON.stringify(payload) })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    for (let i = 0; i < 14; i++) await meter.fetch(generation, { body: JSON.stringify(body) });
    await expect(meter.fetch(generation, { body: JSON.stringify(body) })).rejects.toThrow(
      'EVAL_NETWORK_LIMIT',
    );
    expect(request).toHaveBeenCalledTimes(14);
  });
  it('counts failed requests conservatively and meters UTF-8 input before sending', async () => {
    const request = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockRejectedValue(new Error('provider failed'));
    const meter = new EvaluationNetworkBudget(generation, embedding, 'deepseek-v4-pro', request);
    await expect(
      meter.fetch(embedding, { body: JSON.stringify({ input: ['文'] }) }),
    ).rejects.toThrow();
    expect(meter.usage.embeddingCalls).toBe(1);
    expect(meter.usage.embeddingInputBytes).toBe(3);
    await expect(
      meter.fetch(embedding, { body: JSON.stringify({ input: ['a'.repeat(100001)] }) }),
    ).rejects.toThrow('EVAL_NETWORK_LIMIT');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
