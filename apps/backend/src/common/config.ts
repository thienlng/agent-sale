import { z } from 'zod';

/**
 * Environment schema. The process refuses to start when a required variable is
 * missing or malformed — no silent defaults in production (docs/10 §1).
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: z.string().url().optional(),
  DATABASE_SYSTEM_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
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
});
export type Env = z.infer<typeof EnvSchema>;

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
