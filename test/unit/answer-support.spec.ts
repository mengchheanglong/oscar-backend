import {
  reviewSourceAnswer,
  sourceQuoteAnchor,
} from '../../src/modules/assistant/context/answer-support';
import { LlmProvider } from '../../src/modules/assistant/llm/llm-provider.interface';
import { AssistantEvidence } from '../../src/modules/knowledge-client/knowledge-evidence';

const body =
  'The proposed pilot has not run. Retention can reflect high switching costs despite dissatisfaction.';
const evidence: AssistantEvidence[] = [
  {
    chunkId: 'c',
    sourceId: 's',
    sourceType: 'EXTERNAL_KNOWLEDGE',
    title: 'Synthetic source',
    revision: 2,
    locator: 'p1',
    text: body,
    snippet: body,
    exactExcerpt: body,
    score: 1,
  },
];
function provider(blocks: unknown[]) {
  return {
    generateStructuredOutput: jest.fn().mockResolvedValue({
      data: {
        blocks: blocks.map((b) => ({
          checks: {
            entailment: true,
            scope: true,
            numbers: true,
            causality: true,
            evidenceStatus: true,
          },
          ...(b as object),
        })),
      },
      modelName: 'same-provider-review',
      promptTokens: 12,
      completionTokens: 8,
    }),
  } as unknown as LlmProvider;
}
const supported = { id: 0, verdict: 'SUPPORTED', sources: [{ evidenceNumber: 1, quote: body }] };

describe('source support review boundary', () => {
  it('enforces an explicit author-only request even if the reviewer approves a project application', async () => {
    const answer = await reviewSourceAnswer(
      provider([supported, { ...supported, id: 1 }]),
      'Keep the explanation attributed to the book.',
      'The pilot is proposed. [Evidence #1]\n\nMy application: measure pilot usage. [Evidence #1]',
      evidence,
    );
    expect(answer.content).toContain('pilot is proposed');
    expect(answer.content).not.toContain('My application');
    expect(answer.audit.blocks[1]!.validation).toBe('OUTSIDE_REQUESTED_SCOPE');
  });
  it('reviews each sentence and drops the whole compound paragraph if any sentence fails', async () => {
    const llm = provider([
      supported,
      { ...supported, id: 1, verdict: 'UNSUPPORTED', sources: [] },
      { ...supported, id: 2 },
    ]);
    const answer = await reviewSourceAnswer(
      llm,
      'Q',
      'The pilot is proposed. [Evidence #1] The pilot proved demand. [Evidence #1]\n\nThe pilot has not run. [Evidence #1]',
      evidence,
    );
    const input = JSON.parse(
      (llm.generateStructuredOutput as jest.Mock).mock.calls[0][0].userPrompt,
    );
    expect(input.blocks).toHaveLength(3);
    expect(input.blocks.map((b: { paragraphId: number }) => b.paragraphId)).toEqual([0, 0, 1]);
    expect(answer.content).not.toContain('proved demand');
    expect(answer.content).not.toContain('pilot is proposed');
    expect(answer.content).toContain('pilot has not run');
    expect(answer.audit.granularity).toBe('sentence');
  });
  it.each(['entailment', 'scope', 'numbers', 'causality', 'evidenceStatus'])(
    'rejects a SUPPORTED verdict with a false %s check',
    async (dimension) => {
      const answer = await reviewSourceAnswer(
        provider([
          {
            ...supported,
            checks: {
              entailment: true,
              scope: true,
              numbers: true,
              causality: true,
              evidenceStatus: true,
              [dimension]: false,
            },
          },
        ]),
        'Q',
        'Claim. [Evidence #1]',
        evidence,
      );
      expect(answer.audit.status).toBe('WITHHELD');
      expect(answer.audit.blocks[0]!.validation).toBe('CLAIM_CHECK_FAILED');
    },
  );
  it('fails closed when the reviewer omits the required claim checks', async () => {
    const llm = {
      generateStructuredOutput: jest.fn().mockResolvedValue({
        data: { blocks: [supported] },
        modelName: 'test',
        promptTokens: 1,
        completionTokens: 1,
      }),
    } as unknown as LlmProvider;
    const answer = await reviewSourceAnswer(llm, 'Q', 'Claim. [Evidence #1]', evidence);
    expect(answer.audit.status).toBe('UNAVAILABLE');
  });
  it('maps PDF whitespace and typographic quotes to a real contiguous original anchor', () => {
    const original = 'The company’s\nproposed pilot has not run.';
    expect(sourceQuoteAnchor(original, "The company's proposed pilot has not run.")).toBe(original);
    expect(sourceQuoteAnchor(original, 'The company’s pilot has not run.')).toBeNull();
  });
  it('never normalizes numbers or mathematical notation into a different claim', () => {
    expect(
      sourceQuoteAnchor(
        'The formula is x² + y² = 1 and the rate is 0.5%.',
        'The formula is x2 + y2 = 1 and the rate is 5%.',
      ),
    ).toBeNull();
  });
  it('reviews every paragraph and removes an unsupported application despite a valid citation', async () => {
    const llm = provider([supported, { id: 1, verdict: 'UNSUPPORTED', sources: [] }]);
    const answer = await reviewSourceAnswer(
      llm,
      'What is verified?',
      'The pilot is proposed. [Evidence #1]\n\nThe pilot has already succeeded. [Evidence #1]',
      evidence,
    );
    expect(answer.content).toContain('The pilot is proposed. [Evidence #1]');
    expect(answer.content).not.toContain('already succeeded');
    expect(answer.audit.status).toBe('FILTERED');
    const request = JSON.parse(
      (llm.generateStructuredOutput as jest.Mock).mock.calls[0][0].userPrompt,
    );
    expect(request.blocks).toHaveLength(2);
    expect(request.evidence[0].segments.map((s: { quote: string }) => s.quote).join('')).toBe(body);
    expect(request.evidence[0].body).toBeUndefined();
    expect(answer.audit.blocks[1]!.verdict).toBe('REMOVED');
  });
  it('resolves supplied segment IDs to original text and rejects unknown IDs', async () => {
    for (const [segmentId, status] of [
      [0, 'APPROVED'],
      [99, 'WITHHELD'],
    ] as const) {
      const answer = await reviewSourceAnswer(
        provider([{ ...supported, sources: [{ evidenceNumber: 1, segmentId }] }]),
        'Q',
        'The pilot is proposed. [Evidence #1]',
        evidence,
      );
      expect(answer.audit.status).toBe(status);
      if (segmentId === 0)
        expect(answer.audit.blocks[0]!.sourceQuotes).toEqual([{ evidenceNumber: 1, quote: body }]);
    }
  });
  it.each([
    [{ ...supported, sources: [{ evidenceNumber: 2, quote: body }] }],
    [
      {
        ...supported,
        sources: [{ evidenceNumber: 1, quote: 'This fabricated quotation is not present.' }],
      },
    ],
    [{ ...supported, sources: [{ evidenceNumber: 1, quote: 'The' }] }],
    [{ ...supported, sources: [] }],
  ])('withholds forged, unknown or insufficient source anchors', async (block) => {
    const answer = await reviewSourceAnswer(
      provider([block]),
      'Question',
      'A claim. [Evidence #1]',
      evidence,
    );
    expect(answer.audit.status).toBe('WITHHELD');
    expect(answer.content).not.toContain('A claim.');
  });
  it.each([
    { blocks: [] },
    { blocks: [supported, supported] },
    { blocks: [{ ...supported, id: 1 }] },
  ])('rejects missing, duplicate or reordered block coverage', async ({ blocks }) => {
    const answer = await reviewSourceAnswer(
      provider(blocks),
      'Q',
      'Claim. [Evidence #1]',
      evidence,
    );
    expect(answer.audit.status).toBe('UNAVAILABLE');
    expect(answer.content).not.toContain('Claim.');
  });
  it('validates quotes against the bounded model excerpt, not unseen full text', async () => {
    const limited = [{ ...evidence[0]!, exactExcerpt: 'The proposed pilot has not run.' }];
    const answer = await reviewSourceAnswer(
      provider([supported]),
      'Q',
      'Retention claim. [Evidence #1]',
      limited,
    );
    expect(answer.audit.status).toBe('WITHHELD');
  });
  it('does not publish unlabeled reasoning', async () => {
    for (const [text, verdict] of [
      ['Retention is always satisfaction. [Evidence #1]', 'REASONING'],
    ]) {
      const answer = await reviewSourceAnswer(
        provider([{ ...supported, verdict }]),
        'Q',
        text!,
        evidence,
      );
      expect(answer.audit.status).toBe('WITHHELD');
    }
  });
  it('completes a missing paragraph citation only after valid quoted support is returned', async () => {
    const answer = await reviewSourceAnswer(
      provider([supported]),
      'Q',
      'The pilot is proposed.',
      evidence,
    );
    expect(answer.content).toBe('The pilot is proposed. [Evidence #1]');
    expect(answer.audit.citationRepairs).toBe(1);
    expect(answer.audit.unreviewedDraft).toBe('The pilot is proposed.');
  });
  it('preserves labelled derived recommendations with source premises', async () => {
    const text = 'My recommendation: measure satisfaction separately. [Evidence #1]';
    const answer = await reviewSourceAnswer(
      provider([{ ...supported, verdict: 'REASONING' }]),
      'Q',
      text,
      evidence,
    );
    expect(answer.content).toBe(text);
    expect(answer.audit.status).toBe('APPROVED');
  });
  it('reviews a heading with its paragraph so application labels and factual headings are not lost', async () => {
    const text = '## My application\n\nMeasure satisfaction separately. [Evidence #1]';
    const llm = provider([{ ...supported, verdict: 'REASONING' }]);
    const answer = await reviewSourceAnswer(llm, 'Q', text, evidence);
    expect(answer.content).toContain('## My application');
    expect(answer.content).toContain('Measure satisfaction');
    const input = JSON.parse(
      (llm.generateStructuredOutput as jest.Mock).mock.calls[0][0].userPrompt,
    );
    expect(input.blocks).toHaveLength(1);
    expect(input.blocks[0].text).toContain('My application');
  });
  it('replaces a scoped limitation rather than retaining broad absence claims', async () => {
    const answer = await reviewSourceAnswer(
      provider([
        { id: 0, verdict: 'SOURCE_LIMIT', sources: [] },
        { ...supported, id: 1 },
      ]),
      'Q',
      'I cannot establish the claim.\n\nThe pilot is proposed. [Evidence #1]',
      evidence,
    );
    expect(answer.content).toContain('not established by the supplied passages');
    expect(answer.content).not.toContain('I cannot establish');
  });
  it('fails closed on reviewer outage without exposing private exception bodies', async () => {
    const llm = {
      generateStructuredOutput: jest.fn().mockRejectedValue(new Error('PRIVATE BODY')),
    } as unknown as LlmProvider;
    const answer = await reviewSourceAnswer(llm, 'Q', 'Draft. [Evidence #1]', evidence);
    expect(answer.audit.status).toBe('UNAVAILABLE');
    expect(answer.content).not.toMatch(/PRIVATE|Draft\./);
  });
});
