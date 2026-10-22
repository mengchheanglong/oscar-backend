import { PrivateMemoryService } from '../../src/modules/assistant/memory/private-memory.service';
import { PrivateMemoryRepository } from '../../src/modules/assistant/memory/private-memory.repository';
import {
  validateVectors,
  embeddingIdentity,
} from '../../src/modules/assistant/memory/private-memory.contract';
import { OpenAiEmbeddingProvider } from '../../src/modules/ingestion/embedding/openai-embedding-provider';
import { ConfigService } from '@nestjs/config';
import { memoryEmbedder } from '../../src/modules/assistant/memory/private-memory.provider';

const vector = () => [1, ...Array<number>(1535).fill(0)];
describe('Private memory provider boundary', () => {
  it('keeps DeepSeek-only configuration keyword-only and never uses its key for embeddings', () => {
    const fetch = jest.spyOn(globalThis, 'fetch');
    for (const embeddingProvider of ['disabled', 'openai']) {
      expect(
        memoryEmbedder(
          new ConfigService({
            AI_LLM_PROVIDER: 'deepseek',
            AI_CHAT_MODEL: 'deepseek-v4-pro',
            DEEPSEEK_API_KEY: 'synthetic-deepseek-only',
            AI_EMBEDDING_PROVIDER: embeddingProvider,
          }),
        ),
      ).toBeNull();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('requires a schema-compatible dimension when a separate embedding key is configured', () => {
    expect(() =>
      memoryEmbedder(
        new ConfigService({
          AI_EMBEDDING_PROVIDER: 'openai',
          OPENAI_API_KEY: 'synthetic-embedding-key',
          AI_EMBEDDING_DIMENSIONS: 256,
        }),
      ),
    ).toThrow('MEMORY_EMBEDDING_DIMENSIONS_REQUIRE_MIGRATION');
  });
  afterEach(() => jest.restoreAllMocks());
  it.each([
    ['https://openrouter.ai/api/v1', 'text-embedding-3-small', true],
    ['https://api.openai.com/v1', 'text-embedding-3-small', false],
    ['https://openrouter.ai/api/v1', 'text-embedding-3-large', false],
  ])(
    'accepts only the verified OpenRouter upstream alias (%s, %s)',
    async (baseUrl, returned, allowed) => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response(
            JSON.stringify({ model: returned, data: [{ index: 0, embedding: vector() }] }),
            { status: 200 },
          ),
        );
      const provider = new OpenAiEmbeddingProvider({
        apiKey: 'synthetic-embedding-key',
        baseUrl,
        modelName: 'openai/text-embedding-3-small',
        dimensions: 1536,
      });
      if (allowed) await expect(provider.embed(['Synthetic input'])).resolves.toHaveLength(1);
      else
        await expect(provider.embed(['Synthetic input'])).rejects.toThrow(
          'EMBEDDING_MODEL_MISMATCH',
        );
    },
  );
  it('rejects dimension, numeric, zero and count errors', () => {
    for (const vectors of [
      [],
      [[1]],
      [Array<number>(1536).fill(0)],
      [[NaN, ...vector().slice(1)]],
      [[Infinity, ...vector().slice(1)]],
    ])
      expect(() => validateVectors(vectors, 1)).toThrow('MEMORY_EMBEDDING_INVALID');
    expect(() => validateVectors([vector()], 1)).not.toThrow();
    expect(embeddingIdentity('provider-a', 'model-a')).not.toBe(
      embeddingIdentity('provider-a', 'model-b'),
    );
    expect(embeddingIdentity('provider-a', 'model-a')).not.toBe(
      embeddingIdentity('provider-b', 'model-a'),
    );
  });
  it.each([
    { data: [] },
    {
      data: [
        { index: 0, embedding: vector() },
        { index: 0, embedding: vector() },
      ],
    },
    {
      data: [
        { index: 2, embedding: vector() },
        { index: 1, embedding: vector() },
      ],
    },
    {
      data: [
        { index: 0, embedding: [1] },
        { index: 1, embedding: vector() },
      ],
    },
    {
      model: 'wrong-model',
      data: [
        { index: 0, embedding: vector() },
        { index: 1, embedding: vector() },
      ],
    },
  ])('rejects malformed provider replies', async (body) => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body)));
    const provider = new OpenAiEmbeddingProvider({ apiKey: 'synthetic' });
    await expect(provider.embed(['a', 'b'])).rejects.toThrow();
  });
  it('restores response ordering by unique index', async () => {
    const second = [0, 1, ...Array<number>(1534).fill(0)];
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: second },
            { index: 0, embedding: vector() },
          ],
        }),
      ),
    );
    await expect(
      new OpenAiEmbeddingProvider({ apiKey: 'synthetic' }).embed(['a', 'b']),
    ).resolves.toEqual([vector(), second]);
  });
  it('does not leak response bodies on provider failure', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('private-text', { status: 400 }));
    await expect(new OpenAiEmbeddingProvider({ apiKey: 'synthetic' }).embed(['a'])).rejects.toThrow(
      'EMBEDDING_HTTP_400',
    );
  });
  it('reauthorizes after an embedding failure and never returns pre-revocation rows', async () => {
    const repo = {
      assertAccess: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('revoked')),
      lexical: jest.fn().mockResolvedValue([]),
      hasVectors: jest.fn().mockResolvedValue(true),
    };
    const service = new PrivateMemoryService(repo as unknown as PrivateMemoryRepository, {
      identity: 'test',
      embed: async () => {
        throw new Error('provider failed');
      },
    });
    await expect(service.select('p', 'u', 'query')).rejects.toThrow('revoked');
  });
});
