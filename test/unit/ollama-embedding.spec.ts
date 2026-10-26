import { ConfigService } from '@nestjs/config';
import {
  OllamaEmbeddingProvider,
  QWEN_QUERY_INSTRUCTION,
} from '../../src/modules/ingestion/embedding/ollama-embedding-provider';
import { memoryEmbedder } from '../../src/modules/assistant/memory/private-memory.provider';
import { validateEnvironment } from '../../src/config/environment';

const revision = 'a'.repeat(64);
const vector = () => [1, ...Array<number>(1023).fill(0)];
const provider = () => new OllamaEmbeddingProvider({ baseUrl: 'http://127.0.0.1:11434', revision });
const tags = () =>
  new Response(
    JSON.stringify({ models: [{ name: 'qwen3-embedding:0.6b', digest: `sha256:${revision}` }] }),
  );
describe('Local Qwen embedding boundary', () => {
  afterEach(() => jest.restoreAllMocks());
  it('uses raw documents and instructed queries, pins the model and sends no API credential', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).endsWith('/api/tags')) return tags();
      const body = JSON.parse(String(init?.body)) as { input: string[]; truncate: boolean };
      expect(body.truncate).toBe(false);
      expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
      return new Response(
        JSON.stringify({ model: 'qwen3-embedding:0.6b', embeddings: body.input.map(vector) }),
      );
    });
    const local = provider();
    expect(await local.embed(['original document'])).toEqual([vector()]);
    expect(await local.embedQuery(['question'])).toEqual([vector()]);
    const bodies = fetch.mock.calls
      .filter(([url]) => String(url).endsWith('/api/embed'))
      .map(([, init]) => JSON.parse(String(init?.body)) as { input: string[] });
    expect(bodies.map((body) => body.input)).toEqual([
      ['original document'],
      [`Instruct: ${QWEN_QUERY_INSTRUCTION}\nQuery:question`],
    ]);
    expect(local.identity).toContain(revision);
  });
  it('does not embed or fall back when the pinned model revision changes', async () => {
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ models: [{ name: 'qwen3-embedding:0.6b', digest: 'b'.repeat(64) }] }),
        ),
      );
    await expect(provider().embed(['text'])).rejects.toThrow('REVISION_MISMATCH');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(
    [[], [[0, ...Array<number>(1023).fill(0)]], [[1]], [vector(), vector()]].map((embeddings) => ({
      embeddings,
    })),
  )('rejects malformed vector counts or dimensions', async ({ embeddings }) => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(tags())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ model: 'qwen3-embedding:0.6b', embeddings })),
      );
    await expect(provider().embed(['text'])).rejects.toThrow('RESPONSE_INVALID');
  });
  it('propagates local failure without contacting a remote embedding provider', async () => {
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('synthetic local outage'));
    await expect(provider().embedQuery(['text'])).rejects.toThrow('local outage');
    expect(
      fetch.mock.calls.every(([url]) => String(url).startsWith('http://127.0.0.1:11434/')),
    ).toBe(true);
  });
  it.each(['catalog', 'embedding'])(
    'does not expose malformed private %s response text in errors',
    async (stage) => {
      const fetch = jest.spyOn(globalThis, 'fetch');
      if (stage === 'embedding') fetch.mockResolvedValueOnce(tags());
      fetch.mockResolvedValueOnce(new Response('synthetic-private-response-text'));
      const error = await provider()
        .embed(['text'])
        .catch((error) => error as Error);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/^OLLAMA_.*RESPONSE_INVALID$/);
      expect((error as Error).message).not.toContain('synthetic-private');
    },
  );
  it.each([
    'https://api.openai.com',
    'http://user:password@localhost:11434',
    'http://localhost:11434/path',
  ])('rejects nonlocal or credentialed endpoints %s', (baseUrl) => {
    expect(() => new OllamaEmbeddingProvider({ baseUrl, revision })).toThrow();
  });
  it('supports local memory indexing without an OpenAI key and keeps query formatting distinct', () => {
    const config = {
      APP_ORIGIN: 'http://localhost:43100',
      DATABASE_URL: 'postgresql://test:test@localhost/test',
      AI_ENABLED: 'true',
      DEEPSEEK_API_KEY: 'synthetic',
      AI_DAILY_PROJECT_BUDGET_USD: '1',
      AI_HISTORY_AUTO_INDEX_ENABLED: 'true',
      AI_EMBEDDING_PROVIDER: 'ollama',
      AI_EMBEDDING_MODEL: 'qwen3-embedding:0.6b',
      AI_EMBEDDING_DIMENSIONS: '1024',
      AI_OLLAMA_MODEL_REVISION: revision,
    };
    expect(validateEnvironment(config).AI_EMBEDDING_DIMENSIONS).toBe(1024);
    const local = memoryEmbedder(new ConfigService({ ...config, AI_EMBEDDING_DIMENSIONS: 1024 }));
    expect(local?.dimensions).toBe(1024);
    expect(local?.embedQuery).toBeDefined();
    expect(() => validateEnvironment({ ...config, AI_EMBEDDING_DIMENSIONS: '1536' })).toThrow();
    expect(() => validateEnvironment({ ...config, AI_OLLAMA_MODEL_REVISION: '' })).toThrow();
  });
});
