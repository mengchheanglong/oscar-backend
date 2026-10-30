import { DEFAULT_QWEN_REVISION, validateEnvironment } from '../../src/config/environment';

const valid = {
  APP_ORIGIN: 'http://localhost:43101',
  DATABASE_URL: 'postgresql://user:private@localhost:5432/dev',
};

describe('Environment validation', () => {
  it('validates structural-answer rollout switches and a bounded repair deadline', () => {
    const config = validateEnvironment(valid);
    expect(config.AI_ANSWER_BLOCKS_ENABLED).toBe(true);
    expect(config.AI_ANSWER_REPAIR_ENABLED).toBe(true);
    expect(config.AI_ANSWER_BLOCK_BUDGET_MS).toBe(20000);
    expect(
      validateEnvironment({ ...valid, AI_ANSWER_BLOCKS_ENABLED: 'false' }).AI_ANSWER_BLOCKS_ENABLED,
    ).toBe(false);
    for (const value of ['0', '50000', 'NaN'])
      expect(() => validateEnvironment({ ...valid, AI_ANSWER_BLOCK_BUDGET_MS: value })).toThrow();
  });
  it('requires the reference service to be enabled for required-source mode', () => {
    expect(validateEnvironment(valid).OSCAR_KNOWLEDGE_REQUIRED).toBe(false);
    expect(() => validateEnvironment({ ...valid, OSCAR_KNOWLEDGE_REQUIRED: 'true' })).toThrow();
    expect(
      validateEnvironment({
        ...valid,
        OSCAR_KNOWLEDGE_REQUIRED: 'true',
        OSCAR_KNOWLEDGE_ENABLED: 'true',
      }).OSCAR_KNOWLEDGE_REQUIRED,
    ).toBe(true);
  });
  it('defaults to pinned local Qwen without an OpenAI credential', () => {
    const config = validateEnvironment(valid);
    expect(config.AI_EMBEDDING_PROVIDER).toBe('ollama');
    expect(config.AI_EMBEDDING_MODEL).toBe('qwen3-embedding:0.6b');
    expect(config.AI_EMBEDDING_DIMENSIONS).toBe(1024);
    expect(config.AI_OLLAMA_MODEL_REVISION).toBe(DEFAULT_QWEN_REVISION);
    expect(config.OPENAI_API_KEY).toBeUndefined();
  });
  it('honors explicit keyword-only and OpenAI provider choices with compatible defaults', () => {
    for (const provider of ['disabled', 'openai']) {
      const config = validateEnvironment({ ...valid, AI_EMBEDDING_PROVIDER: provider });
      expect(config.AI_EMBEDDING_PROVIDER).toBe(provider);
      expect(config.AI_EMBEDDING_MODEL).toBe('text-embedding-3-small');
      expect(config.AI_EMBEDDING_DIMENSIONS).toBe(1536);
    }
  });
  it('requires Nous auth paths and a free model while retaining the DeepSeek default', () => {
    expect(validateEnvironment(valid).HERMES_PROVIDER).toBe('deepseek');
    const nous = {
      ...valid,
      AI_ENABLED: 'true',
      DEEPSEEK_API_KEY: 'synthetic',
      AI_DAILY_PROJECT_BUDGET_USD: '25',
      HERMES_ENABLED: 'true',
      HERMES_PYTHON: '/python',
      HERMES_ROOT: '/runtime',
      HERMES_PROVIDER: 'nous',
    };
    expect(() => validateEnvironment(nous)).toThrow('HERMES_PROVIDER');
    expect(() =>
      validateEnvironment({
        ...nous,
        HERMES_MODEL: 'paid/model',
        HERMES_AUTH_PYTHON: '/auth/python',
        HERMES_AUTH_ROOT: '/auth/root',
        HERMES_AUTH_HOME: '/auth/home',
      }),
    ).toThrow('HERMES_PROVIDER');
    expect(
      validateEnvironment({
        ...nous,
        HERMES_MODEL: 'stepfun/step-3.7-flash:free',
        HERMES_AUTH_PYTHON: '/auth/python',
        HERMES_AUTH_ROOT: '/auth/root',
        HERMES_AUTH_HOME: '/auth/home',
      }).HERMES_PROVIDER,
    ).toBe('nous');
  });
  it('allows Phase 1 without provider credentials and parses false correctly', () => {
    const config = validateEnvironment({
      ...valid,
      AI_ENABLED: 'false',
      SWAGGER_ENABLED: 'false',
      PORT: '3000',
    });
    expect(config.AI_ENABLED).toBe(false);
    expect(config.SWAGGER_ENABLED).toBe(false);
    expect(config.PORT).toBe(3000);
    expect(config.AI_CHAT_MODEL).toBe('deepseek-flash');
  });

  it.each([
    { AI_HISTORY_AUTO_INDEX_ENABLED: 'true' },
    { AI_EMBEDDING_PROVIDER: 123 },
    { AI_HISTORY_INDEX_DAILY_TEXTS: '-1' },
    { AI_HISTORY_INDEX_SCOPE_DAILY_BYTES: 'NaN' },
    { PORT: 'not-a-number' },
    { PORT: '0' },
    { AI_ENABLED: 'yes' },
    { AI_ENABLED: 'true' },
    { GITHUB_ENABLED: 'true' },
    { AI_CHAT_MODEL: 'another-model' },
    { HERMES_ENABLED: 'true' },
    { APP_ORIGIN: 'http://localhost:43101/path' },
    { NODE_ENV: 'production', SWAGGER_ENABLED: 'true' },
  ])('rejects invalid or unsupported configuration %j', (override) => {
    expect(() => validateEnvironment({ ...valid, ...override })).toThrow(
      'Invalid environment configuration',
    );
  });

  it('names invalid fields without leaking supplied values', () => {
    expect(() => validateEnvironment({ ...valid, DATABASE_URL: 'very-private-secret' })).toThrow(
      'DATABASE_URL',
    );
    expect(() =>
      validateEnvironment({ ...valid, DATABASE_URL: 'very-private-secret' }),
    ).not.toThrow('very-private-secret');
  });

  it('accepts empty string for optional admin credentials and treats as undefined', () => {
    const config = validateEnvironment({
      ...valid,
      INITIAL_ADMIN_EMAIL: '',
      INITIAL_ADMIN_PASSWORD: '',
    });
    expect(config.INITIAL_ADMIN_EMAIL).toBeUndefined();
    expect(config.INITIAL_ADMIN_PASSWORD).toBeUndefined();
  });

  it('accepts valid admin credentials when both are provided', () => {
    const config = validateEnvironment({
      ...valid,
      INITIAL_ADMIN_EMAIL: 'admin@example.com',
      INITIAL_ADMIN_PASSWORD: 'admin-password-123',
    });
    expect(config.INITIAL_ADMIN_EMAIL).toBe('admin@example.com');
    expect(config.INITIAL_ADMIN_PASSWORD).toBe('admin-password-123');
  });

  it('rejects when only one admin bootstrap credential is provided', () => {
    expect(() =>
      validateEnvironment({
        ...valid,
        INITIAL_ADMIN_EMAIL: 'admin@example.com',
        INITIAL_ADMIN_PASSWORD: '',
      }),
    ).toThrow('INITIAL_ADMIN_PASSWORD');

    expect(() =>
      validateEnvironment({
        ...valid,
        INITIAL_ADMIN_EMAIL: '',
        INITIAL_ADMIN_PASSWORD: 'admin-password-123',
      }),
    ).toThrow('INITIAL_ADMIN_EMAIL');
  });

  it('accepts valid Phase 2 AI configuration when credentials and budget are provided', () => {
    const config = validateEnvironment({
      ...valid,
      AI_ENABLED: 'true',
      DEEPSEEK_API_KEY: 'test-deepseek-key',
      AI_DAILY_PROJECT_BUDGET_USD: '25.00',
    });
    expect(config.AI_ENABLED).toBe(true);
    expect(config.DEEPSEEK_API_KEY).toBe('test-deepseek-key');
    expect(config.AI_EMBEDDING_PROVIDER).toBe('ollama');
    expect(config.AI_DAILY_PROJECT_BUDGET_USD).toBe(25);
  });

  it('rejects openai embedding provider when OPENAI_API_KEY is missing and AI is enabled', () => {
    expect(() =>
      validateEnvironment({
        ...valid,
        AI_ENABLED: 'true',
        DEEPSEEK_API_KEY: 'test-deepseek-key',
        AI_EMBEDDING_PROVIDER: 'openai',
        AI_DAILY_PROJECT_BUDGET_USD: '25.00',
      }),
    ).toThrow('OPENAI_API_KEY');
  });
  it('rejects mock providers in a running development workspace', () => {
    expect(() =>
      validateEnvironment({ ...valid, NODE_ENV: 'development', AI_EMBEDDING_PROVIDER: 'mock' }),
    ).toThrow();
    expect(() =>
      validateEnvironment({ ...valid, NODE_ENV: 'development', GITHUB_USE_MOCK: 'true' }),
    ).toThrow();
  });

  it('bounds the optional large-library request budget', () => {
    expect(
      validateEnvironment({ ...valid, OSCAR_KNOWLEDGE_TIMEOUT_MS: '25000' })
        .OSCAR_KNOWLEDGE_TIMEOUT_MS,
    ).toBe(25000);
    expect(() => validateEnvironment({ ...valid, OSCAR_KNOWLEDGE_TIMEOUT_MS: '30001' })).toThrow();
    expect(validateEnvironment(valid).OSCAR_KNOWLEDGE_TIMEOUT_MS).toBe(2500);
  });

  it('treats empty strings as defaults for AI configuration fields', () => {
    const config = validateEnvironment({
      ...valid,
      AI_LLM_PROVIDER: '',
      AI_CHAT_MODEL: '',
      AI_EMBEDDING_PROVIDER: '',
    });
    expect(config.AI_LLM_PROVIDER).toBe('deepseek');
    expect(config.AI_CHAT_MODEL).toBe('deepseek-flash');
    expect(config.AI_EMBEDDING_PROVIDER).toBe('ollama');
  });
});
