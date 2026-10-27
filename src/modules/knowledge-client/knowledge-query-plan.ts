// Retrieval hints, not claims about the library's contents or coverage.
// Specific subjects precede umbrella subjects when both are mentioned.
const SUBJECTS: { match: RegExp; topics: [string, string]; umbrella?: boolean }[] = [
  {
    match: /\b(psychology|human behaviou?r|cognitive science)\b/i,
    topics: [
      'psychology classical operant conditioning memory encoding retrieval',
      'psychology social influence conformity attribution cognitive biases',
    ],
  },
  {
    match: /\b(social systems?|society|sociology|political science|power)\b/i,
    topics: [
      'social systems institutions power authority collective action',
      'society social norms inequality cooperation incentives systems feedback',
    ],
  },
  {
    match: /\b(leadership|management|execution)\b/i,
    topics: [
      'management delegation team motivation task relevant maturity',
      'manager output one on one meetings feedback performance leverage',
    ],
  },
  {
    match: /\b(product|growth|marketing)\b/i,
    topics: [
      'product customer discovery market segmentation value proposition',
      'product growth experiments retention distribution pricing adoption',
    ],
  },
  {
    match: /\b(decision[- ]making|decisions?|strategy)\b/i,
    topics: [
      'decision making uncertainty probabilities cognitive biases trade offs',
      'strategy competitive advantage resource allocation feedback learning',
    ],
  },
  {
    match: /\b(finance|investing|accounting)\b/i,
    topics: [
      'finance cash flow financial statements contribution margin',
      'finance time value money risk return diversification valuation',
    ],
  },
  {
    match: /\b(quantitative reasoning|quantitative|statistics|mathematics|math)\b/i,
    topics: [
      'mathematics probability statistics distributions inference uncertainty',
      'quantitative reasoning mathematical models assumptions estimation correlation causation',
    ],
  },
  {
    match: /\b(communication|writing|negotiation)\b/i,
    topics: [
      'communication writing audience purpose clarity structure evidence',
      'communication listening persuasion negotiation interests feedback',
    ],
  },
  {
    match: /\b(ai|artificial intelligence|machine learning)\b/i,
    topics: [
      'artificial intelligence machine learning training generalization evaluation',
      'artificial intelligence reasoning search representation uncertainty limitations',
    ],
  },
  {
    match: /\b(software|programming|computer science)\b/i,
    topics: [
      'software engineering modularity abstraction testing maintainability technical debt',
      'software reliability faults failures fault tolerance scalability',
    ],
  },
  {
    match: /\b(physics)\b/i,
    topics: [
      'Newton second law net force mass acceleration',
      'physics waves frequency wavelength electric magnetic fields',
    ],
  },
  {
    match: /\b(engineering)\b/i,
    umbrella: true,
    topics: [
      'engineering systems design constraints models trade offs',
      'engineering reliability measurement experiments uncertainty feedback',
    ],
  },
  {
    match: /\b(economics)\b/i,
    topics: [
      'economics scarcity opportunity cost incentives supply demand',
      'economics market failure externalities institutions competition trade',
    ],
  },
  {
    match: /\b(mba|business|entrepreneurship)\b/i,
    umbrella: true,
    topics: [
      'competitive strategy customer discovery market segmentation value proposition',
      'contribution margin break even unit economics operating cash flow pricing distribution',
    ],
  },
];

export function referenceQueryPlan(query: string): string[] {
  const original = query.trim();
  const broad =
    /\b(learn\w*|teach\w*|lesson\w*|fundamentals|basics|overview|principles|introduction)\b/i.test(
      original,
    ) &&
    original.split(/\s+/).length <= 30 &&
    // Keep named-source, comparative, quantitative and focused questions intact.
    !/\b(wacc|apv|regression|cash flow|chapter|book|according|using|why|calculate|solve|debug|compare|versus|difference|specifically|only|focus|without|exclude)\b|\bfrom\s+(?!(?:an?\s+)?mba\b)|["“”]|\d/i.test(
      original,
    );
  if (!broad) return [query];

  const candidates = SUBJECTS.filter((subject) => subject.match.test(original));
  const specific = candidates.filter((subject) => !subject.umbrella);
  const matched = specific.length ? specific : candidates;
  const learningWords =
    /\b(please|can|could|would|you|i|me|my|what|how|should|want|to|learn\w*|teach\w*|lesson\w*|fundamentals|basics|overview|principles|introduction|give|an?|the|of|about|in|from|doing|and|for|beginners?|essential|key|core|practical)\b/gi;
  const clean = (text: string) =>
    text
      .replace(learningWords, ' ')
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const unmatched = clean(
    candidates.reduce(
      (text, subject) => text.replace(new RegExp(subject.match.source, 'gi'), ' '),
      original,
    ),
  );
  // The original query remains an anchor; all searches share the existing deadline.
  // Extra qualifiers use anchored generic hints rather than changing their topic.
  if (matched.length && !unmatched) {
    const topics =
      matched.length > 1 ? [matched[0]!.topics[0], matched[1]!.topics[0]] : matched[0]!.topics;
    return [query, ...topics];
  }

  // Unknown subjects keep their own words instead of being assigned MBA topics.
  const subject = clean(original);
  return subject.length >= 3
    ? [
        query,
        `${original}: core concepts explanations relationships`,
        `${original}: practical examples applications limitations`,
      ]
    : [query];
}
