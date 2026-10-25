import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');
const postgresUrl = z
  .string()
  .url()
  .refine((value) => /^postgres(?:ql)?:\/\//.test(value));

const emptyStringToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema,
  );

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(43101),
    HOST: z
      .string()
      .min(1)
      .default('0.0.0.0')
      .transform((val) =>
        process.env.RENDER || process.env.NODE_ENV === 'production' ? '0.0.0.0' : val,
      ),
    APP_ORIGIN: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
      }),
    DATABASE_URL: postgresUrl,
    PLATFORM_CREDENTIAL_KEY: emptyStringToUndefined(
      z
        .string()
        .regex(/^[A-Za-z0-9+/]{43}=$/)
        .refine((value) => Buffer.from(value, 'base64').length === 32)
        .optional(),
    ),
    PLATFORM_ALLOWED_ORIGINS: z.string().optional(),
    PLATFORM_OAUTH_CALLBACK_ORIGIN: emptyStringToUndefined(z.string().url().optional()),
    STORAGE_DRIVER: z.literal('local').default('local'),
    FOLDER_STORAGE_QUOTA_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .default(20 * 1024 ** 3),
    FOLDER_MAX_FILE_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(8 * 1024 ** 3)
      .default(1024 ** 3),
    FOLDER_MAX_FILES: z.coerce.number().int().min(1).max(1000000).default(100000),
    FOLDER_MAX_SOURCES: z.coerce.number().int().min(1).max(10000).default(100),
    STORAGE_LOCAL_ROOT: z.string().min(1).default('./var/uploads'),
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().max(20971520).default(20971520),
    SESSION_IDLE_HOURS: z.coerce.number().int().min(1).default(8),
    SESSION_ABSOLUTE_DAYS: z.coerce.number().int().min(1).default(7),
    INITIAL_ADMIN_EMAIL: emptyStringToUndefined(z.string().email().optional()),
    INITIAL_ADMIN_PASSWORD: emptyStringToUndefined(z.string().min(8).optional()),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    SWAGGER_ENABLED: booleanString.default(false),
    AI_ENABLED: booleanString.default(false),
    OSCAR_KNOWLEDGE_ENABLED: booleanString.default(false),
    OSCAR_KNOWLEDGE_BASE_URL: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (
          ['http:', 'https:'].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          url.pathname === '/'
        );
      })
      .default('http://127.0.0.1:8010'),
    OSCAR_KNOWLEDGE_SERVICE_TOKEN: z.string().default(''),
    OSCAR_KNOWLEDGE_PRIVATE_SCOPE_SECRET: z.string().default(''),
    OSCAR_KNOWLEDGE_COLLECTION: z.string().min(1).max(100).default('mba-business'),
    OSCAR_KNOWLEDGE_TIMEOUT_MS: z.coerce.number().int().min(100).max(10000).default(2500),
    LOCAL_FILES_ENABLED: booleanString.default(false),
    LOCAL_FILES_REGISTRY: z.string().min(1).default('./var/local-folders.json'),
    HERMES_ENABLED: booleanString.default(false),
    HERMES_PYTHON: emptyStringToUndefined(z.string().optional()),
    HERMES_ROOT: emptyStringToUndefined(z.string().optional()),
    HERMES_PROVIDER: z.enum(['deepseek', 'nous']).default('deepseek'),
    HERMES_MODEL: emptyStringToUndefined(z.string().min(1).max(255).optional()),
    HERMES_AUTH_PYTHON: emptyStringToUndefined(z.string().optional()),
    HERMES_AUTH_ROOT: emptyStringToUndefined(z.string().optional()),
    HERMES_AUTH_HOME: emptyStringToUndefined(z.string().optional()),
    GITHUB_ENABLED: booleanString.default(false),
    GITHUB_APP_ID: emptyStringToUndefined(z.string().optional()),
    GITHUB_APP_PRIVATE_KEY_FILE: emptyStringToUndefined(z.string().optional()),
    GITHUB_CLIENT_ID: emptyStringToUndefined(z.string().optional()),
    GITHUB_CLIENT_SECRET: emptyStringToUndefined(z.string().optional()),
    GITHUB_CALLBACK_STATE_SECRET: emptyStringToUndefined(z.string().optional()),
    GITHUB_USE_MOCK: booleanString.default(false),
    REDIS_URL: z.string().default('redis://127.0.0.1:43106'),
    AI_LLM_PROVIDER: emptyStringToUndefined(z.literal('deepseek').default('deepseek')),
    AI_CONTEXT_INPUT_BUDGET: z.coerce.number().int().min(16000).max(512000).default(128000),
    AI_HISTORY_MAX_COSINE_DISTANCE: z.coerce.number().min(0).max(2).default(0.65),
    AI_HISTORY_AUTO_INDEX_ENABLED: booleanString.default(false),
    AI_HISTORY_INDEX_DAILY_TEXTS: z.coerce.number().int().min(0).max(100000).default(256),
    AI_HISTORY_INDEX_DAILY_BYTES: z.coerce.number().int().min(0).max(100000000).default(512000),
    AI_HISTORY_INDEX_SCOPE_DAILY_TEXTS: z.coerce.number().int().min(0).max(100000).default(64),
    AI_HISTORY_INDEX_SCOPE_DAILY_BYTES: z.coerce
      .number()
      .int()
      .min(0)
      .max(100000000)
      .default(128000),
    DEEPSEEK_API_KEY: emptyStringToUndefined(z.string().optional()),
    DEEPSEEK_BASE_URL: emptyStringToUndefined(
      z.literal('https://api.deepseek.com').default('https://api.deepseek.com'),
    ),
    AI_CHAT_MODEL: emptyStringToUndefined(
      z.enum(['deepseek-flash', 'deepseek-v4-pro']).default('deepseek-flash'),
    ),
    AI_EMBEDDING_PROVIDER: emptyStringToUndefined(
      z.enum(['disabled', 'mock', 'openai']).default('disabled'),
    ),
    OPENAI_API_KEY: emptyStringToUndefined(z.string().optional()),
    OPENAI_EMBEDDING_BASE_URL: z.string().default('https://api.openai.com/v1'),
    AI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
    AI_EMBEDDING_DIMENSIONS: z.coerce.number().int().default(1536),
    AI_DAILY_PROJECT_BUDGET_USD: emptyStringToUndefined(z.coerce.number().optional()),
    SUPABASE_URL: emptyStringToUndefined(z.string().url().optional()),
    SUPABASE_PUBLISHABLE_KEY: emptyStringToUndefined(z.string().optional()),
    SUPABASE_SECRET_KEY: emptyStringToUndefined(z.string().optional()),
    SUPABASE_JWKS_URL: emptyStringToUndefined(z.string().url().optional()),
  })
  .superRefine((value, context) => {
    if (
      value.AI_HISTORY_AUTO_INDEX_ENABLED &&
      (!value.AI_ENABLED ||
        value.AI_EMBEDDING_PROVIDER !== 'openai' ||
        !value.OPENAI_API_KEY ||
        value.AI_EMBEDDING_DIMENSIONS !== 1536)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['AI_HISTORY_AUTO_INDEX_ENABLED'],
        message:
          'History indexing requires AI_ENABLED and a configured 1536-dimensional embedding provider.',
      });
    }
    if (value.HERMES_ENABLED && (!value.AI_ENABLED || !value.HERMES_PYTHON || !value.HERMES_ROOT)) {
      context.addIssue({
        code: 'custom',
        path: ['HERMES_ENABLED'],
        message: 'Hermes requires AI_ENABLED, HERMES_PYTHON and HERMES_ROOT.',
      });
    }
    if (
      value.HERMES_ENABLED &&
      value.HERMES_PROVIDER === 'nous' &&
      (!value.HERMES_MODEL?.endsWith(':free') ||
        !value.HERMES_AUTH_PYTHON ||
        !value.HERMES_AUTH_ROOT ||
        !value.HERMES_AUTH_HOME)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['HERMES_PROVIDER'],
        message:
          'Nous Hermes requires a :free HERMES_MODEL and prepared HERMES_AUTH_PYTHON, HERMES_AUTH_ROOT and HERMES_AUTH_HOME.',
      });
    }
    if (
      value.NODE_ENV !== 'test' &&
      (value.AI_EMBEDDING_PROVIDER === 'mock' || value.GITHUB_USE_MOCK)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['AI_EMBEDDING_PROVIDER'],
        message: 'Mock providers are only available in tests.',
      });
    }
    if (value.GITHUB_ENABLED && !value.GITHUB_USE_MOCK) {
      if (!value.GITHUB_APP_ID && !value.GITHUB_CLIENT_ID) {
        context.addIssue({
          code: 'custom',
          path: ['GITHUB_APP_ID'],
          message: 'GITHUB_APP_ID or GITHUB_CLIENT_ID is required when GITHUB_ENABLED is true.',
        });
      }
    }

    if (value.AI_ENABLED) {
      if (!value.DEEPSEEK_API_KEY) {
        context.addIssue({
          code: 'custom',
          path: ['DEEPSEEK_API_KEY'],
          message: 'DEEPSEEK_API_KEY is required when AI_ENABLED is true.',
        });
      }
      if (value.AI_EMBEDDING_PROVIDER === 'openai' && !value.OPENAI_API_KEY) {
        context.addIssue({
          code: 'custom',
          path: ['OPENAI_API_KEY'],
          message:
            'OPENAI_API_KEY is required when AI_EMBEDDING_PROVIDER is openai and AI_ENABLED is true.',
        });
      }
      if (value.AI_DAILY_PROJECT_BUDGET_USD === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['AI_DAILY_PROJECT_BUDGET_USD'],
          message:
            'Configure nonempty AI_DAILY_PROJECT_BUDGET_USD explicitly before enabling paid AI.',
        });
      }
    }

    if (value.NODE_ENV === 'production' && value.SWAGGER_ENABLED) {
      context.addIssue({
        code: 'custom',
        path: ['SWAGGER_ENABLED'],
        message: 'Public documentation must be disabled in production.',
      });
    }
    const hasAdminEmail = Boolean(value.INITIAL_ADMIN_EMAIL);
    const hasAdminPassword = Boolean(value.INITIAL_ADMIN_PASSWORD);
    if (hasAdminEmail !== hasAdminPassword) {
      context.addIssue({
        code: 'custom',
        path: [hasAdminEmail ? 'INITIAL_ADMIN_PASSWORD' : 'INITIAL_ADMIN_EMAIL'],
        message: 'Both INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD must be provided together.',
      });
    }
  });

export type Environment = z.infer<typeof schema>;

export function validateEnvironment(input: Record<string, unknown>): Environment {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    // Values and Zod's raw error are deliberately omitted: input may contain secrets.
    throw new Error(`Invalid environment configuration: ${fields.join(', ')}`);
  }
  return parsed.data;
}
