import { DeepSeekLlmProvider } from '../../src/modules/ai/llm/deepseek-llm-provider';
import { ServiceUnavailableException } from '@nestjs/common';

describe('DeepSeek structured drafts', () => {
  afterEach(() => jest.restoreAllMocks());

  it('requests a complete-output budget and parses valid JSON', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: '{"type":"CREATE_TASKS"}' } }],
        }),
      ),
    );
    const result = await new DeepSeekLlmProvider('test').generateStructuredOutput({
      systemPrompt: 'Extract',
      userPrompt: 'Synthetic notes',
    });
    expect(result.data).toEqual({ type: 'CREATE_TASKS' });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).max_tokens).toBe(6000);
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).thinking).toEqual({
      type: 'disabled',
    });
  });

  it('never reports an empty provider answer as completed chat', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ finish_reason: 'length', message: { content: '' } }],
        }),
      ),
    );
    await expect(
      new DeepSeekLlmProvider('test').generateAnswer({ messages: [], evidence: [] }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it.each([
    ['length', '{"partial":', 'AI_OUTPUT_TRUNCATED'],
    ['stop', 'invalid JSON', 'AI_OUTPUT_INVALID_JSON'],
  ])(
    'rejects %s output as an actionable error, never returning a partial draft',
    async (finish, content, code) => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(
          new Response(
            JSON.stringify({ choices: [{ finish_reason: finish, message: { content } }] }),
          ),
        );
      const provider = new DeepSeekLlmProvider('test');
      try {
        await provider.generateStructuredOutput({ systemPrompt: 'Extract', userPrompt: 'Notes' });
        throw new Error('Expected provider failure');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect((error as ServiceUnavailableException).getResponse()).toMatchObject({ code });
      }
    },
  );
});
