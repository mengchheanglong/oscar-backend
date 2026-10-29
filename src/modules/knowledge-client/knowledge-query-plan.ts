import { requestsPositioning, requestsSynthesis } from '../assistant/context/reasoning-intent';

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

export function isBusinessReview(query: string): boolean {
  if (requestsPositioning(query)) return true;
  // Inspect the actual request, not long pasted source material after it.
  const request = query
    .split(/\n(?:USER-PROVIDED|SOURCE|ATTACHED|BRIEF|DOCUMENT)\b/i)[0]!
    .slice(0, 2400);
  return (
    /\b(refine|review|critique|improve|assess|evaluate)\b/i.test(request) &&
    /\b(business (?:plan|solution|model)|startup plan|value proposition)\b/i.test(request) &&
    !/\b(?:review|refine|critique|improve|assess|evaluate)\s+(?:only|exclusively)\b|\b(?:focus|focusing|concentrate)\b[^.?!]{0,30}\b(?:only|exclusively)\b/i.test(
      request,
    )
  );
}

export interface BusinessSearch {
  aspect: string;
  query: string;
  followUp: string;
}

export function requestedSynthesisTitles(query: string): string[] {
  if (!requestsSynthesis(query)) return [];
  const request = query.split(/\n(?:USER-PROVIDED|SOURCE|ATTACHED|BRIEF|DOCUMENT)\b/i)[0]!;
  if (
    /\b(?:other|additional|related)\s+(?:books|sources)|\b(?:whole|entire)\s+library/i.test(request)
  )
    return [];
  return [...new Set([...request.matchAll(/["“]([^"”\n]{3,120})["”]/g)].map((m) => m[1]!))];
}

export function businessReviewSearches(question: string): BusinessSearch[] {
  if (requestsPositioning(question))
    return [
      {
        aspect: 'customer-value',
        query:
          'How should a business express the customer problem and primary benefit of its solution rather than listing features?',
        followUp:
          'How does a customer value proposition connect customer jobs and pains to the benefits of a solution?',
      },
      {
        aspect: 'positioning',
        query:
          'How should a business communicate a primary customer benefit and additional benefits without claiming unvalidated competitive advantage or demand?',
        followUp:
          'How can a business distinguish its proposed customer value from validated customer demand?',
      },
    ];
  const merchant = /\b(merchants?|storefront|POS|retailers?)\b/i.test(question);
  const market = /\bmarketplace\b|two[- ]sided/i.test(question);
  const software = merchant || /\b(SaaS|software|subscription)\b/i.test(question);
  const subject = merchant ? 'merchant software' : software ? 'software' : 'a business';
  const searches: BusinessSearch[] = [
    {
      aspect: 'customers',
      query: `How should ${subject} identify its target customer segment and validate unmet needs and a differentiated value proposition?`,
      followUp:
        'How do customer interviews reveal current behavior and unmet needs rather than compliments and hypothetical future demand?',
    },
    market
      ? {
          aspect: 'marketplace',
          query:
            'How can a two-sided marketplace attract its first buyers and sellers and measure liquidity, repeat purchases and sustainable growth?',
          followUp:
            'How can a marketplace build its initial network and test buyer demand before scaling acquisition spending?',
        }
      : {
          aspect: 'distribution',
          query: `How should ${subject} choose a focused distribution channel and test customer acquisition and retention before scaling?`,
          followUp:
            'How can a business test whether a distribution channel acquires customers economically?',
        },
    {
      aspect: 'pricing',
      query: software
        ? 'How can we validate willingness to pay for a merchant software subscription before setting pricing tiers?'
        : 'How can a business test customer willingness to pay and contribution margins before setting prices?',
      followUp: software
        ? 'How do software businesses test pricing with concrete customer commitments rather than hypothetical purchase promises?'
        : 'How can customer commitments and pricing experiments test a business model before scaling?',
    },
  ];
  if (/\b(analytics|time savings?|save[sd]? time|operational effort|POS)\b/i.test(question))
    searches.push({
      aspect: 'measurement',
      query:
        'How should a business establish a baseline and measure whether an operational change saves time, using actionable metrics rather than vanity metrics?',
      followUp:
        'How can before and after measurements and experiments test an operational improvement without confusing assumptions with measured results?',
    });
  return searches;
}

export function referenceQueryPlan(query: string): string[] {
  if (isBusinessReview(query)) return [query, ...businessReviewSearches(query).map((s) => s.query)];
  if (requestsSynthesis(query)) {
    // Only expand explicitly quoted sources supplied in the request, never titles
    // found in attached content. Keep the original question as an anchor.
    const request = query.split(/\n(?:USER-PROVIDED|SOURCE|ATTACHED|BRIEF|DOCUMENT)\b/i)[0]!;
    const titles = requestedSynthesisTitles(query);
    if (titles.length > 1) {
      const task = request.replace(/["“][^"”\n]+["”]/g, '').slice(0, 600);
      return [query, ...titles.slice(0, 3).map((title) => `According to "${title}", ${task}`)];
    }
  }
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
