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
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
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
    STORAGE_DRIVER: z.literal('local').default('local'),
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
    GITHUB_ENABLED: booleanString.default(false),
    GITHUB_APP_ID: emptyStringToUndefined(z.string().optional()),
    GITHUB_APP_PRIVATE_KEY_FILE: emptyStringToUndefined(z.string().optional()),
    GITHUB_CLIENT_ID: emptyStringToUndefined(z.string().optional()),
    GITHUB_CLIENT_SECRET: emptyStringToUndefined(z.string().optional()),
    GITHUB_CALLBACK_STATE_SECRET: emptyStringToUndefined(z.string().optional()),
    GITHUB_USE_MOCK: booleanString.default(false),
    REDIS_URL: z.string().default('redis://127.0.0.1:56379'),
    AI_LLM_PROVIDER: emptyStringToUndefined(z.literal('deepseek').default('deepseek')),
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
