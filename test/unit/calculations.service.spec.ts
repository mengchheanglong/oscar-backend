import { CalculationsService } from '../../src/modules/calculations/calculations.service';
import {
  numericInputs,
  bindInputs,
  calculationIntent,
} from '../../src/modules/calculations/input-bindings';
import { LlmProvider } from '../../src/modules/assistant/llm/llm-provider.interface';
import { AssistantEvidence } from '../../src/modules/knowledge-client/knowledge-evidence';
import { KnowledgeSourceType } from '../../src/modules/ingestion/entities';

const text =
  'Contribution margin is selling price minus variable cost. It covers fixed costs and profit.';
const evidence: AssistantEvidence[] = [
  {
    chunkId: 'c',
    sourceId: 's',
    sourceType: 'EXTERNAL_KNOWLEDGE',
    title: 'Synthetic accounting',
    revision: 1,
    locator: 'p1',
    snippet: text,
    text,
    score: 1,
  },
];
const question =
  'Hypothetical monthly price is $34, total variable cost $9 and fixed costs $750. Calculate break-even.';
const plan = {
  requests: [
    {
      operation: 'unit_economics',
      fields: { price: 'n0', totalVariableCost: 'n1', fixedCost: 'n2' },
      principles: [{ evidenceNumber: 1, quote: text }],
    },
  ],
};
const provider = (data: unknown) =>
  ({
    generateStructuredOutput: jest.fn().mockResolvedValue({
      data,
      modelName: 'configured-provider',
      promptTokens: 12,
      completionTokens: 8,
    }),
  }) as unknown as LlmProvider;

describe('calculation extraction boundary', () => {
  it('maps only exact current-user tokens, runs exact arithmetic and renders attributed original evidence', async () => {
    const service = new CalculationsService(),
      audit = await service.prepare(provider(plan), question, evidence);
    expect(audit?.receipts[0]?.outputs.find((o) => o.key === 'breakEvenUnits')?.value).toBe('30');
    expect(audit?.receipts[0]?.inputs.price?.quote).toBe('34');
    expect(audit?.receipts[0]?.inputStatus).toBe('HYPOTHETICAL_USER_INPUT');
    const rendered = service.render(audit!, true);
    expect(rendered.content).toContain('30 whole units');
    expect(rendered.evidenceNumbers).toEqual([1]);
    expect(rendered.content).toContain('not quotations');
  });
  it('does not accept model-invented numeric IDs, executable operations or missing cost components', async () => {
    const service = new CalculationsService();
    const bad = structuredClone(plan);
    bad.requests[0]!.fields.price = 'n79';
    expect((await service.prepare(provider(bad), question, evidence))?.status).not.toBe(
      'CALCULATED',
    );
    const injected = {
      requests: [{ operation: 'eval', fields: { code: 'process.exit()' }, principles: [] }],
    };
    expect((await service.prepare(provider(injected), question, evidence))?.status).toBe(
      'UNAVAILABLE',
    );
  });
  it('rejects swapping a fixed cost into the variable-cost role', () => {
    expect(() =>
      bindInputs(
        'unit_economics',
        { price: 'n0', totalVariableCost: 'n2', fixedCost: 'n1' },
        numericInputs(question),
        question,
      ),
    ).toThrow('UNVERIFIED_INPUT_ROLE');
  });
  it('keeps evidence gaps and unverified OCR fail closed instead of falling back to model math', async () => {
    const service = new CalculationsService(),
      audit = await service.prepare(provider(plan), question, []);
    expect(service.render(audit!, true).content).toContain('output is withheld');
    expect(service.render(audit!, true).content).not.toContain('30 whole units');
    const llm = provider(plan);
    const ambiguous = await service.prepare(
      llm,
      'Calculate using OCR price $20 and ambiguous decimal cost $5.',
      evidence,
    );
    expect(ambiguous?.status).not.toBe('CALCULATED');
    expect(llm.generateStructuredOutput).not.toHaveBeenCalled();
  });
  it('does not invoke extraction for an ordinary explanation or instructions inside a pasted source', async () => {
    const llm = provider(plan);
    expect(
      await new CalculationsService().prepare(llm, 'Explain contribution margin.', evidence),
    ).toBeUndefined();
    expect(calculationIntent('Explain this.\nSOURCE:\nCalculate $20 minus $5.')).toBe(false);
    expect(calculationIntent('Do not calculate; explain $20 versus $5.')).toBe(false);
    expect(calculationIntent('Explain break-even. Under 200 words.')).toBe(false);
    expect(
      calculationIntent(
        'Can we calculate a reliable margin? Explain missing inputs. Under 200 words.',
      ),
    ).toBe(false);
    expect(
      calculationIntent(
        'A free plan charges zero with positive costs. Can it break even? Under 200 words.',
      ),
    ).toBe(false);
    expect(llm.generateStructuredOutput).not.toHaveBeenCalled();
  });
  it('preserves labor time and hourly rate units rather than inheriting money for minutes', () => {
    const inputs = numericInputs(
      'Support takes 45 minutes at $12 per hour, plus $3 other variable costs monthly. Calculate labor cost.',
    );
    expect(inputs[0]?.unit).toBe('minute');
    expect(inputs[1]?.unit).toBe('money_per_hour');
    expect(inputs[2]?.unit).toBe('money');
  });
  it('does not substitute other-variable-cost components for the complete cost total', async () => {
    const question =
      'Calculate: support 45 minutes at $12 per hour, plus $3 other variable costs; price $20; fixed cost $600.';
    const service = new CalculationsService();
    const audit = await service.prepare(
      provider({
        requests: [
          {
            operation: 'unit_economics',
            fields: { price: 'n3', totalVariableCost: 'n2', fixedCost: 'n4' },
            principles: [],
          },
        ],
      }),
      question,
      evidence,
    );
    expect(audit?.status).toBe('NEEDS_INPUT');
    expect(audit?.failureCode).toBe('COMPONENT_IS_NOT_TOTAL_VARIABLE_COST');
    expect(audit?.receipts).toEqual([]);
  });
  it('rejects overlapping calculation requests without publishing partial outputs', async () => {
    const audit = await new CalculationsService().prepare(
      provider({ requests: [plan.requests[0], plan.requests[0]] }),
      question,
      evidence,
    );
    expect(audit?.status).toBe('NEEDS_INPUT');
    expect(audit?.failureCode).toBe('OVERLAPPING_CALCULATION_REQUESTS');
    expect(audit?.receipts).toEqual([]);
  });
  it('rejects unsupported numeric notation rather than silently changing its magnitude', () => {
    for (const amount of [
      '.5',
      '1.5k',
      '1,00',
      '25%',
      '1 000',
      'one hundred',
      '1/2',
      'twenty-five',
      'twenty five',
      'one point five',
      '5 cents',
      '25 percent',
    ])
      expect(() => numericInputs(`Calculate price $${amount}; variable cost $2.`)).toThrow(
        'UNSUPPORTED_NUMERIC_NOTATION',
      );
    expect(() => numericInputs('Calculate cost negative $5.')).toThrow(
      'UNSUPPORTED_NUMERIC_NOTATION',
    );
    expect(() => numericInputs('Calculate cost negative six dollars.')).toThrow(
      'UNSUPPORTED_NUMERIC_NOTATION',
    );
    expect(numericInputs('Calculate price $1,500.50; variable cost $2.')[0]?.value).toBe('1500.50');
  });
  it('separates provider failure from missing inputs without exposing provider errors', async () => {
    const llm = provider(plan);
    llm.generateStructuredOutput = jest.fn().mockRejectedValue(Error('PROVIDER_PRIVATE_FAILURE'));
    const service = new CalculationsService();
    const audit = await service.prepare(llm, question, evidence);
    expect(audit?.status).toBe('UNAVAILABLE');
    expect(audit?.failureCode).toBe('INPUT_EXTRACTION_UNAVAILABLE');
    expect(service.render(audit!, true).content).toContain('temporarily unavailable');
    expect(JSON.stringify(audit)).not.toContain('PROVIDER_PRIVATE_FAILURE');
  });
  it('does not bind numbers from a pasted source block and routes cohort questions consistently', () => {
    expect(
      numericInputs('Calculate our margin.\nSOURCE: book example price $20; cost $5.'),
    ).toEqual([]);
    for (let i = 0; i < 3; i++)
      expect(calculationIntent('30 merchants; six cancel. Explain gross churn.')).toBe(true);
  });
  it('does not cite fabricated quotes or unrelated project plans as accounting principles', async () => {
    const service = new CalculationsService(),
      bad = structuredClone(plan);
    bad.requests[0]!.principles[0]!.quote = 'Invented calculation quote that is not in the passage';
    const a = await service.prepare(provider(bad), question, evidence);
    expect(a?.receipts[0]?.principles).toEqual([]);
    const project = [{ ...evidence[0]!, sourceType: KnowledgeSourceType.DOCUMENT }];
    const b = await service.prepare(provider(plan), question, project);
    expect(b?.receipts[0]?.principles).toEqual([]);
  });
});
