import { EmbeddingProvider } from './embedding-provider.interface';

export const QWEN_QUERY_INSTRUCTION =
  'Given a question, retrieve relevant passages that answer the question';

/** Local embeddings only. Never downloads a model or falls back to a paid endpoint. */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 1024;
  readonly modelName = 'qwen3-embedding:0.6b';
  readonly identity: string;
  private readonly baseUrl: string;
  private readonly revision: string;

  constructor(
    private readonly options: {
      baseUrl: string;
      revision: string;
      queryTimeoutMs?: number;
      documentTimeoutMs?: number;
    },
  ) {
    const url = new URL(options.baseUrl);
    if (
      url.protocol !== 'http:' ||
      !['localhost', '127.0.0.1', '[::1]', 'host.docker.internal'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    ) {
      throw new Error('OLLAMA_REQUIRES_LOCAL_ORIGIN');
    }
    this.baseUrl = url.origin;
    this.revision = options.revision.replace(/^sha256:/, '');
    if (!/^[a-f0-9]{64}$/.test(this.revision)) throw new Error('OLLAMA_REQUIRES_PINNED_REVISION');
    this.identity = JSON.stringify([
      this.baseUrl,
      this.modelName,
      this.revision,
      this.dimensions,
      QWEN_QUERY_INSTRUCTION,
      'raw-doc-query-instruct-4096-v1',
    ]);
  }

  embed(texts: string[]): Promise<number[][]> {
    return this.generate(texts, false);
  }
  embedQuery(texts: string[]): Promise<number[][]> {
    return this.generate(texts, true);
  }

  private async generate(texts: string[], query: boolean): Promise<number[][]> {
    if (!texts.length) return [];
    if (
      texts.some(
        (text) =>
          typeof text !== 'string' || !text.trim() || Buffer.byteLength(text, 'utf8') > 100000,
      )
    )
      throw new Error('OLLAMA_INPUT_INVALID');
    const timeout = query
      ? (this.options.queryTimeoutMs ?? 5000)
      : (this.options.documentTimeoutMs ?? 120000);
    const tags = await fetch(`${this.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(Math.min(timeout, 5000)),
      redirect: 'error',
    });
    if (!tags.ok) throw new Error('OLLAMA_RUNTIME_UNAVAILABLE');
    const catalog = (await tags.json().catch(() => {
      throw new Error('OLLAMA_RUNTIME_RESPONSE_INVALID');
    })) as { models?: Array<{ name?: string; digest?: string }> };
    if (!catalog || !Array.isArray(catalog.models))
      throw new Error('OLLAMA_RUNTIME_RESPONSE_INVALID');
    const model = catalog.models.find((item) => item?.name === this.modelName);
    if (model?.digest?.replace(/^sha256:/, '') !== this.revision)
      throw new Error('OLLAMA_MODEL_REVISION_MISMATCH');
    const vectors: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += 16) {
      const input = texts
        .slice(offset, offset + 16)
        .map((text) => (query ? `Instruct: ${QWEN_QUERY_INSTRUCTION}\nQuery:${text}` : text));
      const response = await fetch(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelName,
          input,
          truncate: false,
          keep_alive: '-1m',
          options: { num_ctx: 4096 },
        }),
        signal: AbortSignal.timeout(timeout),
        redirect: 'error',
      });
      if (!response.ok) throw new Error(`OLLAMA_EMBEDDING_HTTP_${response.status}`);
      const body = (await response.json().catch(() => {
        throw new Error('OLLAMA_EMBEDDING_RESPONSE_INVALID');
      })) as { model?: string; embeddings?: number[][] };
      if (
        !body ||
        body.model !== this.modelName ||
        !Array.isArray(body.embeddings) ||
        body.embeddings.length !== input.length ||
        body.embeddings.some(
          (vector) =>
            !Array.isArray(vector) ||
            vector.length !== this.dimensions ||
            vector.some((value) => typeof value !== 'number' || !Number.isFinite(value)) ||
            !vector.some((value) => value !== 0),
        )
      )
        throw new Error('OLLAMA_EMBEDDING_RESPONSE_INVALID');
      vectors.push(...body.embeddings);
    }
    return vectors;
  }
}
