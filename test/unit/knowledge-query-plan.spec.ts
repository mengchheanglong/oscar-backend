import { referenceQueryPlan } from '../../src/modules/knowledge-client/knowledge-query-plan';

describe('reference query planning', () => {
  it.each([
    'lessons of doing business MBA',
    'Teach me business fundamentals',
    'What should I learn from an MBA?',
  ])('covers strategy, economics and markets for %s', (query) => {
    const plan = referenceQueryPlan(query);
    expect(plan).toHaveLength(3);
    expect(plan[0]).toContain('customer discovery');
    expect(plan[1]).toContain('contribution margin');
    expect(plan[2]).toContain('distribution');
  });
  it.each([
    'Explain WACC from my MBA finance notes',
    'Lessons from The Lean Startup about business',
    'Using High Output Management teach business principles',
    'Summarize chapter 3',
    'What are Rentify merchant revenues?',
  ])('does not replace the specific question %s', (query) =>
    expect(referenceQueryPlan(query)).toEqual([query]),
  );
});
