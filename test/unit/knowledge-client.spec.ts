import { ConfigService } from '@nestjs/config';
import { createHash, createHmac } from 'node:crypto';
import { KnowledgeClientService } from '../../src/modules/knowledge-client/knowledge-client.service';
import { AssistantEvidence } from '../../src/modules/knowledge-client/knowledge-evidence';
import { ContextAssembler } from '../../src/modules/assistant/context/context-assembler';
import { AssistantMode } from '../../src/modules/assistant/entities/assistant-mode.enum';
import { DeepSeekLlmProvider } from '../../src/modules/assistant/llm/deepseek-llm-provider';
import { KnowledgeSourceType } from '../../src/modules/ingestion/entities';

const result = {
  chunk_id: 'c37c3283-30d8-4d43-99a3-2319f3bf2040',
  document_id: 'c37c3283-30d8-4d43-99a3-2319f3bf2041',
  source_type: 'EXTERNAL_KNOWLEDGE',
  collection_id: 'mba-business',
  title: 'Synthetic Pricing',
  course_code: 'DEMO',
  institution: 'Synthetic',
  locator: 'Page 2',
  source_url: 'https://example.org/lecture.pdf',
  revision: 1,
  text: 'Pricing tests willingness to pay.',
  snippet: 'Pricing tests willingness to pay.',
  score: 0.01,
  page_start: 2,
  page_end: 2,
  start_ms: null,
  end_ms: null,
};
function client(enabled = true) {
  return new KnowledgeClientService(new ConfigService({ OSCAR_KNOWLEDGE_ENABLED: enabled }));
}
describe('optional curated knowledge', () => {
  afterEach(() => jest.restoreAllMocks());
  it('signs graph browsing with the current reader and fails closed on malformed upstream data', async () => {
    const scoped = new KnowledgeClientService(
      new ConfigService({
        OSCAR_KNOWLEDGE_ENABLED: true,
        OSCAR_KNOWLEDGE_PRIVATE_SCOPE_SECRET: 'independent-private-test-signing-key-123456789',
      }),
    );
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ready: false,
          method: 'topics-v1',
          topics: [],
          sources: [],
          edges: [],
          related_topics: [],
          summary: {},
        }),
      ),
    );
    await scoped.graph('fixture-owner', { topicId: 'pricing' });
    const init = fetch.mock.calls[0]![1]!;
    const payload = (init.headers as Record<string, string>)['X-OSCAR-Private-Scope']!.split(
      '.',
    )[0]!;
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString()).sub).toBe('fixture-owner');
    expect(JSON.parse(String(init.body)).collection_ids).toEqual([
      'mba-business',
      'personal-library',
      'social-systems',
    ]);
    fetch.mockResolvedValue(
      new Response(JSON.stringify({ ready: true, sources: [{ id: 'bad-source' }] })),
    );
    await expect(scoped.graph('fixture-owner', {})).rejects.toThrow('KNOWLEDGE_GRAPH_UNAVAILABLE');
  });
  it('preserves seed evidence while admitting a bounded graph neighbor into business context', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            retrieval_mode_used: 'hybrid',
            results: Array.from({ length: 12 }, (_, i) => ({
              ...result,
              chunk_id: `c37c3283-30d8-4d43-99a3-2319f3bf20${40 + i}`,
              document_id: `c37c3283-30d8-4d43-99a3-2319f3bf20${60 + i}`,
              title: `Source ${i}`,
              text:
                `Distinct explanatory source ${i}. ` +
                'Customer benefit and validation require evidence. '.repeat(10),
              discovery_path:
                i === 10 ? ['Seed passage', 'Customer value', 'related_topic', 'Pricing'] : [],
            })),
          }),
        ),
    );
    const answer = await client().retrieve('Review our business plan.', undefined, 'mba', true);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(answer.evidence[0]!.title).toBe('Source 0');
    expect(answer.evidence.some((e) => e.discoveryPath?.length)).toBe(true);
    expect(answer.evidence.filter((e) => e.discoveryPath?.length).length).toBeLessThanOrEqual(2);
  });
  it('keeps explicit cross-book synthesis within requested sources when both have usable passages', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            retrieval_mode_used: 'hybrid',
            results: ['Unrequested book', 'Book Alpha: subtitle', 'Book Beta'].map((title, i) => ({
              ...result,
              title,
              chunk_id: `c37c3283-30d8-4d43-99a3-2319f3bf20${40 + i}`,
              document_id: `c37c3283-30d8-4d43-99a3-2319f3bf20${50 + i}`,
              text: `${title} provides explanatory source principles. `.repeat(12),
            })),
          }),
        ),
    );
    const answer = await client().retrieve(
      'Connect ideas from "Book Alpha" and "Book Beta".',
      undefined,
      'mba',
      true,
    );
    expect(answer.evidence.map((e) => e.title).sort()).toEqual([
      'Book Alpha: subtitle',
      'Book Beta',
    ]);
  });
  it('retries only one empty business aspect and preserves the same private subject and collection scope', async () => {
    const scoped = new KnowledgeClientService(
      new ConfigService({
        OSCAR_KNOWLEDGE_ENABLED: true,
        OSCAR_KNOWLEDGE_TIMEOUT_MS: 25000,
        OSCAR_KNOWLEDGE_PRIVATE_SCOPE_SECRET: 'independent-private-test-signing-key-123456789',
      }),
    );
    const actor = 'c37c3283-30d8-4d43-99a3-2319f3bf2049';
    const requests: { query: string; collection_ids: string[] }[] = [];
    const fetch = jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init!.body)));
      const n = requests.length;
      const scope = (init!.headers as Record<string, string>)['X-OSCAR-Private-Scope']!;
      const payload = JSON.parse(Buffer.from(scope.split('.')[0]!, 'base64url').toString());
      expect(payload.sub).toBe(actor);
      expect(payload.body_sha256).toBe(
        createHash('sha256').update(String(init!.body)).digest('hex'),
      );
      return new Response(
        JSON.stringify({
          retrieval_mode_used: 'hybrid',
          results:
            n === 3
              ? []
              : [
                  {
                    ...result,
                    collection_id: 'personal-library',
                    chunk_id: `c37c3283-30d8-4d43-99a3-2319f3bf20${40 + n}`,
                    document_id: `c37c3283-30d8-4d43-99a3-2319f3bf20${50 + n}`,
                    text:
                      `Distinct explanatory passage ${n}. ` +
                      'Customer commitments inform experiments and value delivery. '.repeat(8),
                  },
                ],
        }),
      );
    });
    const response = await scoped.retrieve(
      'Please review our subscription marketplace business plan.',
      actor,
      'all',
      true,
    );
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(requests[2]!.query).toContain('willingness to pay');
    expect(requests[3]!.query).toContain('concrete customer commitments');
    expect(
      requests.every(
        (r) => r.collection_ids.join(',') === 'mba-business,personal-library,social-systems',
      ),
    ).toBe(true);
    expect(response.evidence).toHaveLength(3);
    expect(response.audit?.followUpUsed).toBe(true);
    expect(response.audit?.searches.map((s) => [s.aspect, s.followUp])).toEqual([
      ['customers', false],
      ['marketplace', false],
      ['pricing', false],
      ['pricing', true],
    ]);
    expect(response.audit?.selectedChunkIds).toEqual(response.evidence.map((e) => e.chunkId));
  });
  it('deduplicates identical source bodies across aspect searches without an unnecessary retry', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            retrieval_mode_used: 'hybrid',
            results: [
              { ...result, text: 'A substantive explanation of customer needs. '.repeat(12) },
            ],
          }),
        ),
    );
    const answer = await client().retrieve('Refine this business plan.', undefined, 'mba', true);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(answer.evidence).toHaveLength(1);
    expect(answer.audit?.followUpUsed).toBe(false);
  });
  it('does not retry or issue later business searches after the shared deadline', async () => {
    let clock = 100;
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
    const fetch = jest.spyOn(global, 'fetch').mockImplementation(async () => {
      clock = 10000;
      return new Response(JSON.stringify({ retrieval_mode_used: 'hybrid', results: [] }));
    });
    const answer = await client().retrieve('Review this business model.', undefined, 'mba', true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(answer.audit?.deadlineReached).toBe(true);
    expect(answer.audit?.followUpUsed).toBe(false);
  });
  it('uses bounded signed topic searches and preserves valid evidence if one topic fails', async () => {
    const actor = 'c37c3283-30d8-4d43-99a3-2319f3bf2049';
    const scoped = new KnowledgeClientService(
      new ConfigService({
        OSCAR_KNOWLEDGE_ENABLED: true,
        OSCAR_KNOWLEDGE_PRIVATE_SCOPE_SECRET: 'independent-private-test-signing-key-123456789',
      }),
    );
    const fetch = jest.spyOn(global, 'fetch');
    const passage = (id: string, text: string) => ({
      ...result,
      chunk_id: id,
      text,
      snippet: text.slice(0, 200),
    });
    fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            retrieval_mode_used: 'hybrid',
            results: [
              passage(result.chunk_id, 'Learning objectives. Chapter outline. Strategy.'),
              passage(
                'c37c3283-30d8-4d43-99a3-2319f3bf2047',
                'A competitive advantage requires a valuable capability. '.repeat(8),
              ),
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            retrieval_mode_used: 'hybrid',
            results: [
              passage(
                'c37c3283-30d8-4d43-99a3-2319f3bf2048',
                'Market segmentation separates buyers by distinct needs. '.repeat(8),
              ),
            ],
          }),
        ),
      );
    const answer = await scoped.retrieve('Teach me business fundamentals', actor, 'all');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(answer.unavailable).toBe(false);
    expect(answer.evidence[0]!.chunkId).toBe('c37c3283-30d8-4d43-99a3-2319f3bf2047');
    expect(answer.evidence[1]!.chunkId).toBe('c37c3283-30d8-4d43-99a3-2319f3bf2048');
    for (const [, request] of fetch.mock.calls) {
      const body = JSON.parse(request!.body as string);
      expect(body.collection_ids).toEqual(['mba-business', 'personal-library', 'social-systems']);
      expect(body.top_k).toBe(12);
      const [payload, signature] = (request!.headers as Record<string, string>)[
        'X-OSCAR-Private-Scope'
      ]!.split('.');
      const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString());
      expect(claims.sub).toBe(actor);
      expect(claims.body_sha256).toBe(
        createHash('sha256')
          .update(request!.body as string)
          .digest('hex'),
      );
      expect(signature).toBeDefined();
    }
  });
  it('stops additional topic searches when the shared deadline expires', async () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValueOnce(10000).mockReturnValueOnce(10000).mockReturnValue(13000);
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ retrieval_mode_used: 'keyword', results: [result] })),
      );
    const answer = await client().retrieve('MBA business lessons');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(answer.evidence).toHaveLength(1);
    expect(answer.unavailable).toBe(false);
  });
  it('finds explanatory candidates beyond the first four and deprioritizes index/reference lists', async () => {
    const goodId = 'c37c3283-30d8-4d43-99a3-2319f3bf2055';
    const results = Array.from({ length: 6 }, (_, index) => ({
      ...result,
      chunk_id: index === 5 ? goodId : `c37c3283-30d8-4d43-99a3-2319f3bf206${index}`,
      text:
        index === 5
          ? 'Fault tolerance allows a system to continue operating when a component fails. '.repeat(
              8,
            )
          : index % 2
            ? 'References\nISBN: 123\nISBN: 456\nhttps://example.org/source\n' +
              'A bibliography entry. '.repeat(20)
            : 'Reliability, 10\nScalability, 20\nModularity, 30\nAbstraction, 40\nTesting, 50\nDesign, 60\n' +
              'Index entry. '.repeat(25),
    }));
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(
        async () => new Response(JSON.stringify({ retrieval_mode_used: 'hybrid', results })),
      );
    const answer = await client().retrieve('Teach me software engineering basics');
    expect(answer.evidence[0]!.chunkId).toBe(goodId);
    expect(answer.evidence.length).toBeLessThanOrEqual(8);
    expect(new Set(answer.evidence.map((item) => item.chunkId)).size).toBe(answer.evidence.length);
    // All fixture chunks have the same source; its existing two-passage cap remains.
    expect(answer.evidence.length).toBeLessThanOrEqual(2);
  });
  it('keeps specific-query responses bounded to the requested four candidates', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ retrieval_mode_used: 'hybrid', results: Array(5).fill(result) }),
        ),
      );
    expect((await client().retrieve('pricing')).unavailable).toBe(true);
  });
  it('retains three complementary passages for a focused required-source question but two for broad plans', async () => {
    const results = Array.from({ length: 3 }, (_, i) => ({
      ...result,
      chunk_id: `c37c3283-30d8-4d43-99a3-2319f3bf207${i}`,
      text: 'A substantive explanation of the concept with its qualifications and examples. '.repeat(
        8,
      ),
    }));
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(
        async () => new Response(JSON.stringify({ retrieval_mode_used: 'hybrid', results })),
      );
    expect(
      (await client().retrieve('Define leverage points', undefined, 'mba', true)).evidence,
    ).toHaveLength(3);
    expect(
      (await client().retrieve('MBA business lessons', undefined, 'mba', true)).evidence,
    ).toHaveLength(2);
  });
  it('does not offer navigation-only matches as teaching evidence', async () => {
    const index = {
      ...result,
      text:
        'Newton\n195\nForces\n196\nFirst law\n200\nSecond law\n204\nMass\n215\nThird law\n217\n' +
        'Section heading\n280\n'.repeat(20),
    };
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ retrieval_mode_used: 'hybrid', results: [index] })),
      );
    expect(await client().retrieve('Teach me physics fundamentals')).toEqual({
      evidence: [],
      unavailable: false,
    });
  });
  it('retains substantive definitions alongside numeric table rows', async () => {
    const text =
      'The marketplace distinguishes purchasing buyers from engaged buyers. Engaged buyers searched recently and completed a prior purchase.\nTable 13-2. Buyer engagement\n' +
      Array.from({ length: 24 }, (_, i) => String(i + 1)).join('\n');
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          retrieval_mode_used: 'hybrid',
          results: [{ ...result, text, snippet: text.slice(0, 240) }],
        }),
      ),
    );
    const answer = await client().retrieve('How are buyers defined?', undefined, 'mba', true);
    expect(answer.evidence[0]?.text).toBe(text);
    expect(answer.unavailable).toBe(false);
  });
  it('uses the original focused query with a wider filtered candidate pool when sources are required', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          retrieval_mode_used: 'hybrid',
          results: [{ ...result, text: 'References\n' + 'https://example.org/paper\n'.repeat(4) }],
        }),
      ),
    );
    const query = 'How should we calculate contribution margin?';
    expect(await client().retrieve(query, undefined, 'mba', true)).toEqual({
      evidence: [],
      unavailable: false,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toMatchObject({ query, top_k: 12 });
  });
  it('combines shared and authenticated private scopes without accepting unrelated collections', async () => {
    const actor = 'c37c3283-30d8-4d43-99a3-2319f3bf2049';
    const scoped = new KnowledgeClientService(
      new ConfigService({
        OSCAR_KNOWLEDGE_ENABLED: true,
        OSCAR_KNOWLEDGE_PRIVATE_SCOPE_SECRET: 'independent-private-test-signing-key-123456789',
      }),
    );
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          retrieval_mode_used: 'keyword',
          results: [
            result,
            {
              ...result,
              chunk_id: 'c37c3283-30d8-4d43-99a3-2319f3bf2048',
              collection_id: 'social-systems',
            },
          ],
        }),
      ),
    );
    expect((await scoped.retrieve('systems', actor, 'all')).evidence).toHaveLength(2);
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).collection_ids).toEqual([
      'mba-business',
      'personal-library',
      'social-systems',
    ]);
    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          retrieval_mode_used: 'keyword',
          results: [{ ...result, collection_id: 'another-private-collection' }],
        }),
      ),
    );
    expect((await scoped.retrieve('systems', actor, 'all')).unavailable).toBe(true);
  });
  it('bounds private catalog response bytes', async () => {
    const scoped = new KnowledgeClientService(
      new ConfigService({
        OSCAR_KNOWLEDGE_ENABLED: true,
        OSCAR_KNOWLEDGE_PRIVATE_SCOPE_SECRET: 'independent-private-test-signing-key-123456789',
      }),
    );
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('x'.repeat(5000)));
    expect(await scoped.collections('c37c3283-30d8-4d43-99a3-2319f3bf2049')).toEqual([]);
  });
  it('binds private retrieval to authenticated actor and exact request with a separate signing key', async () => {
    const secret = 'independent-private-library-test-key-123456789';
    const actor = 'c37c3283-30d8-4d43-99a3-2319f3bf2049';
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          retrieval_mode_used: 'keyword',
          results: [{ ...result, collection_id: 'personal-library' }],
        }),
      ),
    );
    const scoped = new KnowledgeClientService(
      new ConfigService({
        OSCAR_KNOWLEDGE_ENABLED: true,
        OSCAR_KNOWLEDGE_SERVICE_TOKEN: 'service-token',
        OSCAR_KNOWLEDGE_PRIVATE_SCOPE_SECRET: secret,
      }),
    );
    expect((await scoped.retrieve('systems', actor, 'personal-library')).unavailable).toBe(false);
    const request = fetch.mock.calls[0]![1]!;
    const headers = request.headers as Record<string, string>;
    const [payload, signature] = headers['X-OSCAR-Private-Scope']!.split('.');
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString());
    expect(claims.sub).toBe(actor);
    expect(claims.body_sha256).toBe(
      createHash('sha256')
        .update(request.body as string)
        .digest('hex'),
    );
    expect(signature).toBe(createHmac('sha256', secret).update(payload!).digest('hex'));
    expect(claims.exp - claims.iat).toBe(30);
    fetch.mockClear();
    expect((await scoped.retrieve('systems', undefined, 'personal-library')).unavailable).toBe(
      true,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not send private requests when only the service bearer is configured', async () => {
    const fetch = jest.spyOn(global, 'fetch');
    expect(
      (await client().retrieve('systems', 'c37c3283-30d8-4d43-99a3-2319f3bf2049', 'social-systems'))
        .unavailable,
    ).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('makes no HTTP call when disabled', async () => {
    const fetch = jest.spyOn(global, 'fetch');
    expect(await client(false).retrieve('pricing')).toEqual({ evidence: [], unavailable: true });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['connection', 'timeout', 'bad-json', 'scope', 'unsafe-url', 'oversize'])(
    'degrades safely on %s',
    async (kind) => {
      const fetch = jest.spyOn(global, 'fetch');
      if (kind === 'connection' || kind === 'timeout') fetch.mockRejectedValue(new Error(kind));
      else if (kind === 'bad-json') fetch.mockResolvedValue(new Response('invalid'));
      else if (kind === 'oversize') fetch.mockResolvedValue(new Response('x'.repeat(100001)));
      else
        fetch.mockResolvedValue(
          new Response(
            JSON.stringify({
              retrieval_mode_used: 'keyword',
              results: [
                {
                  ...result,
                  ...(kind === 'scope'
                    ? { collection_id: 'private' }
                    : { source_url: 'javascript:alert(1)' }),
                },
              ],
            }),
          ),
        );
      expect((await client().retrieve('pricing')).unavailable).toBe(true);
    },
  );
  it('keeps external identity and maps numbered citations through the same budgeted list', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ retrieval_mode_used: 'keyword', results: [result] })),
      );
    const retrieved = await client().retrieve('pricing');
    expect(retrieved.unavailable).toBe(false);
    const external = retrieved.evidence[0]!;
    expect(external).toMatchObject({
      sourceType: 'EXTERNAL_KNOWLEDGE',
      sourceUrl: result.source_url,
      pageStart: 2,
    });
    const workspace: AssistantEvidence = {
      chunkId: 'workspace',
      sourceId: 'workspace-doc',
      sourceType: KnowledgeSourceType.DOCUMENT,
      title: 'Workspace',
      locator: 'Section',
      revision: 1,
      text: 'Internal project pricing',
      snippet: 'Internal project pricing',
      score: 1,
    };
    const assembled = new ContextAssembler().assemble('Test', AssistantMode.WORKSPACE, [
      workspace,
      external,
    ]);
    expect(assembled.evidenceText).toContain('[Evidence #2]');
    expect(assembled.evidenceText).toContain(result.source_url);
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: 'Workspace [Evidence #1]; course [Evidence #2]; forged [Evidence #99].',
              },
            },
          ],
        }),
      ),
    );
    const answer = await new DeepSeekLlmProvider('fake').generateAnswer({
      messages: [],
      evidence: assembled.evidenceItems,
    });
    expect(answer.citations.map((c) => c.chunkId)).toEqual(['workspace', result.chunk_id]);
  });
  it('reserves external space and numbers only evidence actually included', () => {
    const sources: AssistantEvidence[] = Array.from({ length: 8 }, (_, index) => ({
      chunkId: `internal-${index}`,
      sourceId: 'project-doc',
      sourceType: KnowledgeSourceType.DOCUMENT,
      title: 'Internal',
      revision: 1,
      locator: 'Section',
      text: 'a'.repeat(2400),
      snippet: 'a',
      score: 1,
    }));
    sources.push({
      chunkId: result.chunk_id,
      sourceId: result.document_id,
      sourceType: 'EXTERNAL_KNOWLEDGE',
      title: result.title,
      revision: 1,
      locator: 'Page 2',
      text: result.text,
      snippet: result.snippet,
      score: 1,
      sourceUrl: result.source_url,
    });
    const assembled = new ContextAssembler().assemble('Test', AssistantMode.WORKSPACE, sources);
    expect(assembled.evidenceItems.at(-1)?.chunkId).toBe(result.chunk_id);
    expect(assembled.evidenceText.length).toBeLessThanOrEqual(16000);
    expect(assembled.evidenceText).toContain(`[Evidence #${assembled.evidenceItems.length}]`);
    expect(assembled.evidenceItems.length).toBeLessThan(sources.length);
  });

  describe('inspectPassage', () => {
    const passageText = 'Indicators: customers buying; a pattern emerging; WOM possible.';
    const actor = '6f2c5950-8eaa-4cc7-a78c-3dec8c637ab6';
    const params = {
      chunkId: 'd5595603-f3e2-5043-ae67-94645483b84a',
      documentId: 'c2835011-09e7-4d96-a8fc-7310b919fc61',
      revision: 1,
    };
    const mockInspectResponse = {
      chunk_id: 'd5595603-f3e2-5043-ae67-94645483b84a',
      document_id: 'c2835011-09e7-4d96-a8fc-7310b919fc61',
      collection_id: 'personal-library',
      title: 'MIT Lecture 21',
      book_id: '1c5089a4-1995-4584-86a6-6d0cfeb666fb',
      author: 'Bill Aulet',
      edition: 'Spring 2013',
      chapter: 'Scaling',
      locator: 'Page 19',
      page_start: 19,
      page_end: 19,
      start_ms: null,
      end_ms: null,
      revision: 1,
      text: passageText,
      char_count: Array.from(passageText).length,
      extraction: 'NATIVE_PDF_TEXT',
      review_required: false,
      coverage_note: null,
      source_url: 'https://example.org/mit15_390_lec21.pdf',
      is_truncated: false,
    };

    const createService = (enabled = true) =>
      new KnowledgeClientService(
        new ConfigService({
          OSCAR_KNOWLEDGE_ENABLED: enabled,
          OSCAR_KNOWLEDGE_SERVICE_TOKEN: 'service-token-123456789',
          OSCAR_KNOWLEDGE_PRIVATE_SCOPE_SECRET: 'independent-private-test-signing-key-123456789',
        }),
      );

    it('successfully retrieves full permitted passage with HMAC-signed private scope', async () => {
      const service = createService();
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockInspectResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const result = await service.inspectPassage(actor, params);
      expect(result.chunkId).toBe(params.chunkId);
      expect(result.text).toContain('Indicators');
      expect(result.charCount).toBe(Array.from(passageText).length);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const [url, request] = fetchSpy.mock.calls[0]!;
      expect(String(url)).toContain('/internal/v1/passage');
      expect(request!.method).toBe('POST');
      const authHeader = (request!.headers as Record<string, string>)['Authorization'];
      expect(authHeader).toMatch(/^Bearer /);
      const scopeHeader = (request!.headers as Record<string, string>)['X-OSCAR-Private-Scope'];
      expect(scopeHeader).toBeDefined();
      const [payloadB64, sig] = scopeHeader!.split('.');
      const claims = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString());
      expect(claims.sub).toBe(actor);
      expect(sig).toBeDefined();
    });

    it('throws UnauthorizedException on 401', async () => {
      const service = createService();
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ detail: 'Missing bearer token' }), { status: 401 }),
        );
      await expect(service.inspectPassage(actor, params)).rejects.toThrow('KNOWLEDGE_AUTH_FAILED');
    });

    it('throws ForbiddenException on 403 access denied', async () => {
      const service = createService();
      jest.spyOn(global, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Access denied to private document' }), {
          status: 403,
        }),
      );
      await expect(service.inspectPassage(actor, params)).rejects.toThrow(
        'KNOWLEDGE_ACCESS_DENIED',
      );
    });

    it('throws NotFoundException on 404', async () => {
      const service = createService();
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ detail: 'Document not found' }), { status: 404 }),
        );
      await expect(service.inspectPassage(actor, params)).rejects.toThrow(
        'KNOWLEDGE_PASSAGE_NOT_FOUND',
      );
    });

    it('throws ConflictException on 409 stale revision', async () => {
      const service = createService();
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ detail: 'Stale document revision' }), { status: 409 }),
        );
      await expect(service.inspectPassage(actor, params)).rejects.toThrow(
        'KNOWLEDGE_STALE_REVISION',
      );
    });

    it('preserves 410 for an excluded chunk', async () => {
      const service = createService();
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ detail: 'Chunk excluded' }), { status: 410 }),
        );
      await expect(service.inspectPassage(actor, params)).rejects.toThrow(
        'KNOWLEDGE_PASSAGE_UNAVAILABLE',
      );
    });

    it.each(['chunk', 'document', 'revision', 'count'])(
      'rejects a mismatched %s inspection response',
      async (kind) => {
        const changed = {
          ...mockInspectResponse,
          ...(kind === 'chunk' ? { chunk_id: '00000000-0000-4000-8000-000000000005' } : {}),
          ...(kind === 'document' ? { document_id: '00000000-0000-4000-8000-000000000006' } : {}),
          ...(kind === 'revision' ? { revision: 2 } : {}),
          ...(kind === 'count' ? { char_count: 999 } : {}),
        };
        jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(changed)));
        await expect(createService().inspectPassage(actor, params)).rejects.toThrow(
          'KNOWLEDGE_UNAVAILABLE',
        );
      },
    );

    it('counts Unicode code points consistently with the Knowledge API', async () => {
      const text = 'Finance 𝛼';
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ ...mockInspectResponse, text, char_count: Array.from(text).length }),
          ),
        );
      expect((await createService().inspectPassage(actor, params)).text).toBe(text);
    });

    it('bounds inspection response bytes and never logs malformed private bodies', async () => {
      const { Logger } = await import('@nestjs/common');
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      const fetch = jest.spyOn(global, 'fetch');
      for (const body of ['PRIVATE', 'x'.repeat(100001)]) {
        fetch.mockResolvedValueOnce(new Response(body));
        await expect(createService().inspectPassage(actor, params)).rejects.toThrow(
          'KNOWLEDGE_UNAVAILABLE',
        );
      }
      expect(warn.mock.calls).toEqual([
        ['KNOWLEDGE_PASSAGE_INSPECT_FAILED'],
        ['KNOWLEDGE_PASSAGE_INSPECT_FAILED'],
      ]);
    });

    it('throws ForbiddenException when knowledge service is disabled', async () => {
      const service = createService(false);
      await expect(service.inspectPassage(actor, params)).rejects.toThrow(
        'KNOWLEDGE_SERVICE_DISABLED',
      );
    });
  });
});
