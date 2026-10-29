import { z } from 'zod';

const count = z.number().int().nonnegative();
export const knowledgeGraphSchema = z.object({
  ready: z.boolean(),
  method: z.string().max(80),
  built_at: z.string().max(80).optional(),
  notice: z.string().max(1000).optional(),
  summary: z.object({
    eligible_sources: count.optional(),
    matched_sources: count.optional(),
    offset: count.optional(),
    mapped_sources: count.optional(),
    unmapped_sources: count.optional(),
    displayed_sources: count.optional(),
    limited: z.boolean().optional(),
  }),
  topics: z
    .array(
      z.object({
        id: z.string().max(80),
        label: z.string().max(160),
        domain: z.string().max(80),
        sources: count,
        passages: count,
      }),
    )
    .max(64),
  sources: z
    .array(
      z.object({
        id: z.string().uuid(),
        title: z.string().max(500),
        author: z.string().max(300).nullable(),
        passages: count,
        sample: z
          .object({ chunk_id: z.string().uuid(), document_id: z.string().uuid(), revision: count })
          .nullable()
          .optional(),
      }),
    )
    .max(40),
  edges: z
    .array(
      z.object({
        source_id: z.string().uuid(),
        topic_id: z.string().max(80),
        relation: z.literal('mentions'),
        method: z.string().max(80),
        chunk_id: z.string().uuid(),
        document_id: z.string().uuid(),
        revision: count,
        page_start: count.nullable(),
        page_end: count.nullable(),
        locator: z.string().max(2000).nullable(),
        anchor: z.string().max(1000),
        text_sha256: z.string().regex(/^[a-f0-9]{64}$/),
        collection_id: z.string().max(100),
      }),
    )
    .max(1280),
  related_topics: z
    .array(
      z.object({
        source: z.string().max(80),
        target: z.string().max(80),
        relation: z.literal('related_topic_hint'),
      }),
    )
    .max(100),
});
