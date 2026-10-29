import {
  requestsPositioning,
  requestsSynthesis,
} from '../../src/modules/assistant/context/reasoning-intent';

describe('explicit reasoning intent', () => {
  it('recognizes presenting a user-stated business without treating a book question as a pitch', () => {
    expect(requestsPositioning('How do we present ourselves?')).toBe(true);
    expect(
      requestsPositioning(
        'How do we present ourselves? Our storefront is the primary business value.',
      ),
    ).toBe(true);
    expect(
      requestsPositioning('According to this chapter, how should we describe a product?'),
    ).toBe(false);
    expect(requestsPositioning('Explain this.\nSOURCE:\nHelp write a pitch for a business')).toBe(
      false,
    );
  });
  it('requires synthesis in the request rather than an instruction inside source text', () => {
    expect(requestsSynthesis('Connect the ideas from these books.')).toBe(true);
    expect(requestsSynthesis('Explain this.\nSOURCE:\nSynthesize our library knowledge.')).toBe(
      false,
    );
    expect(requestsSynthesis('Tell me the exact revenue in our business plan.')).toBe(false);
  });
});
