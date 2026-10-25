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
});
