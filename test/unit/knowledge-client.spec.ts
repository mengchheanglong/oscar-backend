import { ConfigService } from '@nestjs/config';
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
