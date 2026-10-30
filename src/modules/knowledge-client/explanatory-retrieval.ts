import { AssistantEvidence } from './knowledge-evidence';
import {
  referenceQueryPlan,
  requestedSynthesisTitles,
  businessReviewSearches,
  isBusinessReview,
} from './knowledge-query-plan';

const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}]{3,}/gu) ?? []);
export function explanatoryPlan(question: string): string[] {
  const request = question.split(/\n(?:SOURCE|USER-PROVIDED|ATTACHED|BRIEF|DOCUMENT)\b/i)[0]!;
  if (requestedSynthesisTitles(request).length > 1) return referenceQueryPlan(request).slice(0, 4);
  if (isBusinessReview(request))
    return [
      request,
      ...businessReviewSearches(request)
        .slice(0, 3)
        .map((p) => p.query),
    ];
  const listed = (
    /\b(?:explain|define|compare)\s+([^?!.\n]+)/i.exec(request)?.[1] ??
    /\b(?:comparison table (?:of|for)|table comparing)\s+([^?!.\n]+)/i.exec(request)?.[1]
  )?.split(/\band why\b|:\s/)[0];
  const concepts =
    listed
      ?.split(/,\s*|\s+and\s+/i)
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  if (
    concepts.length >= 2 &&
    concepts.length <= 6 &&
    concepts.every((c) => c.length < 85 && c.split(/\s+/).length < 10)
  )
    return [
      request,
      ...concepts
        .slice(-3)
        .map((c) => `Explain the definition, mechanism and qualifications of ${c}.`),
    ];
  if (
    /\b(?:calculate|compute|break[- ]?even)\b/i.test(request) &&
    /\b(?:variable cost|fixed costs?|contribution)\b/i.test(request)
  )
    return [
      request,
      'Explain contribution margin as selling price minus total variable cost and the profit equation for zero-profit break-even and target profit.',
    ];
  return referenceQueryPlan(request).slice(0, 4);
}

export function explanatoryScore(question: string, item: AssistantEvidence): number {
  const body = item.text ?? item.snippet;
  const requested = words(
    question.replace(
      /\b(?:hypothetical|calculate|explain|under|words|using|source|sources)\b/gi,
      '',
    ),
  );
  const present = words(body + ' ' + item.title);
  const relevance =
    [...requested].filter((w) => present.has(w)).length / Math.max(1, requested.size);
  const exercise = (
    body.match(/\b(?:required|exercises?|problems?|calculate|assume|multiple choice)\b/gi) ?? []
  ).length;
  const explanation = (
    body.match(
      /\b(?:defined as|refers to|means that|because|therefore|is the|equals|in contrast|however|provided that|assumptions?)\b/gi,
    ) ?? []
  ).length;
  const navigation =
    /(?:^|\n)\s*(?:table of contents|bibliography|references|index)\s*(?:\n|$)/i.test(body);
  return (
    relevance * 8 +
    Math.min(explanation, 8) * 0.45 -
    Math.min(exercise, 10) * 0.25 -
    Number(navigation) * 5 -
    Number(item.reviewRequired === true) * 2
  );
}

export function selectExplanatory(
  question: string,
  batches: AssistantEvidence[][],
  limit = 10,
): AssistantEvidence[] {
  const selected: AssistantEvidence[] = [],
    ids = new Set<string>(),
    bodies = new Set<string>();
  const ranked = batches.map((batch) =>
    [...batch].sort((a, b) => explanatoryScore(question, b) - explanatoryScore(question, a)),
  );
  const add = (item: AssistantEvidence) => {
    const body = (item.text ?? item.snippet).replace(/\s+/g, ' ').trim();
    if (ids.has(item.chunkId) || bodies.has(body) || selected.length >= limit) return;
    if (item.discoveryPath?.length && selected.filter((e) => e.discoveryPath?.length).length >= 2)
      return;
    ids.add(item.chunkId);
    bodies.add(body);
    selected.push(item);
  };
  // Keep a relevant lead from every requested aspect before extra depth.
  for (const batch of ranked) if (batch[0]) add(batch[0]);
  const pool = ranked
    .flat()
    .sort((a, b) => explanatoryScore(question, b) - explanatoryScore(question, a));
  for (const item of pool) {
    const sameSource = selected.filter(
      (e) => (e.bookId ?? e.sourceId) === (item.bookId ?? item.sourceId),
    ).length;
    if (sameSource < 3) add(item);
  }
  // Diversity is a soft constraint: depth is useful when only one source fits.
  for (const item of pool) add(item);
  return selected;
}

export function focusExcerpt(
  question: string,
  item: AssistantEvidence,
  limit = 2400,
): AssistantEvidence {
  const points = Array.from(item.text ?? item.snippet);
  if (points.length <= limit)
    return { ...item, sourceSpan: { startChar: 0, endChar: points.length } };
  let start = 0,
    best = -Infinity;
  for (let offset = 0; offset < points.length; offset += 900) {
    const position = Math.min(offset, points.length - limit);
    const score = explanatoryScore(question, {
      ...item,
      text: points.slice(position, position + limit).join(''),
    });
    if (score > best) {
      best = score;
      start = position;
    }
  }
  const prefix = points.slice(Math.max(0, start - 180), start);
  const newline = prefix.lastIndexOf('\n');
  if (newline >= 0) start -= prefix.length - newline - 1;
  const text = points.slice(start, start + limit).join('');
  return {
    ...item,
    text,
    snippet: Array.from(text).slice(0, 240).join(''),
    fullTextLength: item.fullTextLength ?? points.length,
    isTruncated: true,
    sourceSpan: { startChar: start, endChar: start + Array.from(text).length },
  };
}
