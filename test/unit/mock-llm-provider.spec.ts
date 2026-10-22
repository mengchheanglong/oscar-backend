import { MockLlmProvider } from '../../src/modules/assistant/llm/mock-llm-provider';
import { KnowledgeSourceType } from '../../src/modules/ingestion/entities';
import { RetrievedEvidence } from '../../src/modules/mavis/retrieval/retrieval.service';

describe('MockLlmProvider', () => {
  let provider: MockLlmProvider;

  beforeEach(() => {
    provider = new MockLlmProvider();
  });

  it('honestly refuses when evidence is empty', async () => {
    const result = await provider.generateAnswer({
      messages: [{ role: 'user', content: 'What is the deployment procedure?' }],
      evidence: [],
    });

    expect(result.content).toBe(
      'Based on the current project knowledge, there is insufficient evidence to answer this question.',
    );
    expect(result.citations).toEqual([]);
    expect(result.modelName).toBe('mock-llm');
    expect(result.promptTokens).toBeGreaterThan(0);
    expect(result.completionTokens).toBeGreaterThan(0);
  });

  it('synthesizes grounded response with valid citations when evidence is provided', async () => {
    const evidence: RetrievedEvidence[] = [
      {
        chunkId: 'chunk-1',
        sourceId: 'req-1',
        sourceType: KnowledgeSourceType.REQUIREMENT,
        title: 'Authentication Requirement',
        revision: 2,
        locator: 'Section 4.2',
        snippet: 'The system uses server-side cookie sessions with CSRF tokens.',
        score: 0.94,
      },
    ];

    const result = await provider.generateAnswer({
      messages: [{ role: 'user', content: 'How does authentication work?' }],
      evidence,
    });

    expect(result.content).toContain('Authentication Requirement');
    expect(result.content).toContain('[Evidence #1]');
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]).toEqual({
      chunkId: 'chunk-1',
      sourceId: 'req-1',
      sourceType: KnowledgeSourceType.REQUIREMENT,
      title: 'Authentication Requirement',
      revision: 2,
      locator: 'Section 4.2',
      score: 0.94,
      snippet: 'The system uses server-side cookie sessions with CSRF tokens.',
    });
  });
});
