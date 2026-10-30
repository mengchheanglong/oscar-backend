import { z } from 'zod';
import { requestedSynthesisTitles } from '../../knowledge-client/knowledge-query-plan';
import { forbidsApplication } from './answer-support';
import { calculationIntent } from '../../calculations/input-bindings';
import { requestsSynthesis } from './reasoning-intent';

export const answerBlockSchema = z
  .object({
    id: z.number().int().nonnegative(),
    kind: z.enum([
      'answer',
      'explanation',
      'calculation',
      'recommendation',
      'question',
      'table',
      'limitation',
      'source-gap',
    ]),
    markdown: z.string().min(1).max(12000),
    requiredOutputTags: z.array(z.string().max(200)).max(16),
  })
  .strict();
export type AnswerBlock = z.infer<typeof answerBlockSchema>;
export interface AnswerRequestPlan {
  version: 1;
  method: 'BOUNDED_REQUEST_RULES';
  requirements: { tag: string; label: string; minimum: number }[];
  namedSources: string[];
  forbidApplication: boolean;
  calculation: boolean;
}
export interface AnswerCoverage {
  method: 'STRUCTURAL_HEURISTICS';
  status: 'COVERED' | 'PARTIAL' | 'UNANSWERED';
  requirements: {
    tag: string;
    label: string;
    minimum: number;
    retained: number;
    covered: boolean;
  }[];
}
const numberWords: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};
export function answerRequestPlan(question: string): AnswerRequestPlan {
  const request = question.split(/\n(?:USER-PROVIDED|SOURCE|ATTACHED|BRIEF|DOCUMENT)\b/i)[0]!;
  const requirements: AnswerRequestPlan['requirements'] = [
    { tag: 'answer', label: 'Direct answer', minimum: 1 },
  ];
  const count =
    /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:(?:non-leading|nonleading|open-ended|interview|merchant|customer|discovery)\s+){0,3}questions?\b/i.exec(
      request,
    );
  if (count || /\b(?:give|draft|write|prepare|create)\b[^.?!]{0,80}\bquestions?\b/i.test(request))
    requirements.push({
      tag: 'question',
      label: 'Requested questions',
      minimum: count ? Math.min(99, numberWords[count[1]!.toLowerCase()] ?? Number(count[1])) : 1,
    });
  if (
    /\b(?:give|draft|write|prepare|create|make|provide|build|show|produce|include)\b[^.?!]{0,80}\btable\b|\b(?:in|as) (?:a )?table\b/i.test(
      request,
    )
  )
    requirements.push({ tag: 'table', label: 'Complete comparison table', minimum: 1 });
  const calculation = calculationIntent(question);
  if (/\b(?:draft|write|create|prepare|give)\b[^.?!]{0,70}\bpitch\b/i.test(request))
    requirements.push({ tag: 'pitch', label: 'Proposed pitch wording', minimum: 1 });
  if (calculation)
    requirements.push({ tag: 'calculation', label: 'Verified calculation', minimum: 1 });
  if (/\b(?:explain|why|rationale|reasoning|trade[- ]offs?|assumptions)\b/i.test(request))
    requirements.push({ tag: 'explanation', label: 'Explanation and limits', minimum: 1 });
  if (
    !forbidsApplication(question) &&
    /\b(?:recommend|propose|advise|next (?:step|test|measurement)|what should|how should)\b/i.test(
      request,
    )
  )
    requirements.push({
      tag: 'recommendation',
      label: 'Proposed action and decision rule',
      minimum: 1,
    });
  if (requestsSynthesis(question))
    requirements.push({
      tag: 'synthesis',
      label: 'Source connection and conditional implication',
      minimum: 1,
    });
  return {
    version: 1,
    method: 'BOUNDED_REQUEST_RULES',
    requirements,
    namedSources: requestedSynthesisTitles(request).slice(0, 8),
    forbidApplication: forbidsApplication(question),
    calculation,
  };
}

const headingPrefix = /^(?:(?:#{1,6}\s[^\n]+|\*\*[^*\n]{1,150}\*\*[:.]?)\n)+/;
export const answerUnitBody = (markdown: string) => markdown.replace(headingPrefix, '');
export const questionBody = (markdown: string) =>
  answerUnitBody(markdown)
    .replace(/^(?:\*\*)?\d+[.)](?:\*\*)?\s+/, '')
    .replace(
      /^(?:\*\*)?(?:proposed )?question\s+\d+(?:\s*\([^)\n]{0,80}\))?(?::?\*\*:?\s*|:\s*)/i,
      '',
    )
    .replace(/^(?:\*\*)?(?:proposed )?question(?::?\*\*:?\s*|:\s*)/i, '');
export function answerBlocks(draft: string): AnswerBlock[] {
  if (draft.length > 24000) throw Error('ANSWER_LIMIT_EXCEEDED');
  const pieces = draft
    .split(/\n\s*\n|\n(?=(?:\*\*)?\d+[.)](?:\*\*)?\s)/)
    .map((s) => s.trim())
    .filter(Boolean);
  const grouped: string[] = [];
  let heading = '';
  for (const piece of pieces) {
    if (/^#{1,6}\s[^\n]+$|^\*\*[^*\n]{1,150}\*\*[:.]?$/.test(piece)) {
      heading += piece + '\n';
      continue;
    }
    const last = grouped.at(-1);
    const candidate = heading + piece;
    const namedDependency =
      /^(?:[-*]\s+)?(?:\*\*)?(?:rationale|why this|why it|purpose|decision rule|assumptions?|limitations?|continue|revise|stop)\b/i.test(
        candidate,
      );
    // A question and its following rationale remain one reviewable unit.
    if (
      last &&
      ((/^(?:\*\*)?\d+[.)](?:\*\*)?\s|^(?:\*\*)?(?:proposed )?question\s+\d+\b/i.test(
        answerUnitBody(last),
      ) &&
        ((!heading && !/^\d+[.)]\s|^\||^[-*]\s|^\*\*[^*]+\*\*/.test(piece)) || namedDependency)) ||
        (/^(?:#{1,6}\s|\*\*)?(?:my |proposed )?(?:recommendation|decision gate|formula|calculation)\b/i.test(
          last,
        ) &&
          namedDependency) ||
        (!heading && /^(?:However|But|Only if|This assumes|Provided that)\b/.test(piece)))
    )
      grouped[grouped.length - 1] += '\n\n' + candidate;
    else grouped.push(heading + piece);
    heading = '';
  }
  if (heading) grouped.push(heading.trim());
  if (grouped.length > 64) throw Error('ANSWER_LIMIT_EXCEEDED');
  return grouped.map((markdown, id) => {
    const withoutHeading = answerUnitBody(markdown);
    const kindPrefix =
      markdown
        .slice(0, markdown.length - withoutHeading.length)
        .replace(/[#*]/g, '')
        .trim() || withoutHeading;
    const kind: AnswerBlock['kind'] = /(?:^|\n)\s*\|.+\|/.test(markdown)
      ? 'table'
      : (/^(?:\*\*)?\d+[.)](?:\*\*)?\s/.test(withoutHeading) ||
            /^(?:\*\*)?(?:proposed )?question\s+\d+\b/i.test(kindPrefix)) &&
          (withoutHeading.includes('?') ||
            /\b(?:tell me|walk me|describe|show me)\b/i.test(withoutHeading))
        ? 'question'
        : /^(?:\*\*)?(?:my |proposed )?(?:recommendation|application|proposal|decision gate|next (?:test|step))/i.test(
              kindPrefix,
            )
          ? 'recommendation'
          : /^(?:\*\*)?(?:limitation|caveat|assumption)/i.test(kindPrefix)
            ? 'limitation'
            : /^(?:\*\*)?(?:source gap|missing source)/i.test(kindPrefix)
              ? 'source-gap'
              : 'explanation';
    const tags = kind === 'source-gap' ? [] : ['answer', kind];
    if (/\b(?:my synthesis|conditional implication|reasoning bridge|the bridge)\b/i.test(markdown))
      tags.push('synthesis');
    if (/(?:^|\n)(?:#{1,6}\s|\*\*)?(?:proposed )?pitch\b/i.test(markdown)) tags.push('pitch');
    if (kind === 'question' && /\?[^?]{15,}/s.test(markdown.replace(/\[Evidence #\d+\]/g, '')))
      tags.push('explanation');
    return answerBlockSchema.parse({ id, kind, markdown, requiredOutputTags: [...new Set(tags)] });
  });
}
export function validTable(markdown: string): boolean {
  const rows = markdown
    .split('\n')
    .filter((line) => /^\s*\|/.test(line))
    .map((line) => line.replace(/[ \t]+(?:\[Evidence #\d+\][ \t]*)+$/, ''));
  if (rows.length < 3) return false;
  if (rows.some((row) => !/\|\s*$/.test(row))) return false;
  const cells = (line: string) =>
    line
      .trim()
      .slice(1, -1)
      .split(/(?<!\\)\|/)
      .map((c) => c.trim());
  const width = cells(rows[0]!).length;
  return (
    width >= 2 &&
    cells(rows[1]!).every((c) => /^:?-{3,}:?$/.test(c)) &&
    rows.every((row) => cells(row).length === width)
  );
}
export function answerCoverage(
  plan: AnswerRequestPlan,
  blocks: AnswerBlock[],
  calculated: boolean,
  citedSourceTitles: string[] = [],
): AnswerCoverage {
  const substantive = blocks.filter(
    (b) =>
      b.kind !== 'source-gap' &&
      b.markdown.replace(/#[^\n]+|\[Evidence #\d+\]/g, '').trim().length > 10,
  );
  const requirements = plan.requirements.map((r) => {
    const retained =
      r.tag === 'answer'
        ? substantive.length + Number(calculated)
        : r.tag === 'calculation'
          ? Number(calculated)
          : r.tag === 'table'
            ? blocks.filter((b) => b.kind === 'table' && validTable(b.markdown)).length
            : blocks.filter((b) => b.requiredOutputTags.includes(r.tag)).length;
    return { ...r, retained, covered: retained >= r.minimum };
  });
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  for (const source of plan.namedSources)
    requirements.push({
      tag: 'source:' + source,
      label: 'Source: ' + source,
      minimum: 1,
      retained: Number(
        citedSourceTitles.some(
          (t) =>
            normalize(t) === normalize(source) || normalize(t).startsWith(normalize(source) + ' '),
        ),
      ),
      covered: citedSourceTitles.some(
        (t) =>
          normalize(t) === normalize(source) || normalize(t).startsWith(normalize(source) + ' '),
      ),
    });
  return {
    method: 'STRUCTURAL_HEURISTICS',
    status: requirements.every((r) => r.covered)
      ? 'COVERED'
      : substantive.length || calculated
        ? 'PARTIAL'
        : 'UNANSWERED',
    requirements,
  };
}
