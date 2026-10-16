import { EmbeddingProvider } from './embedding-provider.interface';

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  readonly modelName: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: {
    apiKey: string;
    baseUrl?: string;
    dimensions?: number;
    modelName?: string;
  }) {
    if (!options.apiKey) {
      throw new Error('OPENAI_API_KEY is required for OpenAiEmbeddingProvider.');
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.dimensions = options.dimensions ?? 1536;
    this.modelName = options.modelName ?? 'text-embedding-3-small';
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const batchSize = 100;
    const results: number[][] = new Array(texts.length);

    for (let i = 0; i < texts.length; i += batchSize) {
      const chunk = texts.slice(i, i + batchSize);
      const res = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.modelName,
          input: chunk,
          dimensions: this.dimensions,
        }),
        signal: AbortSignal.timeout(30000),
        redirect: 'error',
      });

      if (!res.ok) {
        throw new Error(`EMBEDDING_HTTP_${res.status}`);
      }

      const body: unknown = await res.json().catch(() => {
        throw new Error('EMBEDDING_RESPONSE_INVALID');
      });
      if (
        !body ||
        typeof body !== 'object' ||
        !('data' in body) ||
        !Array.isArray(body.data) ||
        body.data.length !== chunk.length
      )
        throw new Error('EMBEDDING_RESPONSE_INVALID');
      // OpenRouter's live embedding response uses the upstream bare model name
      // for this exact route. Keep the configured host/model in vector identity;
      // do not accept arbitrary suffix matches or aliases on other endpoints.
      const routedSmallAlias =
        this.baseUrl === 'https://openrouter.ai/api/v1' &&
        this.modelName === 'openai/text-embedding-3-small' &&
        'model' in body &&
        body.model === 'text-embedding-3-small';
      if ('model' in body && body.model !== this.modelName && !routedSmallAlias)
        throw new Error('EMBEDDING_MODEL_MISMATCH');
      const seen = new Set<number>();
      for (const item of body.data as { embedding: number[]; index: number }[]) {
        if (
          !item ||
          !Number.isInteger(item.index) ||
          item.index < 0 ||
          item.index >= chunk.length ||
          seen.has(item.index) ||
          !Array.isArray(item.embedding) ||
          item.embedding.length !== this.dimensions ||
          item.embedding.some((n) => typeof n !== 'number' || !Number.isFinite(n)) ||
          !item.embedding.some((n) => n !== 0)
        )
          throw new Error('EMBEDDING_RESPONSE_INVALID');
        seen.add(item.index);
        const targetIdx = i + item.index;
        results[targetIdx] = item.embedding;
      }
    }

    return results as number[][];
  }
}
