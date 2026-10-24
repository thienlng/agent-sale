import { z } from 'zod';

/**
 * Environment schema. The process refuses to start when a required variable is
 * missing or malformed — no silent defaults in production (docs/10 §1).
 */
export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
    DATABASE_URL: z.string().url().optional(),
    DATABASE_SYSTEM_URL: z.string().url().optional(),
    REDIS_URL: z.string().url().optional(),
    META_APP_ID: z.string().optional(),
    META_APP_SECRET: z.string().optional(),
    META_LOGIN_CONFIG_ID: z.string().optional(),
    META_GRAPH_VERSION: z
      .string()
      .regex(/^v\d+\.\d+$/)
      .default('v24.0'),
    INSTAGRAM_APP_ID: z.string().optional(),
    INSTAGRAM_APP_SECRET: z.string().optional(),
    META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
    META_APP_ORIGIN: z.string().url().optional(),
    /**
     * Exact OAuth redirect URI registered on the Meta app, with `{provider}` placeholder.
     * Defaults to `${META_APP_ORIGIN}/api/v1/channels/oauth/{provider}/callback`.
     */
    META_OAUTH_REDIRECT_URI: z
      .string()
      .regex(/^https:\/\/\S+\{provider\}\S*$/)
      .optional(),
    APP_VERSION: z.string().default('0.0.0-dev'),
    JWT_PRIVATE_KEY: z.string().optional(),
    JWT_PUBLIC_KEY: z.string().optional(),
    JWT_KEY_ID: z.string().optional(),
    /** Comma-separated origins allowed to use the cookie refresh endpoint. */
    APP_ORIGINS: z.string().default('http://localhost:5173'),
    /** Force the Secure cookie flag outside production (e.g. HTTPS staging). */
    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    /**
     * 32 bytes, base64 (`openssl rand -base64 32`). Encrypts secrets stored in the
     * database (LLM API keys). Required in production; development falls back to
     * a fixed insecure key.
     */
    SECRETS_ENCRYPTION_KEY: z.string().optional(),
    /**
     * ChatGPT-subscription sign-in of the Hermes runtime from Admin → LLM (T-052). Enabled by
     * default outside production; in production it stays off unless set to `true` (the
     * ChatGPT-plan eligibility for a hosted product is an open owner decision).
     */
    HERMES_SUBSCRIPTION_LOGIN: z.enum(['true', 'false']).optional(),
    S3_ENDPOINT: z.url().optional(),
    S3_BUCKET: z.string().min(1).optional(),
    S3_PUBLIC_URL: z.url({ protocol: /^https$/ }).optional(),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
  })
  .refine((env) => env.NODE_ENV !== 'production' || !!env.SECRETS_ENCRYPTION_KEY, {
    message: 'SECRETS_ENCRYPTION_KEY is required in production',
    path: ['SECRETS_ENCRYPTION_KEY'],
  });
export type Env = z.infer<typeof EnvSchema>;

/** Whether the Hermes subscription sign-in is available in this environment. */
export function hermesSubscriptionLoginEnabled(
  env: Pick<Env, 'NODE_ENV' | 'HERMES_SUBSCRIPTION_LOGIN'>,
): boolean {
  if (env.HERMES_SUBSCRIPTION_LOGIN) return env.HERMES_SUBSCRIPTION_LOGIN === 'true';
  return env.NODE_ENV !== 'production';
}

/** Parses and validates an environment source. Throws with every issue listed. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
}

let runtimeEnv: Env | undefined;

/**
 * Sets the environment for this process once, at boot (entries, createHttpApp,
 * tests). Providers read it with getEnv() — never process.env directly — so
 * tests can inject their own configuration.
 */
export function configureEnv(source: NodeJS.ProcessEnv = process.env): Env {
  runtimeEnv = loadEnv(source);
  return runtimeEnv;
}

export function getEnv(): Env {
  return runtimeEnv ?? configureEnv();
}

export const ENV = Symbol('ENV');
