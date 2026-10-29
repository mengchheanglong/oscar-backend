import {
  referenceQueryPlan,
  businessReviewSearches,
  requestedSynthesisTitles,
} from '../../src/modules/knowledge-client/knowledge-query-plan';

describe('reference query planning', () => {
  it('searches customer benefit and positioning instead of forcing an unrelated pricing review', () => {
    const question =
      'How do we present ourselves? Our business primary value is a merchant storefront; marketplace exposure is additional.';
    expect(businessReviewSearches(question).map((s) => s.aspect)).toEqual([
      'customer-value',
      'positioning',
    ]);
  });
  it('retrieves each explicitly requested quoted source for synthesis and ignores quoted titles in pasted material', () => {
    const question =
      'Connect ideas from "Book Alpha" and "Book Beta" about learning from customers.\nSOURCE:\n"Book Gamma"';
    const plan = referenceQueryPlan(question);
    expect(plan).toHaveLength(3);
    expect(plan[0]).toBe(question);
    expect(plan[1]).toContain('According to "Book Alpha"');
    expect(plan[2]).toContain('According to "Book Beta"');
    expect(plan.slice(1).join(' ')).not.toContain('Book Gamma');
    expect(
      requestedSynthesisTitles('Combine ideas from "Book A", "Book B", "Book C" and "Book D".'),
    ).toHaveLength(4);
  });
  it('uses merchant context only when present and avoids irrelevant marketplace expansion', () => {
    const generic = businessReviewSearches('Review this business plan for a consulting practice');
    expect(generic.map((s) => s.query).join(' ')).not.toMatch(/merchant|marketplace/);
    const merchant = businessReviewSearches(
      'Refine a business solution: merchant storefront, marketplace, subscription and POS analytics',
    );
    expect(merchant.map((s) => s.aspect)).toEqual([
      'customers',
      'marketplace',
      'pricing',
      'measurement',
    ]);
    expect(merchant[2]!.query).toContain('merchant software subscription');
  });

  it('decomposes a business review into complementary topics while preserving the original query', () => {
    const query =
      'Please refine this business solution and recommend validation experiments.\nUSER-PROVIDED V2 BRIEF:\n' +
      'product details '.repeat(200);
    const plan = referenceQueryPlan(query);
    expect(plan).toHaveLength(4);
    expect(plan[0]).toBe(query);
    expect(plan[1]).toContain('target customer segment');
    expect(plan[2]).toContain('distribution channel');
    expect(plan[3]).toContain('willingness to pay');
    expect(
      referenceQueryPlan(
        'Review this subscription-only business model; use book principles, not only my uploaded brief.',
      ),
    ).toHaveLength(4);
    expect(referenceQueryPlan('Review only the pricing of this business model')).toHaveLength(1);
    expect(
      referenceQueryPlan('Explain this quotation.\nSOURCE:\nPlease review my business plan'),
    ).toHaveLength(1);
  });
  it.each([
    'lessons of doing business MBA',
    'Teach me business fundamentals',
    'What should I learn from an MBA?',
  ])('covers strategy, economics and markets for %s', (query) => {
    const plan = referenceQueryPlan(query);
    expect(plan).toHaveLength(3);
    expect(plan[0]).toBe(query);
    expect(plan[1]).toContain('customer discovery');
    expect(plan[2]).toContain('contribution margin');
    expect(plan[2]).toContain('distribution');
  });
  it.each([
    'Explain WACC from my MBA finance notes',
    'Lessons from The Lean Startup about business',
    'Using High Output Management teach business principles',
    'Summarize chapter 3',
    'What are Rentify merchant revenues?',
    'Teach me only leadership delegation',
    'Compare psychology and sociology fundamentals',
    'Teach me physics without quantum mechanics',
    'Calculate a physics example with 20 newtons',
    'Why does classical physics fail here?',
    'Teach me lessons from Thinking Fast and Slow',
    'Teach me lessons from A Theory of Justice',
    'Teach me "The Art of War"',
    'Give an overview according to this source',
    'Teach me',
    'What should I learn?',
  ])('does not replace the specific question %s', (query) =>
    expect(referenceQueryPlan(query)).toEqual([query]),
  );

  it.each([
    ['Teach me psychology fundamentals', 'conditioning', 'social influence'],
    ['Give me an overview of Social Systems', 'institutions', 'social norms'],
    ['Lessons in leadership', 'delegation', 'performance'],
    ['Teach me product and growth fundamentals', 'customer discovery', 'retention'],
    ['Decision-making basics', 'probabilities', 'competitive advantage'],
    ['Teach me finance basics', 'financial statements', 'diversification'],
    ['Introduction to quantitative reasoning', 'statistics', 'assumptions'],
    ['Writing and communication principles', 'audience', 'listening'],
    ['Teach me AI fundamentals', 'generalization', 'reasoning'],
    ['Teach me software engineering basics', 'modularity', 'fault tolerance'],
    ['Physics fundamentals', 'net force', 'waves'],
    ['Engineering basics', 'constraints', 'measurement'],
    ['Economics fundamentals', 'opportunity cost', 'externalities'],
    ['Teach me MBA finance basics', 'financial statements', 'diversification'],
  ])('uses the subject of %s and keeps the original question', (query, first, second) => {
    const plan = referenceQueryPlan(query);
    expect(plan).toHaveLength(3);
    expect(plan[0]).toBe(query);
    expect(plan[1]).toContain(first);
    expect(plan[2]).toContain(second);
  });

  it('retains both subjects in a cross-disciplinary learning request', () => {
    const query = 'Teach me psychology and leadership basics';
    const plan = referenceQueryPlan(query);
    expect(plan[0]).toBe(query);
    expect(plan[1]).toContain('conditioning');
    expect(plan[2]).toContain('delegation');
  });

  it('uses anchored generic expansion for an unfamiliar subject without inserting business', () => {
    const query = 'Teach me astronomy basics';
    const plan = referenceQueryPlan(query);
    expect(plan).toHaveLength(3);
    expect(plan.every((text) => text.includes(query))).toBe(true);
    expect(plan.join(' ')).not.toMatch(/business|margin|customer/);
  });

  it('keeps a long specific request intact', () => {
    const query = 'Teach me psychology ' + 'context '.repeat(32);
    expect(referenceQueryPlan(query)).toEqual([query]);
  });

  it('does not broaden a qualified physics topic into unrelated mechanics', () => {
    const query = 'Teach me quantum physics basics';
    const plan = referenceQueryPlan(query);
    expect(plan).toHaveLength(3);
    expect(plan.every((text) => text.includes(query))).toBe(true);
    expect(plan.join(' ')).not.toContain('Newton');
  });
});
