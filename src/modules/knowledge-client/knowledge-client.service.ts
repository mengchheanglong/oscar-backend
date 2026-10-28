import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { AssistantEvidence } from './knowledge-evidence';
import { referenceQueryPlan } from './knowledge-query-plan';

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
  text: z.string().max(3000),
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
  ): Promise<{ evidence: AssistantEvidence[]; unavailable: boolean }> {
    const queries = referenceQueryPlan(query);
    if (queries.length === 1 && !requireSources) return this.retrieveSingle(query, userId, scope);
    const deadline = Date.now() + this.config.get<number>('OSCAR_KNOWLEDGE_TIMEOUT_MS', 2500);
    const batches: AssistantEvidence[][] = [];
    let successful = 0;
    for (const topic of queries) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const result = await this.retrieveSingle(topic, userId, scope, remaining, 12);
      if (!result.unavailable) successful++;
      // Soft ordering only: introductory text is not automatically invalid evidence.
      batches.push(result.evidence.sort((a, b) => this.navigationRisk(a) - this.navigationRisk(b)));
    }
    const evidence: AssistantEvidence[] = [];
    const seen = new Set<string>();
    const books = new Map<string, number>();
    const interleaved: AssistantEvidence[] = [];
    for (let rank = 0; rank < 12; rank++)
      for (const batch of batches) if (batch[rank]) interleaved.push(batch[rank]!);
    // Prefer explanatory passages across the whole plan, retaining stable topic
    // order among equal-risk items. This is a soft hint, not source certification.
    interleaved.sort((a, b) => this.navigationRisk(a) - this.navigationRisk(b));
    for (const item of interleaved) {
      // Strong navigation/reference signals are not teaching evidence. Keep the
      // original source untouched and available to ordinary focused retrieval.
      if (this.navigationRisk(item) >= 2) continue;
      if (seen.has(item.chunkId)) continue;
      const key = item.bookId ?? item.sourceId;
      // Focused questions can need a definition, caveat and example from one
      // book. Broad multi-topic plans retain their two-passage diversity cap.
      if ((books.get(key) ?? 0) >= (requireSources && queries.length === 1 ? 3 : 2)) continue;
      seen.add(item.chunkId);
      books.set(key, (books.get(key) ?? 0) + 1);
      evidence.push(item);
      if (evidence.length === 8) return { evidence, unavailable: false };
    }
    return { evidence, unavailable: successful === 0 };
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
        query: query.slice(0, 4000),
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
          if (size > 100000) throw new Error('KNOWLEDGE_RESPONSE_LIMIT');
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
