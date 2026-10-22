import { UnavailableLlmProvider } from '../../src/modules/assistant/llm/unavailable-llm-provider';

describe('Unconfigured AI generation', () => {
  it('returns an unavailable error for answers and proposals instead of invented outputs', async () => {
    const provider = new UnavailableLlmProvider();
    await expect(provider.generateAnswer()).rejects.toThrow('AI generation is not configured.');
    await expect(provider.generateStructuredOutput()).rejects.toThrow(
      'AI generation is not configured.',
    );
  });
});
