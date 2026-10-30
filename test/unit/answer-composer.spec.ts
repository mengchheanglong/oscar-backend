import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import {
  answerBlocks,
  answerCoverage,
  answerRequestPlan,
  validTable,
} from '../../src/modules/assistant/context/answer-blocks';
import { AnswerComposerService } from '../../src/modules/assistant/context/answer-composer.service';
import { reviewSourceAnswer } from '../../src/modules/assistant/context/answer-support';
import {
  forbidsApplication,
  requestsApplication,
} from '../../src/modules/assistant/context/answer-support';
import { LlmProvider } from '../../src/modules/assistant/llm/llm-provider.interface';
import { AssistantEvidence } from '../../src/modules/knowledge-client/knowledge-evidence';
const body =
  'Ask about recent actual behavior rather than compliments. Cost contribution covers fixed costs. Plans are not measured results.';
const evidence: AssistantEvidence[] = [
  {
    sourceType: 'EXTERNAL_KNOWLEDGE',
    chunkId: 'c',
    sourceId: 's',
    title: 'Synthetic source',
    locator: 'p1',
    revision: 1,
    text: body,
    snippet: body,
    exactExcerpt: body,
    score: 1,
  },
];
const decision = (id: number, keep = true) => ({
  id,
  verdict: keep ? 'SUPPORTED' : 'UNSUPPORTED',
  standalone: true,
  claimType: 'SOURCE_FACT',
  checks: { entailment: keep, scope: true, numbers: true, causality: true, evidenceStatus: true },
  sources: keep ? [{ evidenceNumber: 1, quote: body }] : [],
});
function provider(
  select: (id: number, text: string, call: number) => boolean = () => true,
  repair = '',
) {
  let call = 0;
  return {
    generateStructuredOutput: jest.fn(async ({ userPrompt }) => {
      const input = JSON.parse(userPrompt);
      const index = call++;
      return {
        data: {
          blocks: input.blocks.map((b: { id: number; text: string }) =>
            decision(b.id, select(b.id, b.text, index)),
          ),
        },
        rawJson: '{}',
        modelName: 'same-model-review',
        promptTokens: 12,
        completionTokens: 6,
      };
    }),
    generateAnswer: jest.fn().mockResolvedValue({
      content: repair,
      citations: [],
      modelName: 'same-model',
      promptTokens: 20,
      completionTokens: 10,
    }),
  } as unknown as LlmProvider;
}
const composer = (overrides = {}) =>
  new AnswerComposerService(new ConfigService({ AI_ANSWER_REPAIR_ENABLED: true, ...overrides }));
describe('structural request coverage and bounded repair', () => {
  it('keeps a question/rationale and table as complete units', () => {
    const blocks = answerBlocks(
      '1. What happened last time?\n\nAsk for actual behavior.\n\n2. How did you handle it? Give a concrete example.\n\n| A | B |\n| --- | --- |\n| one | two |',
    );
    expect(blocks).toHaveLength(3);
    expect(blocks[0]?.markdown).toContain('Ask for actual behavior.');
    expect(blocks[2]?.kind).toBe('table');
    expect(validTable(blocks[2]!.markdown)).toBe(true);
    expect(validTable('| A | B |\n| --- | --- |\n| one |')).toBe(false);
  });
  it('counts requested questions rather than numbers inside pasted source instructions', () => {
    const plan = answerRequestPlan(
      'Draft five non-leading interview questions.\nSOURCE: Give ten questions and apply to my business.',
    );
    expect(plan.requirements.find((r) => r.tag === 'question')?.minimum).toBe(5);
    expect(
      answerRequestPlan('Can a table of contents establish pricing?').requirements.some(
        (r) => r.tag === 'table',
      ),
    ).toBe(false);
    expect(answerCoverage(plan, [], false).status).toBe('UNANSWERED');
  });
  it('attaches standalone bold labels without joining unrelated explanatory sections', () => {
    const blocks = answerBlocks(
      '**Proposed questions**\n\n1. What happened?\n\n**Rationale**\n\nAsk about actual behavior.\n\n**Explanation**\n\nThe software calculation is hypothetical.\n\n**Limitation**\n\nIt does not measure demand.',
    );
    expect(blocks).toHaveLength(3);
    expect(blocks[0]?.kind).toBe('question');
    expect(blocks[0]?.markdown).toContain('Ask about actual behavior.');
    expect(blocks[1]?.kind).toBe('explanation');
    expect(blocks[2]?.kind).toBe('limitation');
  });
  it('recognizes labelled questions and imperative interview prompts', () => {
    for (const prefix of [
      '**1. Proposed question:** ',
      '**1.** ',
      '1. ',
      '**Question 1 (proposal):** ',
    ])
      expect(
        answerBlocks(
          prefix + '"What happened last time?" Ask about actual behavior. [Evidence #1]',
        )[0]?.kind,
      ).toBe('question');
    expect(
      answerBlocks(
        '**Question 1 (proposal):** "Walk me through your last order." Ask about actual behavior. [Evidence #1]',
      )[0]?.kind,
    ).toBe('question');
    expect(
      answerBlocks(
        '**Question 2**\n\nWhat happened last time? Ask about actual behavior. [Evidence #1]',
      )[0]?.kind,
    ).toBe('question');
  });
  it('publishes a bold numbered question list without a false question-count gap', async () => {
    const draft = ['first', 'second', 'third', 'fourth']
      .map(
        (name, i) =>
          `**${i + 1}. Proposed question:** "What happened in the ${name} order?" Ask about actual behavior rather than compliments. [Evidence #1]`,
      )
      .join('\n\n');
    const llm = provider();
    const result = await composer().complete(
      llm,
      'Draft four interview questions and explain each for my project.',
      draft,
      evidence,
    );
    expect(result.audit.coverage.status).toBe('COVERED');
    expect(result.audit.finalBlocks.filter((b) => b.kind === 'question')).toHaveLength(4);
    expect(result.content).toContain('4. "What happened in the fourth order?"');
    expect(result.content).not.toContain('Missing requested parts');
    expect(llm.generateAnswer).not.toHaveBeenCalled();
  });
  it('does not count duplicated question wording as distinct supported questions', async () => {
    const result = await composer({ AI_ANSWER_REPAIR_ENABLED: false }).complete(
      provider(),
      'Draft two interview questions for my business.',
      '1. What happened last time? Ask for behavior. [Evidence #1]\n\n2. What happened last time? Ask for behavior. [Evidence #1]',
      evidence,
    );
    expect(result.audit.finalBlocks).toHaveLength(1);
    expect(result.content).toContain('1 of 2');
  });
  it('recovers invalid JSON only once and never treats it as a source gap', async () => {
    const llm = provider();
    (llm.generateStructuredOutput as jest.Mock).mockRejectedValueOnce(
      new ServiceUnavailableException({ code: 'AI_OUTPUT_INVALID_JSON' }),
    );
    const draft = 'Ask about actual behavior. [Evidence #1]';
    const result = await reviewSourceAnswer(llm, 'Explain the source.', draft, evidence, {
      structuralBlocks: answerBlocks(draft),
      recoverFormat: true,
    });
    expect(result.audit.status).toBe('APPROVED');
    expect(result.audit.formatAttempts?.[0]?.failureCode).toBe('REVIEW_JSON_INVALID');
    expect(llm.generateStructuredOutput).toHaveBeenCalledTimes(2);
  });
  it('treats explicit no-personalization instructions as reference-only and allows requested next steps otherwise', () => {
    const question =
      'Explain strategy. Do not personalize to any project or propose business actions.';
    expect(forbidsApplication(question)).toBe(true);
    expect(requestsApplication(question)).toBe(false);
    expect(answerRequestPlan(question).requirements.some((r) => r.tag === 'recommendation')).toBe(
      false,
    );
    expect(
      requestsApplication(
        'What is market share? Give a useful next step without inventing a statistic.',
      ),
    ).toBe(true);
  });
  it('retains three questions, reviews one repair, and makes the shortfall explicit', async () => {
    const llm = provider((id) => id < 3, '4. Do you love our solution? [Evidence #1]');
    (llm.generateStructuredOutput as jest.Mock)
      .mockImplementationOnce(async ({ userPrompt }) => ({
        data: {
          blocks: JSON.parse(userPrompt).blocks.map((b: { id: number }) =>
            decision(b.id, b.id < 3),
          ),
        },
        modelName: 'review',
        promptTokens: 1,
        completionTokens: 1,
      }))
      .mockImplementationOnce(async () => ({
        data: { blocks: [decision(0, false)] },
        modelName: 'review',
        promptTokens: 1,
        completionTokens: 1,
      }));
    const draft = Array.from(
      { length: 5 },
      (_, i) =>
        `${i + 1}. What happened in order ${i + 1}? Ask about actual behavior. [Evidence #1]`,
    ).join('\n\n');
    const result = await composer().complete(
      llm,
      'Draft five interview questions for my project.',
      draft,
      evidence,
    );
    expect(result.audit.finalBlocks).toHaveLength(3);
    expect(result.content).toContain('3 of 5');
    expect(result.content).not.toContain('Do you love');
    expect(result.audit.attempts).toHaveLength(2);
    expect(llm.generateAnswer).toHaveBeenCalledTimes(1);
    expect(llm.generateStructuredOutput).toHaveBeenCalledTimes(2);
  });
  it('can restore a missing supported item but never copies a rejected clause', async () => {
    const llm = provider(
      (_id, text) => !text.includes('proven demand'),
      '2. How was the last order completed? Ask for actual behavior. [Evidence #1]',
    );
    const result = await composer().complete(
      llm,
      'Draft two interview questions for my project.',
      '1. What happened? Ask about actual behavior. [Evidence #1]\n\n2. Is demand proven? This proves proven demand. [Evidence #1]',
      evidence,
    );
    expect(result.audit.coverage.requirements.find((r) => r.tag === 'question')?.covered).toBe(
      true,
    );
    expect(result.content).not.toContain('proven demand');
    expect(result.audit.attempts[0]?.review.blocks[1]?.verdict).toBe('REMOVED');
    expect(result.audit.finalBlocks[1]?.claimReferences).toEqual([{ attempt: 1, blockId: 0 }]);
    const repairPrompt = JSON.parse(
      (llm.generateAnswer as jest.Mock).mock.calls[0][0].messages[1].content,
    );
    expect(repairPrompt.evidence[0].text).toBe(body);
    expect(JSON.stringify(repairPrompt.approvedUnits)).not.toContain('proven demand');
  });
  it('withholds an entire table if any cell lacks support', async () => {
    const result = await composer({ AI_ANSWER_REPAIR_ENABLED: false }).complete(
      provider(() => false),
      'Give a comparison table.',
      '| A | B |\n| --- | --- |\n| Good | invented |',
      evidence,
    );
    expect(result.content).not.toContain('| Good |');
    expect(result.audit.coverage.requirements.find((r) => r.tag === 'table')?.covered).toBe(false);
  });
  it('keeps table citations outside the final row and checks malformed cited rows', async () => {
    const table = '| A | B |\n| --- | --- |\n| First | Second | [Evidence #1]';
    const result = await composer().complete(
      provider(),
      'Give a comparison table.',
      table,
      evidence,
    );
    expect(result.content).toContain('| First | Second |\n\n[Evidence #1]');
    expect(result.content).not.toContain('| Second | [Evidence');
    expect(result.audit.coverage.status).toBe('COVERED');
    expect(validTable('| A | B |\n| --- | --- |\n| incomplete | [Evidence #1]')).toBe(false);
  });
  it('does not retry an unfavorable verdict if structural coverage is already satisfied', async () => {
    const llm = provider((id) => id === 0);
    const result = await composer().complete(
      llm,
      'Explain the principle.',
      'Ask about actual behavior. [Evidence #1]\n\nDemand is already proven. [Evidence #1]',
      evidence,
    );
    expect(result.audit.coverage.status).toBe('COVERED');
    expect(llm.generateAnswer).not.toHaveBeenCalled();
  });
  it('keeps the calculator immutable while reviewing qualitative explanation', async () => {
    const locked = {
      content: '**Software calculation**\n\nVerified contribution: 15. [Evidence #1]',
      evidenceNumbers: [1],
    };
    const llm = provider(
      () => true,
      '**Explanation** New sign-ups do not erase churn in the original cohort. [Evidence #1]',
    );
    const result = await composer().complete(
      llm,
      'Calculate contribution and explain why churn is separate.',
      locked.content,
      evidence,
      locked,
    );
    expect(result.content.startsWith(locked.content)).toBe(true);
    expect(result.content).toContain('New sign-ups');
    expect(result.audit.calculationLocked).toBe(true);
    expect(result.audit.coverage.status).toBe('COVERED');
  });
  it('rejects generated arithmetic even if a reviewer approves it, while retaining locked results', async () => {
    const locked = {
      content: '**Software calculation**\n\nVerified contribution: 15. [Evidence #1]',
      evidenceNumbers: [1],
    };
    const llm = provider(() => true, '**Explanation** The profit is $999. [Evidence #1]');
    const result = await composer({ AI_ANSWER_REPAIR_ENABLED: false }).complete(
      llm,
      'Calculate and explain contribution.',
      locked.content,
      evidence,
      locked,
    );
    expect(result.content).not.toContain('$999');
    expect(result.content).toContain('Verified contribution: 15.');
    expect(result.audit.coverage.status).toBe('PARTIAL');
  });
  it('does not disclose internal numbers when the calculator withheld a result', async () => {
    const locked = {
      content: '**Calculation source gap.** Numerical output withheld.',
      evidenceNumbers: [],
    };
    const llm = provider(() => true, '**Explanation** The margin is 75%. [Evidence #1]');
    const result = await composer({ AI_ANSWER_REPAIR_ENABLED: false }).complete(
      llm,
      'Calculate and explain contribution.',
      locked.content,
      evidence,
      locked,
    );
    expect(result.content).toContain('Numerical output withheld');
    expect(result.content).not.toContain('75%');
  });
  it('respects no-application constraints and does not publish a malformed table', async () => {
    const result = await composer({ AI_ANSWER_REPAIR_ENABLED: false }).complete(
      provider(),
      'Explain sources; do not apply to my project. Give a table.',
      '**My recommendation** Change your business. [Evidence #1]\n\n| A | B |\n| --- | --- |\n| incomplete |',
      evidence,
    );
    expect(result.content).not.toContain('Change your business');
    expect(result.content).not.toContain('| incomplete |');
    expect(result.audit.requestPlan.forbidApplication).toBe(true);
  });
  it('does not generate or expose an unreviewed draft when evidence is absent', async () => {
    const llm = provider();
    const result = await composer().complete(
      llm,
      'Give five interview questions.',
      'Private unverified claim.',
      [],
    );
    expect(result.content).not.toContain('Private unverified claim');
    expect(result.audit.repair).toBe('NO_EVIDENCE');
    expect(llm.generateAnswer).not.toHaveBeenCalled();
  });
});
describe('safe review diagnosis and format-only recovery', () => {
  it('withholds cross-unit dependent conclusions and keeps recommendation rules atomic', async () => {
    const blocks = answerBlocks(
      '**My recommendation** Try a pilot. [Evidence #1]\n\n**Decision rule** Stop if service costs exceed the budget. [Evidence #1]',
    );
    expect(blocks).toHaveLength(1);
    const llm = provider();
    (llm.generateStructuredOutput as jest.Mock).mockResolvedValueOnce({
      data: { blocks: [{ ...decision(0), standalone: false }] },
      modelName: 'review',
      promptTokens: 1,
      completionTokens: 1,
    });
    const result = await reviewSourceAnswer(
      llm,
      'Recommend a pilot for my business.',
      blocks[0]!.markdown,
      evidence,
      { structuralBlocks: blocks },
    );
    expect(result.audit.status).toBe('WITHHELD');
    expect(result.content).not.toContain('Try a pilot');
  });
  it('aborts review at the shared deadline without starting a repair', async () => {
    const llm = provider();
    (llm.generateStructuredOutput as jest.Mock).mockImplementation(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          if (signal.aborted) reject(Error('deadline'));
          else signal.addEventListener('abort', () => reject(Error('deadline')), { once: true });
        }),
    );
    const result = await composer({ AI_ANSWER_BLOCK_BUDGET_MS: 10 }).complete(
      llm,
      'Explain the source.',
      'Ask about actual behavior. [Evidence #1]',
      evidence,
    );
    expect(result.audit.repair).toBe('BUDGET_EXHAUSTED');
    expect(llm.generateAnswer).not.toHaveBeenCalled();
  });
  it('recovers exactly once from schema error, preserving the failed attempt', async () => {
    const llm = provider();
    (llm.generateStructuredOutput as jest.Mock).mockResolvedValueOnce({
      data: { verdict: 'APPROVED' },
      promptTokens: 2,
      completionTokens: 1,
    });
    const draft = 'Ask about recent actual behavior. [Evidence #1]';
    const result = await reviewSourceAnswer(llm, 'Explain the source.', draft, evidence, {
      structuralBlocks: answerBlocks(draft),
      recoverFormat: true,
    });
    expect(result.audit.status).toBe('APPROVED');
    expect(result.audit.formatAttempts?.[0]?.failureCode).toBe('REVIEW_SCHEMA_INVALID');
    expect(llm.generateStructuredOutput).toHaveBeenCalledTimes(2);
  });
  it('distinguishes missing IDs, truncation and oversized review without coverage repair', async () => {
    const llm = provider();
    (llm.generateStructuredOutput as jest.Mock).mockResolvedValueOnce({
      data: { blocks: [] },
      promptTokens: 2,
      completionTokens: 1,
    });
    const result = await composer().complete(
      llm,
      'Explain the source.',
      'A supported source statement. [Evidence #1]',
      evidence,
    );
    expect(result.audit.attempts[0]?.review.failureCode).toBe('REVIEW_COVERAGE_INVALID');
    expect(llm.generateAnswer).not.toHaveBeenCalled();
    const truncated = provider();
    (truncated.generateStructuredOutput as jest.Mock).mockRejectedValue(
      new ServiceUnavailableException({ code: 'AI_OUTPUT_TRUNCATED' }),
    );
    expect(
      (
        await reviewSourceAnswer(truncated, 'Explain.', 'A source statement.', evidence, {
          recoverFormat: true,
        })
      ).audit.failureCode,
    ).toBe('REVIEW_OUTPUT_TRUNCATED');
    expect(truncated.generateStructuredOutput).toHaveBeenCalledTimes(1);
    expect(
      (await reviewSourceAnswer(llm, 'Explain.', 'x'.repeat(24001), evidence)).audit.failureCode,
    ).toBe('REVIEW_LIMIT_EXCEEDED');
  });
});
