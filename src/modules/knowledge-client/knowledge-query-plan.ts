// Broad learning requests need coverage across topics, not one nearest passage.
// Specific questions and named-source requests keep their exact original query.
export function referenceQueryPlan(query: string): string[] {
  const broad =
    /\b(mba|business|entrepreneurship)\b/i.test(query) &&
    /\b(learn\w*|teach\w*|lesson\w*|fundamentals|basics|overview|principles)\b/i.test(query) &&
    query.trim().split(/\s+/).length <= 30 &&
    !/\b(wacc|apv|accounting|regression|pricing|marketing|finance|cash flow|chapter|book|according|using)\b|\bfrom\s+the\b|["“]/i.test(
      query,
    );
  return broad
    ? [
        'competitive strategy customer discovery value proposition product market fit',
        'contribution margin break even unit economics operating cash flow working capital',
        'market segmentation target customers pricing objectives distribution channels',
      ]
    : [query];
}
