import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { AssistantEvidence } from './knowledge-evidence';

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
});
const responseSchema = z.object({
  retrieval_mode_used: z.enum(['keyword', 'semantic', 'hybrid']),
  results: z.array(evidenceSchema).max(4),
});

@Injectable()
export class KnowledgeClientService {
  private readonly logger = new Logger(KnowledgeClientService.name);
  constructor(private readonly config: ConfigService) {}

  async retrieve(query: string): Promise<{ evidence: AssistantEvidence[]; unavailable: boolean }> {
    if (!this.config.get<boolean>('OSCAR_KNOWLEDGE_ENABLED', false))
      return { evidence: [], unavailable: true };
    try {
      const collection = this.config.get<string>('OSCAR_KNOWLEDGE_COLLECTION', 'mba-business');
      const response = await fetch(
        this.config.get<string>('OSCAR_KNOWLEDGE_BASE_URL', 'http://127.0.0.1:8010') +
          '/internal/v1/retrieve',
        {
          method: 'POST',
          redirect: 'error',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.get<string>('OSCAR_KNOWLEDGE_SERVICE_TOKEN', '')}`,
          },
          body: JSON.stringify({
            query: query.slice(0, 4000),
            collection_ids: [collection],
            top_k: 4,
            mode: 'hybrid',
          }),
          signal: AbortSignal.timeout(this.config.get<number>('OSCAR_KNOWLEDGE_TIMEOUT_MS', 2500)),
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
      const data = responseSchema.parse(JSON.parse(Buffer.concat(parts).toString('utf8')));
      if (
        data.results.some((item) => item.collection_id !== collection) ||
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
        })),
      };
    } catch {
      this.logger.warn('KNOWLEDGE_UNAVAILABLE');
      return { evidence: [], unavailable: true };
    }
  }
}
