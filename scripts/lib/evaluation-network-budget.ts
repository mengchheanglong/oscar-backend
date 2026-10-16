/** A request/input ceiling, not a currency budget. Counts attempted requests. */
export class EvaluationNetworkBudget {
  limitReached = false;
  readonly usage = {
    generationCalls: 0,
    generationInputBytes: 0,
    reservedOutputTokens: 0,
    embeddingCalls: 0,
    embeddingTexts: 0,
    embeddingInputBytes: 0,
    generationUsageResponses: 0,
    promptTokens: 0,
    completionTokens: 0,
    embeddingUsageResponses: 0,
    embeddingTokens: 0,
  };
  readonly limits = {
    generationCalls: 14,
    generationInputBytes: 200000,
    reservedOutputTokens: 42000,
    embeddingCalls: 40,
    embeddingTexts: 128,
    embeddingInputBytes: 100000,
  };
  constructor(
    private readonly generationEndpoint: string,
    private readonly embeddingEndpoint: string,
    private readonly generationModel: string,
    private readonly request: typeof fetch = globalThis.fetch,
  ) {}

  fetch: typeof fetch = async (input, init) => {
    const endpoint = String(input);
    if (!init || typeof init.body !== 'string') throw new Error('EVAL_REQUEST_INVALID');
    const body = JSON.parse(init.body) as {
      model?: string;
      messages?: { content?: unknown }[];
      max_tokens?: number;
      input?: unknown;
    };
    const next = { ...this.usage };
    const generation = endpoint === this.generationEndpoint;
    if (generation) {
      if (
        body.model !== this.generationModel ||
        !Array.isArray(body.messages) ||
        !Number.isInteger(body.max_tokens) ||
        body.max_tokens! < 1 ||
        body.max_tokens! > 3000 ||
        body.messages.some((m) => typeof m.content !== 'string')
      )
        throw new Error('EVAL_REQUEST_INVALID');
      next.generationCalls++;
      next.generationInputBytes += body.messages.reduce(
        (n, m) => n + Buffer.byteLength(m.content as string, 'utf8'),
        0,
      );
      next.reservedOutputTokens += body.max_tokens!;
    } else if (endpoint === this.embeddingEndpoint) {
      const texts = typeof body.input === 'string' ? [body.input] : body.input;
      if (!Array.isArray(texts) || !texts.length || texts.some((t) => typeof t !== 'string'))
        throw new Error('EVAL_REQUEST_INVALID');
      next.embeddingCalls++;
      next.embeddingTexts += texts.length;
      next.embeddingInputBytes += texts.reduce(
        (n: number, t: string) => n + Buffer.byteLength(t, 'utf8'),
        0,
      );
    } else throw new Error('EVAL_ENDPOINT_NOT_ALLOWED');
    for (const key of Object.keys(this.limits) as (keyof typeof this.limits)[])
      if (next[key] > this.limits[key]) {
        this.limitReached = true;
        throw new Error('EVAL_NETWORK_LIMIT');
      }
    Object.assign(this.usage, next);
    const response = await this.request(input, init);
    if (response.ok) {
      const parsed = (await response
        .clone()
        .json()
        .catch(() => null)) as { usage?: Record<string, unknown> } | null;
      const usage = parsed?.usage;
      const scalar = (key: string) =>
        typeof usage?.[key] === 'number' && Number.isFinite(usage[key]) && usage[key] >= 0
          ? (usage[key] as number)
          : null;
      if (generation && scalar('prompt_tokens') !== null && scalar('completion_tokens') !== null) {
        this.usage.generationUsageResponses++;
        this.usage.promptTokens += scalar('prompt_tokens')!;
        this.usage.completionTokens += scalar('completion_tokens')!;
      } else if (!generation && scalar('total_tokens') !== null) {
        this.usage.embeddingUsageResponses++;
        this.usage.embeddingTokens += scalar('total_tokens')!;
      }
    }
    return response;
  };
}
