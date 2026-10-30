import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  HttpException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { AssistantEvidence } from './knowledge-evidence';
import {
  referenceQueryPlan,
  isBusinessReview,
  businessReviewSearches,
  requestedSynthesisTitles,
  referenceSearchText,
} from './knowledge-query-plan';
import { KnowledgeRetrievalAudit } from './knowledge-retrieval-audit';
import { knowledgeGraphSchema } from './knowledge-graph';
import {
  explanatoryPlan,
  explanatoryScore,
  selectExplanatory,
  focusExcerpt,
} from './explanatory-retrieval';

const publicUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (!url.port || url.port === '443') &&
      /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) &&
      !/(^|\.)(localhost|local|internal)$/i.test(url.hostname)
    );
  });
const evidenceSchema = z.object({
  discovery_path: z.array(z.string().max(256)).max(5).optional(),
  extraction: z.string().max(100).nullable().optional(),
  review_required: z.boolean().optional(),
  coverage_note: z.string().max(300).nullable().optional(),
  book_id: z.uuid().nullable().optional(),
  author: z.string().max(300).nullable().optional(),
  edition: z.string().max(200).nullable().optional(),
  chapter: z.string().max(1000).nullable().optional(),
  chunk_id: z.uuid(),
  document_id: z.uuid(),
  source_type: z.literal('EXTERNAL_KNOWLEDGE'),
  collection_id: z.string().max(100),
  title: z.string().max(500),
  course_code: z.string().max(100).nullable(),
  institution: z.string().max(300).nullable(),
  locator: z.string().max(1000).nullable(),
  source_url: publicUrl.nullable(),
  revision: z.number().int().positive(),
  text: z
    .string()
    .max(6000)
    .refine((value) => Array.from(value).length <= 3000),
  snippet: z.string().max(500),
  score: z.number().finite(),
  page_start: z.number().int().positive().nullable(),
  page_end: z.number().int().positive().nullable(),
  start_ms: z.number().int().nonnegative().nullable(),
  end_ms: z.number().int().nonnegative().nullable(),
  full_text_length: z.number().int().nonnegative().optional().nullable(),
  is_truncated: z.boolean().optional(),
});
const responseSchema = (limit: number) =>
  z.object({
    retrieval_mode_used: z.enum(['keyword', 'semantic', 'hybrid']),
    results: z.array(evidenceSchema).max(limit),
  });

const passageInspectResponseSchema = z.object({
  chunk_id: z.uuid(),
  document_id: z.uuid(),
  collection_id: z.string().max(100),
  title: z.string().max(500),
  book_id: z.uuid().nullable().optional(),
  author: z.string().max(300).nullable().optional(),
  edition: z.string().max(200).nullable().optional(),
  chapter: z.string().max(1000).nullable().optional(),
  locator: z.string().max(1000).nullable().optional(),
  page_start: z.number().int().positive().nullable().optional(),
  page_end: z.number().int().positive().nullable().optional(),
  start_ms: z.number().int().nonnegative().nullable().optional(),
  end_ms: z.number().int().nonnegative().nullable().optional(),
  revision: z.number().int().positive(),
  text: z.string().max(100000),
  char_count: z.number().int().nonnegative(),
  extraction: z.string().max(100).nullable().optional(),
  review_required: z.boolean().optional(),
  coverage_note: z.string().max(300).nullable().optional(),
  source_url: publicUrl.nullable().optional(),
  is_truncated: z.boolean().optional(),
});
const passageWindowResponseSchema = z.object({
  anchor_chunk_id: z.uuid(),
  document_id: z.uuid(),
  revision: z.number().int().positive(),
  passages: z
    .array(
      passageInspectResponseSchema.extend({
        relative_offset: z.number().int().min(-2).max(2),
        text_sha256: z.string().regex(/^[a-f0-9]{64}$/),
        byte_count: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(5),
  total_chars: z.number().int().nonnegative().max(16000),
  total_bytes: z.number().int().nonnegative().max(64000),
  context_limited: z.boolean(),
});

@Injectable()
export class KnowledgeClientService {
  private readonly logger = new Logger(KnowledgeClientService.name);
  constructor(private readonly config: ConfigService) {}

  policy() {
    return {
      enabled: this.config.get<boolean>('OSCAR_KNOWLEDGE_ENABLED', false),
      required: this.config.get<boolean>('OSCAR_KNOWLEDGE_REQUIRED', false),
    };
  }
  explanatoryEnabled(): boolean {
    return this.config.get<boolean>('OSCAR_KNOWLEDGE_EXPLANATORY_ENABLED', true);
  }

  private scopeHeaders(body: string, userId: string) {
    const key = this.config.get<string>('OSCAR_KNOWLEDGE_PRIVATE_SCOPE_SECRET', '');
    if (key.length < 32 || key === this.config.get<string>('OSCAR_KNOWLEDGE_SERVICE_TOKEN', ''))
      throw new Error('PRIVATE_SCOPE_NOT_CONFIGURED');
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
      JSON.stringify({
        aud: 'oscar-knowledge-private-v1',
        sub: userId,
        iat: now,
        exp: now + 30,
        body_sha256: createHash('sha256').update(body).digest('hex'),
      }),
    ).toString('base64url');
    return {
      'X-OSCAR-Private-Scope':
        payload + '.' + createHmac('sha256', key).update(payload).digest('hex'),
    };
  }

  async collections(userId: string) {
    if (!this.config.get<boolean>('OSCAR_KNOWLEDGE_ENABLED', false)) return [];
    const body = '{}';
    try {
      const response = await fetch(
        this.config.get<string>('OSCAR_KNOWLEDGE_BASE_URL', 'http://127.0.0.1:8010') +
          '/internal/v1/library/collections',
        {
          method: 'POST',
          redirect: 'error',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.get<string>('OSCAR_KNOWLEDGE_SERVICE_TOKEN', '')}`,
            ...this.scopeHeaders(body, userId),
          },
          body,
          signal: AbortSignal.timeout(2500),
        },
      );
      if (!response.ok || !response.body) return [];
      const reader = response.body.getReader();
      const parts: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 4000) throw new Error('KNOWLEDGE_CATALOG_LIMIT');
          parts.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const text = Buffer.concat(parts).toString('utf8');
      return z
        .array(
          z.object({
            id: z.enum(['personal-library', 'social-systems']),
            indexed_books: z.number().int().nonnegative(),
          }),
        )
        .max(2)
        .parse(JSON.parse(text));
    } catch {
      return [];
    }
  }

  async retrieve(
    query: string,
    userId?: string,
    scope: 'mba' | 'social-systems' | 'personal-library' | 'all' = 'mba',
    requireSources = false,
  ): Promise<{
    evidence: AssistantEvidence[];
    unavailable: boolean;
    audit?: KnowledgeRetrievalAudit;
  }> {
    if (requireSources && this.explanatoryEnabled())
      return this.retrieveExplanatory(query, userId, scope);
    if (isBusinessReview(query)) return this.retrieveBusinessReview(query, userId, scope);
    const queries = referenceQueryPlan(query);
    if (queries.length === 1 && !requireSources) return this.retrieveSingle(query, userId, scope);
    const deadline = Date.now() + this.config.get<number>('OSCAR_KNOWLEDGE_TIMEOUT_MS', 2500);
    const batches: AssistantEvidence[][] = [];
    const audit: KnowledgeRetrievalAudit = {
      version: 1,
      strategy: 'reference-plan',
      searches: [],
      selectedChunkIds: [],
      deadlineReached: false,
      followUpUsed: false,
    };
    let successful = 0;
    const namedTitles = requestedSynthesisTitles(query);
    // Resolve explicitly requested books before a broad anchor can consume the
    // entire shared deadline. Keep original indices for round-robin selection.
    const order =
      namedTitles.length > 1 ? [...queries.keys()].slice(1).concat(0) : [...queries.keys()];
    for (const [position, index] of order.entries()) {
      const topic = queries[index]!;
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const started = Date.now();
      const budget = Math.min(
        remaining,
        Math.max(1500, Math.floor(remaining / (order.length - position))),
      );
      const result = await this.retrieveSingle(topic, userId, scope, budget, 12);
      if (!result.unavailable) successful++;
      // Soft ordering only: introductory text is not automatically invalid evidence.
      batches[index] = this.promoteGraph(
        result.evidence.sort((a, b) => this.navigationRisk(a) - this.navigationRisk(b)),
      );
      audit.searches.push({
        aspect: namedTitles.length > 1 && index > 0 ? 'named-source' : 'reference',
        followUp: false,
        elapsedMs: Date.now() - started,
        unavailable: result.unavailable,
        candidateChunkIds: result.evidence.map((e) => e.chunkId),
        usableCount: batches[index]!.length,
        queryChars: topic.length,
      });
    }
    const evidence: AssistantEvidence[] = [];
    const seen = new Set<string>();
    const books = new Map<string, number>();
    const interleaved: AssistantEvidence[] = [];
    for (let rank = 0; rank < 12; rank++)
      for (const batch of batches) if (batch?.[rank]) interleaved.push(batch[rank]!);
    // Prefer explanatory passages across the whole plan, retaining stable topic
    // order among equal-risk items. This is a soft hint, not source certification.
    interleaved.sort((a, b) => this.navigationRisk(a) - this.navigationRisk(b));
    const normalize = (text: string) =>
      text
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
    const matches = (item: AssistantEvidence, title: string) => {
      const actual = normalize(item.title),
        requested = normalize(title);
      return actual === requested || actual.startsWith(requested + ' ');
    };
    // Keep a fully available named-source comparison within those sources.
    // Titles are matched only against permission-filtered candidate evidence.
    const allNamedFound =
      namedTitles.length > 1 &&
      namedTitles.every((title) =>
        interleaved.some((item) => this.navigationRisk(item) < 2 && matches(item, title)),
      );
    for (const item of interleaved) {
      if (allNamedFound && !namedTitles.some((title) => matches(item, title))) continue;
      // Strong navigation/reference signals are not teaching evidence. Keep the
      // original source untouched and available to ordinary focused retrieval.
      if (this.navigationRisk(item) >= 2) continue;
      if (seen.has(item.chunkId)) continue;
      if (item.discoveryPath?.length && evidence.filter((e) => e.discoveryPath?.length).length >= 2)
        continue;
      const key = item.bookId ?? item.sourceId;
      // Focused questions can need a definition, caveat and example from one
      // book. Broad multi-topic plans retain their two-passage diversity cap.
      if ((books.get(key) ?? 0) >= (requireSources && queries.length === 1 ? 3 : 2)) continue;
      seen.add(item.chunkId);
      books.set(key, (books.get(key) ?? 0) + 1);
      evidence.push(item);
      if (evidence.length === 8) break;
    }
    audit.selectedChunkIds = evidence.map((e) => e.chunkId);
    audit.deadlineReached = Date.now() >= deadline;
    return { evidence, unavailable: successful === 0, audit };
  }

  private async retrieveExplanatory(
    question: string,
    userId: string | undefined,
    scope: 'mba' | 'social-systems' | 'personal-library' | 'all',
  ) {
    const total = this.config.get<number>('OSCAR_KNOWLEDGE_TIMEOUT_MS', 2500);
    const deadline = Date.now() + total;
    const reserve = Math.min(4500, Math.floor(total / 4));
    const queries = explanatoryPlan(question);
    const titles = requestedSynthesisTitles(question);
    const order =
      titles.length > 1
        ? queries
            .map((_, i) => i)
            .slice(1)
            .concat(0)
        : queries.map((_, i) => i);
    const batches: AssistantEvidence[][] = queries.map(() => []);
    const audit: KnowledgeRetrievalAudit = {
      version: 1,
      strategy: 'explanatory-plan',
      searches: [],
      selectedChunkIds: [],
      deadlineReached: false,
      followUpUsed: false,
      rankingMethod: 'QUESTION_DEPTH_COVERAGE_HEURISTIC',
      candidateLimit: this.config.get<number>('OSCAR_KNOWLEDGE_CANDIDATE_LIMIT', 20),
      expansions: [],
    };
    let next = 0,
      successful = 0;
    const worker = async () => {
      while (next < order.length) {
        const index = order[next++]!;
        const remaining = deadline - reserve - Date.now();
        if (remaining <= 0) break;
        const started = Date.now();
        const result = await this.retrieveSingle(
          queries[index]!,
          userId,
          scope,
          Math.min(remaining, 16000),
          20,
        );
        if (!result.unavailable) successful++;
        batches[index] = result.evidence.filter((e) => this.navigationRisk(e) < 2);
        audit.searches.push({
          aspect: titles.length > 1 && index > 0 ? 'named-source' : 'reference',
          followUp: false,
          elapsedMs: Date.now() - started,
          unavailable: result.unavailable,
          candidateChunkIds: result.evidence.map((e) => e.chunkId),
          usableCount: batches[index]!.length,
          queryChars: queries[index]!.length,
        });
      }
    };
    await Promise.all([worker(), worker()]);
    // Fair bounded pool across searches, before question-aware depth selection.
    const pool: AssistantEvidence[] = [],
      seen = new Set<string>();
    for (let rank = 0; rank < 20 && pool.length < audit.candidateLimit!; rank++)
      for (const batch of batches) {
        const item = batch[rank];
        if (item && !seen.has(item.chunkId) && pool.length < audit.candidateLimit!) {
          seen.add(item.chunkId);
          pool.push(item);
        }
      }
    const bounded = batches.map((batch) => batch.filter((e) => seen.has(e.chunkId)));
    const normalizeTitle = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
    const leads = bounded.flatMap((batch, index) => {
      if (queries.length > 1 && index === 0) return [];
      const requestedTitle = titles.length > 1 ? titles[index - 1] : undefined;
      const eligible = batch.filter(
        (e) =>
          !requestedTitle ||
          normalizeTitle(e.title) === normalizeTitle(requestedTitle) ||
          normalizeTitle(e.title).startsWith(normalizeTitle(requestedTitle) + ' '),
      );
      const best = [...eligible].sort(
        (a, b) => explanatoryScore(queries[index]!, b) - explanatoryScore(queries[index]!, a),
      )[0];
      return best ? [best] : [];
    });
    const prioritize = (first: AssistantEvidence[], rest: AssistantEvidence[]) => {
      const ids = new Set<string>(),
        bodies = new Set<string>(),
        result: AssistantEvidence[] = [];
      for (const e of [...first, ...rest]) {
        const body = (e.text ?? e.snippet).replace(/\s+/g, ' ').trim();
        if (
          ids.has(e.chunkId) ||
          bodies.has(body) ||
          result.length >= 10 ||
          (e.discoveryPath?.length && result.filter((r) => r.discoveryPath?.length).length >= 2)
        )
          continue;
        ids.add(e.chunkId);
        bodies.add(body);
        result.push(e);
      }
      return result;
    };
    let selected = prioritize(leads, selectExplanatory(question, bounded));
    const additions: AssistantEvidence[] = [];
    const expandedSources = new Set<string>();
    const blockedSources = new Set<string>();
    for (const anchor of selected) {
      if (!userId || audit.expansions!.length >= 2 || Date.now() >= deadline) break;
      const source = anchor.bookId ?? anchor.sourceId;
      if (expandedSources.has(source)) continue;
      expandedSources.add(source);
      const started = Date.now();
      try {
        const window = await this.inspectWindow(
          userId,
          {
            chunkId: anchor.chunkId,
            documentId: anchor.documentId ?? anchor.sourceId,
            revision: anchor.revision,
            radius: 1,
            maxChars: 12000,
            maxBytes: 48000,
          },
          Math.min(4500, deadline - Date.now()),
        );
        const ids: string[] = [];
        for (const item of window.passages) {
          ids.push(item.chunk_id);
          additions.push({
            ...anchor,
            chunkId: item.chunk_id,
            documentId: item.document_id,
            sourceId: item.document_id,
            title: item.title,
            collectionId: item.collection_id,
            bookId: item.book_id ?? undefined,
            author: item.author ?? undefined,
            edition: item.edition ?? undefined,
            sourceUrl: item.source_url ?? undefined,
            startMs: item.start_ms ?? undefined,
            endMs: item.end_ms ?? undefined,
            discoveryPath: item.relative_offset === 0 ? anchor.discoveryPath : undefined,
            revision: item.revision,
            locator: item.locator ?? 'Locator unavailable',
            pageStart: item.page_start ?? undefined,
            pageEnd: item.page_end ?? undefined,
            chapter: item.chapter ?? undefined,
            extraction: item.extraction ?? undefined,
            reviewRequired: item.review_required ?? false,
            coverageNote: item.coverage_note ?? undefined,
            text: item.text,
            snippet: Array.from(item.text).slice(0, 240).join(''),
            fullTextLength: item.char_count,
            isTruncated: false,
            contextWindow: {
              anchorChunkId: anchor.chunkId,
              relativeOffset: item.relative_offset,
              sourceTextSha256: item.text_sha256,
              sourceCharCount: item.char_count,
              contextLimited: window.context_limited,
            },
          });
        }
        audit.expansions!.push({
          anchorChunkId: anchor.chunkId,
          chunkIds: ids,
          status: 'EXPANDED',
          elapsedMs: Date.now() - started,
          contextLimited: window.context_limited,
        });
      } catch (error: unknown) {
        const status = error instanceof HttpException ? error.getStatus() : undefined;
        if (status && [403, 404, 409, 410].includes(status)) blockedSources.add(source);
        audit.expansions!.push({
          anchorChunkId: anchor.chunkId,
          chunkIds: [],
          status: 'UNAVAILABLE',
          failureCode:
            status === 403
              ? 'ACCESS_DENIED'
              : status === 409
                ? 'STALE_SOURCE'
                : status === 404 || status === 410
                  ? 'SOURCE_UNAVAILABLE'
                  : status === 413
                    ? 'WINDOW_LIMIT'
                    : 'UPSTREAM_UNAVAILABLE',
          elapsedMs: Date.now() - started,
        });
      }
    }
    const replace = new Set(additions.map((e) => e.chunkId));
    selected = selectExplanatory(
      question,
      [selected.filter((e) => !replace.has(e.chunkId)), additions],
      10,
    ).sort((a, b) => explanatoryScore(question, b) - explanatoryScore(question, a));
    selected = prioritize(
      leads.map((e) => additions.find((a) => a.chunkId === e.chunkId) ?? e),
      selected,
    );
    selected = selected.filter((e) => !blockedSources.has(e.bookId ?? e.sourceId));
    audit.selectedChunkIds = selected.map((e) => e.chunkId);
    audit.candidateCount = pool.length;
    audit.deadlineReached = Date.now() >= deadline;
    return {
      evidence: selected.map((e) => focusExcerpt(question, e)),
      unavailable: successful === 0,
      audit,
    };
  }

  private async retrieveBusinessReview(
    question: string,
    userId: string | undefined,
    scope: 'mba' | 'social-systems' | 'personal-library' | 'all',
  ): Promise<{
    evidence: AssistantEvidence[];
    unavailable: boolean;
    audit: KnowledgeRetrievalAudit;
  }> {
    const deadline = Date.now() + this.config.get<number>('OSCAR_KNOWLEDGE_TIMEOUT_MS', 2500);
    const plans = businessReviewSearches(question);
    const audit: KnowledgeRetrievalAudit = {
      version: 1,
      strategy: 'business-aspects',
      searches: [],
      selectedChunkIds: [],
      deadlineReached: false,
      followUpUsed: false,
    };
    const batches: AssistantEvidence[][] = [];
    let successful = 0;
    const search = async (index: number, followUp = false) => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;
      const plan = plans[index]!;
      const started = Date.now();
      const result = await this.retrieveSingle(
        followUp ? plan.followUp : plan.query,
        userId,
        scope,
        remaining,
        12,
      );
      if (!result.unavailable) successful++;
      let usable = result.evidence.filter((e) => this.navigationRisk(e) < 2);
      usable.sort((a, b) => this.navigationRisk(a) - this.navigationRisk(b));
      usable = this.promoteGraph(usable);
      audit.searches.push({
        aspect: plan.aspect,
        followUp,
        elapsedMs: Date.now() - started,
        unavailable: result.unavailable,
        candidateChunkIds: result.evidence.map((e) => e.chunkId),
        usableCount: usable.length,
      });
      if (followUp) batches[index]!.push(...usable);
      else batches[index] = usable;
    };
    for (let i = 0; i < plans.length; i++) {
      batches[i] = [];
      await search(i);
    }
    // At most one extra search, only for an aspect with no usable evidence.
    // Zero hits is a coverage signal, not a claim that the whole library is empty.
    const missing = batches.findIndex((batch) => batch.length === 0);
    if (missing >= 0 && Date.now() < deadline) {
      audit.followUpUsed = true;
      await search(missing, true);
    }
    const evidence: AssistantEvidence[] = [];
    const seenIds = new Set<string>();
    const seenBodies = new Set<string>();
    const books = new Map<string, number>();
    // Round-robin selection preserves aspect coverage before extra depth.
    for (let rank = 0; rank < 24 && evidence.length < 12; rank++) {
      for (const batch of batches) {
        const item = batch[rank];
        if (!item || seenIds.has(item.chunkId)) continue;
        const body = createHash('sha256')
          .update((item.text ?? item.snippet).replace(/\s+/g, ' ').trim())
          .digest('hex');
        const source = item.bookId ?? item.sourceId;
        if (seenBodies.has(body) || (books.get(source) ?? 0) >= 2) continue;
        if (
          item.discoveryPath?.length &&
          evidence.filter((e) => e.discoveryPath?.length).length >= 2
        )
          continue;
        seenIds.add(item.chunkId);
        seenBodies.add(body);
        books.set(source, (books.get(source) ?? 0) + 1);
        evidence.push(item);
        if (evidence.length === 12) break;
      }
    }
    audit.deadlineReached = Date.now() >= deadline;
    audit.selectedChunkIds = evidence.map((e) => e.chunkId);
    return { evidence, unavailable: successful === 0, audit };
  }

  private promoteGraph(items: AssistantEvidence[]): AssistantEvidence[] {
    const neighbor = items.find((e) => e.discoveryPath?.length && this.navigationRisk(e) === 0);
    if (!neighbor || !items.length || neighbor === items[0]) return items;
    return [items[0]!, neighbor, ...items.slice(1).filter((e) => e.chunkId !== neighbor.chunkId)];
  }

  private navigationRisk(item: AssistantEvidence): number {
    const text = item.text ?? item.snippet;
    // Numeric rows also occur in explanatory tables. Do not mistake a table
    // with body prose/captions for a page-number index and discard definitions.
    const hasTableOrProse =
      /\btable\s+\d+(?:[-.]\d+)?\b/i.test(text) ||
      (text.match(/[A-Za-z][^.!?\n]{30,}[.!?](?:\s|$)/g) ?? []).length >= 2;
    return (
      Number(
        /learning objectives|table of contents|what.s in it for me|chapter outline|located reading evidence|glossary|faculty reviewers|contributing authors/i.test(
          text,
        ),
      ) +
      Number(text.length < 300) +
      Number(
        /(?:^|\n)\s*(?:index|references|bibliography|acknowledg[e]?ments|contents)\s*(?:\n|$)/i.test(
          text,
        ),
      ) *
        2 +
      Number((text.match(/\b(?:doi:|isbn:?)|https?:\/\//gi) ?? []).length >= 3) * 2 +
      Number(
        !hasTableOrProse &&
          (text.match(/(?:,\s*|\s{2,})\d+(?:[–-]\d+)?(?:,\s*\d+)*\s*$/gm) ?? []).length >= 6,
      ) *
        2 +
      Number(
        !hasTableOrProse &&
          (text.match(/^\s*\d+\s*$/gm) ?? []).length >= 6 &&
          (text.match(/^\s*\d+\s*$/gm) ?? []).length / text.split('\n').length >= 0.2,
      ) *
        2
    );
  }

  private async retrieveSingle(
    query: string,
    userId?: string,
    scope: 'mba' | 'social-systems' | 'personal-library' | 'all' = 'mba',
    timeoutMs = this.config.get<number>('OSCAR_KNOWLEDGE_TIMEOUT_MS', 2500),
    topK = 4,
  ): Promise<{ evidence: AssistantEvidence[]; unavailable: boolean }> {
    if (!this.config.get<boolean>('OSCAR_KNOWLEDGE_ENABLED', false))
      return { evidence: [], unavailable: true };
    try {
      const collection =
        scope === 'mba'
          ? this.config.get<string>('OSCAR_KNOWLEDGE_COLLECTION', 'mba-business')
          : scope;
      const collections =
        scope === 'all'
          ? [
              this.config.get<string>('OSCAR_KNOWLEDGE_COLLECTION', 'mba-business'),
              'personal-library',
              'social-systems',
            ]
          : [collection];
      const body = JSON.stringify({
        query: referenceSearchText(query).slice(0, 4000),
        collection_ids: collections,
        top_k: topK,
        mode: 'hybrid',
      });
      if (scope !== 'mba' && !userId) throw new Error('PRIVATE_USER_REQUIRED');
      const response = await fetch(
        this.config.get<string>('OSCAR_KNOWLEDGE_BASE_URL', 'http://127.0.0.1:8010') +
          '/internal/v1/retrieve',
        {
          method: 'POST',
          redirect: 'error',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.get<string>('OSCAR_KNOWLEDGE_SERVICE_TOKEN', '')}`,
            ...(scope !== 'mba' ? this.scopeHeaders(body, userId!) : {}),
          },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
      if (!response.ok || !response.body) throw new Error('KNOWLEDGE_HTTP_ERROR');
      const reader = response.body.getReader();
      const parts: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > (topK > 12 ? 400000 : 100000)) throw new Error('KNOWLEDGE_RESPONSE_LIMIT');
          parts.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const data = responseSchema(topK).parse(JSON.parse(Buffer.concat(parts).toString('utf8')));
      if (
        data.results.some((item) => !collections.includes(item.collection_id)) ||
        new Set(data.results.map((item) => item.chunk_id)).size !== data.results.length
      )
        throw new Error('KNOWLEDGE_SCOPE_MISMATCH');
      return {
        unavailable: false,
        evidence: data.results.map((item) => ({
          chunkId: item.chunk_id,
          sourceId: item.document_id,
          documentId: item.document_id,
          sourceType: 'EXTERNAL_KNOWLEDGE',
          ...(item.discovery_path?.length ? { discoveryPath: item.discovery_path } : {}),
          collectionId: item.collection_id,
          title: item.title,
          bookId: item.book_id ?? undefined,
          author: item.author ?? undefined,
          edition: item.edition ?? undefined,
          chapter: item.chapter ?? undefined,
          extraction: item.extraction ?? undefined,
          reviewRequired: item.review_required ?? false,
          coverageNote: item.coverage_note ?? undefined,
          revision: item.revision,
          locator: item.locator ?? 'Locator unavailable',
          text: item.text,
          snippet: item.snippet,
          score: item.score,
          sourceUrl: item.source_url ?? undefined,
          courseCode: item.course_code ?? undefined,
          institution: item.institution ?? undefined,
          pageStart: item.page_start ?? undefined,
          pageEnd: item.page_end ?? undefined,
          startMs: item.start_ms ?? undefined,
          endMs: item.end_ms ?? undefined,
          fullTextLength: item.full_text_length ?? undefined,
          isTruncated: item.is_truncated ?? false,
        })),
      };
    } catch {
      this.logger.warn('KNOWLEDGE_UNAVAILABLE');
      return { evidence: [], unavailable: true };
    }
  }

  async graph(
    userId: string,
    params: {
      query?: string;
      topicId?: string;
      sourceId?: string;
      limit?: number;
      offset?: number;
    },
  ) {
    if (!this.config.get<boolean>('OSCAR_KNOWLEDGE_ENABLED', false))
      throw new ServiceUnavailableException('KNOWLEDGE_SERVICE_DISABLED');
    const body = JSON.stringify({
      collection_ids: [
        this.config.get<string>('OSCAR_KNOWLEDGE_COLLECTION', 'mba-business'),
        'personal-library',
        'social-systems',
      ],
      query: params.query ?? '',
      topic_id: params.topicId ?? null,
      source_id: params.sourceId ?? null,
      limit: params.limit ?? 20,
      offset: params.offset ?? 0,
    });
    try {
      const response = await fetch(
        this.config.get<string>('OSCAR_KNOWLEDGE_BASE_URL', 'http://127.0.0.1:8010') +
          '/internal/v1/graph',
        {
          method: 'POST',
          redirect: 'error',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.get<string>('OSCAR_KNOWLEDGE_SERVICE_TOKEN', '')}`,
            ...this.scopeHeaders(body, userId),
          },
          body,
          signal: AbortSignal.timeout(25000),
        },
      );
      if (!response.ok || !response.body) throw new Error('GRAPH_UNAVAILABLE');
      const reader = response.body.getReader();
      const parts: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 1500000) throw new Error('GRAPH_RESPONSE_LIMIT');
          parts.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const graph = knowledgeGraphSchema.parse(JSON.parse(Buffer.concat(parts).toString('utf8')));
      const collections = JSON.parse(body).collection_ids as string[];
      const sources = new Set(graph.sources.map((s) => s.id));
      const topics = new Set(graph.topics.map((t) => t.id));
      if (
        graph.edges.some(
          (e) =>
            !collections.includes(e.collection_id) ||
            !sources.has(e.source_id) ||
            !topics.has(e.topic_id),
        )
      )
        throw new Error('GRAPH_SCOPE_MISMATCH');
      return graph;
    } catch {
      throw new ServiceUnavailableException('KNOWLEDGE_GRAPH_UNAVAILABLE');
    }
  }

  async passageWindow(
    userId: string,
    params: {
      chunkId: string;
      documentId: string;
      revision: number;
      radius?: number;
      maxChars?: number;
      maxBytes?: number;
    },
  ) {
    const window = await this.inspectWindow(userId, params);
    return {
      anchorChunkId: window.anchor_chunk_id,
      documentId: window.document_id,
      revision: window.revision,
      totalChars: window.total_chars,
      totalBytes: window.total_bytes,
      contextLimited: window.context_limited,
      passages: window.passages.map((p) => ({
        chunkId: p.chunk_id,
        documentId: p.document_id,
        collectionId: p.collection_id,
        title: p.title,
        bookId: p.book_id ?? undefined,
        author: p.author ?? undefined,
        edition: p.edition ?? undefined,
        chapter: p.chapter ?? undefined,
        locator: p.locator ?? undefined,
        pageStart: p.page_start ?? undefined,
        pageEnd: p.page_end ?? undefined,
        startMs: p.start_ms ?? undefined,
        endMs: p.end_ms ?? undefined,
        revision: p.revision,
        text: p.text,
        charCount: p.char_count,
        extraction: p.extraction ?? undefined,
        reviewRequired: p.review_required ?? false,
        coverageNote: p.coverage_note ?? undefined,
        sourceUrl: p.source_url ?? undefined,
        isTruncated: false,
        relativeOffset: p.relative_offset,
        textSha256: p.text_sha256,
        byteCount: p.byte_count,
      })),
    };
  }

  async inspectWindow(
    userId: string,
    params: {
      chunkId: string;
      documentId: string;
      revision: number;
      radius?: number;
      maxChars?: number;
      maxBytes?: number;
    },
    timeoutMs = 4500,
  ) {
    if (!this.config.get<boolean>('OSCAR_KNOWLEDGE_ENABLED', false))
      throw new ServiceUnavailableException('KNOWLEDGE_SERVICE_DISABLED');
    const body = JSON.stringify({
      chunk_id: params.chunkId,
      document_id: params.documentId,
      revision: params.revision,
      radius: params.radius ?? 1,
      max_chars: params.maxChars ?? 12000,
      max_bytes: params.maxBytes ?? 48000,
    });
    const response = await fetch(
      this.config.get<string>('OSCAR_KNOWLEDGE_BASE_URL', 'http://127.0.0.1:8010') +
        '/internal/v1/passage/window',
      {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.get<string>('OSCAR_KNOWLEDGE_SERVICE_TOKEN', '')}`,
          ...this.scopeHeaders(body, userId),
        },
        body,
        signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
      },
    );
    if (response.status === 403) throw new ForbiddenException('KNOWLEDGE_ACCESS_DENIED');
    if (response.status === 404) throw new NotFoundException('KNOWLEDGE_PASSAGE_NOT_FOUND');
    if (response.status === 409) throw new ConflictException('KNOWLEDGE_STALE_REVISION');
    if (response.status === 410) throw new GoneException('KNOWLEDGE_PASSAGE_UNAVAILABLE');
    if (response.status === 413) throw new PayloadTooLargeException('KNOWLEDGE_WINDOW_LIMIT');
    if (!response.ok || !response.body)
      throw new ServiceUnavailableException('KNOWLEDGE_WINDOW_UNAVAILABLE');
    const reader = response.body.getReader(),
      parts: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 100000) throw new Error('WINDOW_RESPONSE_LIMIT');
        parts.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const data = passageWindowResponseSchema.parse(
      JSON.parse(Buffer.concat(parts).toString('utf8')),
    );
    const anchor = data.passages.find((p) => p.chunk_id === params.chunkId);
    if (
      data.anchor_chunk_id !== params.chunkId ||
      data.document_id !== params.documentId ||
      data.revision !== params.revision ||
      !anchor ||
      anchor.relative_offset !== 0 ||
      new Set(data.passages.map((p) => p.chunk_id)).size !== data.passages.length ||
      new Set(data.passages.map((p) => p.relative_offset)).size !== data.passages.length ||
      data.passages.length > (params.radius ?? 1) * 2 + 1 ||
      data.total_chars > (params.maxChars ?? 12000) ||
      data.total_bytes > (params.maxBytes ?? 48000) ||
      data.total_chars !== data.passages.reduce((n, p) => n + p.char_count, 0) ||
      data.total_bytes !== data.passages.reduce((n, p) => n + p.byte_count, 0) ||
      data.passages.some(
        (p) =>
          p.document_id !== params.documentId ||
          p.revision !== params.revision ||
          p.collection_id !== anchor.collection_id ||
          p.book_id !== anchor.book_id ||
          Math.abs(p.relative_offset) > (params.radius ?? 1) ||
          p.char_count !== Array.from(p.text).length ||
          p.byte_count !== Buffer.byteLength(p.text) ||
          p.text_sha256 !== createHash('sha256').update(p.text).digest('hex') ||
          p.is_truncated,
      )
    )
      throw new ServiceUnavailableException('KNOWLEDGE_WINDOW_MISMATCH');
    return data;
  }

  async inspectPassage(
    userId: string,
    params: { chunkId: string; documentId: string; revision: number },
  ) {
    if (!this.config.get<boolean>('OSCAR_KNOWLEDGE_ENABLED', false)) {
      throw new ServiceUnavailableException('KNOWLEDGE_SERVICE_DISABLED');
    }
    const body = JSON.stringify({
      chunk_id: params.chunkId,
      document_id: params.documentId,
      revision: params.revision,
    });
    const url =
      this.config.get<string>('OSCAR_KNOWLEDGE_BASE_URL', 'http://127.0.0.1:8010') +
      '/internal/v1/passage';
    try {
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.get<string>('OSCAR_KNOWLEDGE_SERVICE_TOKEN', '')}`,
          ...this.scopeHeaders(body, userId),
        },
        body,
        signal: AbortSignal.timeout(5000),
      });

      if (response.status === 401) throw new UnauthorizedException('KNOWLEDGE_AUTH_FAILED');
      if (response.status === 403) throw new ForbiddenException('KNOWLEDGE_ACCESS_DENIED');
      if (response.status === 404) throw new NotFoundException('KNOWLEDGE_PASSAGE_NOT_FOUND');
      if (response.status === 409) throw new ConflictException('KNOWLEDGE_STALE_REVISION');
      if (response.status === 410) throw new GoneException('KNOWLEDGE_PASSAGE_UNAVAILABLE');
      if (!response.ok) throw new ServiceUnavailableException('KNOWLEDGE_UNAVAILABLE');

      if (!response.body) throw new Error('PASSAGE_BODY_MISSING');
      const reader = response.body.getReader();
      const parts: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 100000) throw new Error('PASSAGE_RESPONSE_LIMIT');
          parts.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const parsed = passageInspectResponseSchema.parse(
        JSON.parse(Buffer.concat(parts).toString('utf8')),
      );
      if (
        parsed.chunk_id !== params.chunkId ||
        parsed.document_id !== params.documentId ||
        parsed.revision !== params.revision ||
        parsed.char_count !== Array.from(parsed.text).length
      )
        throw new Error('PASSAGE_RESPONSE_MISMATCH');
      return {
        chunkId: parsed.chunk_id,
        documentId: parsed.document_id,
        collectionId: parsed.collection_id,
        title: parsed.title,
        bookId: parsed.book_id ?? undefined,
        author: parsed.author ?? undefined,
        edition: parsed.edition ?? undefined,
        chapter: parsed.chapter ?? undefined,
        locator: parsed.locator ?? undefined,
        pageStart: parsed.page_start ?? undefined,
        pageEnd: parsed.page_end ?? undefined,
        startMs: parsed.start_ms ?? undefined,
        endMs: parsed.end_ms ?? undefined,
        revision: parsed.revision,
        text: parsed.text,
        charCount: parsed.char_count,
        extraction: parsed.extraction ?? undefined,
        reviewRequired: parsed.review_required ?? false,
        coverageNote: parsed.coverage_note ?? undefined,
        sourceUrl: parsed.source_url ?? undefined,
        isTruncated: parsed.is_truncated ?? false,
      };
    } catch (err) {
      if (
        err instanceof UnauthorizedException ||
        err instanceof ForbiddenException ||
        err instanceof GoneException ||
        err instanceof NotFoundException ||
        err instanceof ConflictException ||
        err instanceof ServiceUnavailableException
      ) {
        throw err;
      }
      this.logger.warn('KNOWLEDGE_PASSAGE_INSPECT_FAILED');
      throw new ServiceUnavailableException('KNOWLEDGE_UNAVAILABLE');
    }
  }
}
