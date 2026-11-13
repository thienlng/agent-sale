import { isIP } from 'node:net';

import { parseTrustProxy } from '@agent-sales/shared';
import { z } from 'zod';

/** A non-negative limit with a default; 0 disables the limit. */
function limitVar(fallback: number) {
  return z.coerce.number().int().min(0).default(fallback);
}

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
    /** Direct (non-PgBouncer) connection for LISTEN; defaults to DATABASE_SYSTEM_URL. */
    DATABASE_LISTEN_URL: z.string().url().optional(),
    /**
     * The owner assistant's read-only SQL lane (T-171): its own login, a member of
     * `app_assistant_sql` only. Unset = no SQL tools in the assistant's catalog.
     */
    DATABASE_ASSISTANT_SQL_URL: z.string().url().optional(),
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
    /**
     * Customer-image vision for the bot (T-053). On by default outside production; in production
     * it stays off unless set to `true` (images go to the model provider; the ChatGPT-plan login
     * behind Hermes is for testing only).
     */
    BOT_IMAGE_VISION: z.enum(['true', 'false']).optional(),
    /**
     * `true`: a member's manual reply on Messenger/Instagram between 24 hours and 7 days after the
     * customer's last message goes out with the `HUMAN_AGENT` tag (needs Meta's Human Agent
     * permission; ADR-031). Off by default; bots and the care agent never use the tag.
     */
    META_HUMAN_AGENT_TAG: z.enum(['true', 'false']).optional(),
    /**
     * `true`: the bot's replies pass the number guard before sending (docs/06 §3.3): a money figure
     * or a number ≥ 1000 found in no trusted text makes the model rewrite once, then the fallback
     * line is sent. Off by default: ADR-015 took the guard off the reply path and ADR-032 asks the
     * owner to turn it back on.
     */
    BOT_REPLY_FIGURE_GUARD: z.enum(['true', 'false']).optional(),
    /**
     * Comma-separated extra hosts the customer-image fetcher may reach (dev/test only, ignored in
     * production). They are exempt from the private-address block and may use plain http, so
     * tests can serve images from a loopback server.
     */
    BOT_IMAGE_EXTRA_HOSTS: z.string().max(1000).optional(),
    /**
     * Dev/QA only: comma-separated hosts the action executor may call over plain http without
     * the public-address check (for example a local fake shop). Ignored in production.
     */
    ACTION_DEV_ALLOW_HTTP_HOSTS: z.string().max(1000).optional(),
    S3_ENDPOINT: z.url().optional(),
    S3_BUCKET: z.string().min(1).optional(),
    S3_PUBLIC_URL: z.url({ protocol: /^https$/ }).optional(),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    /** Private bucket of whole-workspace data exports (SET-10); default `<S3_BUCKET>-exports`. */
    S3_EXPORT_BUCKET: z.string().min(1).optional(),
    /** KiotViet OAuth token endpoint (PMS integration); override only for a fake in tests. */
    KIOTVIET_TOKEN_URL: z.url().default('https://id.kiotviet.vn/connect/token'),
    /** KiotViet public API base URL (PMS integration). */
    KIOTVIET_API_URL: z.url().default('https://public.kiotapi.com'),
    /**
     * Public HTTPS origin of the webhook ingress (apps/webhook), e.g. `https://hooks.example.com`.
     * PMS webhooks are registered at `${PUBLIC_WEBHOOK_BASE_URL}/webhooks/kiotviet/<token>`; unset,
     * none are registered and the 10-minute reconcile alone keeps synced data fresh.
     */
    PUBLIC_WEBHOOK_BASE_URL: z.url({ protocol: /^https?$/ }).optional(),
    /**
     * The Rapiz HQ business (ADR-021): the SaaS workspace where Rapiz sells Rapiz. Platform accounts
     * are mirrored into it as customers with subscriptions. Unset turns the HQ sync off. Create it
     * with `pnpm --filter @agent-sales/backend hq-init <owner email>`.
     */
    RAPIZ_HQ_WORKSPACE_ID: z.uuid().optional(),
    /**
     * Resend API key for transactional email (sign-up and password-reset codes, ADR-023). Unset,
     * no email leaves: development prints it to the log, production logs a warning. Notification
     * emails (T-172) use the same key: unset, they are skipped and the UI says email is unavailable.
     */
    RESEND_API_KEY: z.string().min(1).optional(),
    /** Sender of transactional email; its domain must be verified in Resend. */
    EMAIL_FROM: z.string().min(3).default('Rapiz <noreply@rapiz.io>'),
    /**
     * Development only: without `RESEND_API_KEY`, every email is also written as a JSON file to this
     * directory, so the live-backend e2e suite can read signup codes. Refused in production.
     */
    MAIL_OUTBOX_DIR: z.string().min(1).optional(),
    /**
     * Web Push (T-190): VAPID key pair (`npx web-push generate-vapid-keys`) and the contact the
     * push services may reach (`mailto:` or `https:`). Unset, push deliveries are skipped and the
     * app offers no device notifications.
     */
    WEB_PUSH_PUBLIC_KEY: z.string().min(40).optional(),
    WEB_PUSH_PRIVATE_KEY: z.string().min(20).optional(),
    WEB_PUSH_SUBJECT: z
      .string()
      .regex(/^(mailto:|https:\/\/)/)
      .default('mailto:support@rapiz.io'),
    /** Public HTTPS origin of the dashboard, for links in emails; unset leaves links out. */
    APP_PUBLIC_URL: z.url({ protocol: /^https$/ }).optional(),
    /**
     * Sign in with Google (OAuth web client from Google Cloud). Both unset: the login page shows
     * the Google button as coming soon. The redirect URI must be registered on the client exactly;
     * unset, it is the first `APP_ORIGINS` entry + `/api/v1/auth/google/callback`.
     */
    GOOGLE_CLIENT_ID: z.string().min(10).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(10).optional(),
    GOOGLE_REDIRECT_URI: z.url().optional(),
    /**
     * How long each API process trusts what it read about a session (revoked, two-factor, last
     * authentication) before reading it again. A logout or password reset reaches the other
     * processes within this time; 0 reads the session on every request.
     */
    AUTH_SESSION_CACHE_TTL_MS: z.coerce.number().int().min(0).max(60_000).default(15_000),
    /** How recent a password, code or Google sign-in must be for a step-up protected action. */
    AUTH_STEP_UP_WINDOW_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
    /**
     * Abuse and spend limits (security audit 2026-11-12 #2, #3, #15, #17, #18). Every limit has a
     * generous default; 0 turns that limit off. Counters live in Redis when `REDIS_URL` is set.
     * See docs/08 §"Abuse caps" and docs/16 for the reasoning behind each default.
     */
    /**
     * AI replies to anonymous website-chat visitors (no lead or contact), per site and per
     * workspace. Every website reply counts against these windows; all website replies together
     * (visitors with a lead included) may use `WEBCHAT_AI_REPLIES_KNOWN_FACTOR` times as much.
     */
    WEBCHAT_AI_REPLIES_SITE_HOUR: limitVar(300),
    WEBCHAT_AI_REPLIES_SITE_DAY: limitVar(2000),
    WEBCHAT_AI_REPLIES_WORKSPACE_HOUR: limitVar(600),
    WEBCHAT_AI_REPLIES_WORKSPACE_DAY: limitVar(4000),
    WEBCHAT_AI_REPLIES_KNOWN_FACTOR: z.coerce.number().int().min(1).max(20).default(4),
    /** Bot replies to one customer (contact) per hour, across all of its conversations. */
    CONTACT_BOT_REPLIES_HOUR: limitVar(60),
    /** Images website-chat visitors may upload per site per day. */
    WEBCHAT_UPLOADS_SITE_DAY: limitVar(500),
    /**
     * Optional Cloudflare Turnstile for new website-chat visitors. Off unless both are set: the
     * widget then loads the challenge and the API verifies it on a new visitor's first send/upload.
     */
    TURNSTILE_SITE_KEY: z.string().min(10).optional(),
    TURNSTILE_SECRET: z.string().min(10).optional(),
    /** Inbox runner: conversations answered in parallel per agent process. */
    INBOX_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(8),
    /** Inbox runner: events one workspace may take in a single claim. */
    INBOX_CLAIM_PER_WORKSPACE: z.coerce.number().int().min(1).max(100).default(5),
    /** Inbox runner: customer turns per workspace per minute (token bucket), and its burst. */
    INBOX_TURNS_WORKSPACE_MINUTE: limitVar(120),
    INBOX_TURNS_WORKSPACE_BURST: z.coerce.number().int().min(1).default(30),
    /** Bot replies in one conversation per hour before it is handed to staff. */
    CONVERSATION_BOT_REPLIES_HOUR: limitVar(30),
    /** Model calls and tokens one conversation may spend per hour (every call, delivered or not). */
    CONVERSATION_MODEL_CALLS_HOUR: limitVar(150),
    CONVERSATION_TOKENS_HOUR: limitVar(3_000_000),
    /** Tokens an account's owners may spend per day on the bot playground and the assistant. */
    OWNER_LLM_TOKENS_ACCOUNT_DAY: limitVar(5_000_000),
    /** Playground runs per user per minute. */
    PLAYGROUND_RUNS_USER_MINUTE: limitVar(10),
    /** Assistant turns one user may have running at once, across threads. */
    ASSISTANT_RUNS_PER_USER: limitVar(2),
    /** Orders and lodging holds the bot may create for one customer per day. */
    BOT_ORDERS_CONTACT_DAY: limitVar(10),
    BOT_HOLDS_CONTACT_DAY: limitVar(3),
    /**
     * Orders and holds per workspace and day from conversations without a contact (anonymous
     * visitors): their per-customer key is the conversation, which a visitor can rotate.
     */
    BOT_ANON_ORDERS_WORKSPACE_DAY: limitVar(30),
    BOT_ANON_HOLDS_WORKSPACE_DAY: limitVar(10),
    /**
     * Proxies whose `X-Forwarded-For` entry is believed (`parseTrustProxy` in packages/shared):
     * `false` or comma-separated addresses/CIDRs. Unset: the private ranges in production (NPM →
     * Caddy `edge` on Docker networks), loopback elsewhere. `true` and hop counts are refused.
     */
    TRUST_PROXY: z.string().max(500).optional(),
    /**
     * Comma-separated email domains whose new accounts get no signup trial (disposable inboxes),
     * added to the built-in list in `identity/domain/trial-identity.ts`. Signup itself still works.
     */
    TRIAL_BLOCKED_EMAIL_DOMAINS: z.string().max(5000).optional(),
  })
  .refine((env) => !env.TURNSTILE_SITE_KEY === !env.TURNSTILE_SECRET, {
    message: 'Set both TURNSTILE_SITE_KEY and TURNSTILE_SECRET, or neither',
    path: ['TURNSTILE_SECRET'],
  })
  .superRefine((env, ctx) => {
    const error = trustProxyError(env.TRUST_PROXY, env.NODE_ENV);
    if (error) ctx.addIssue({ code: 'custom', message: error, path: ['TRUST_PROXY'] });
  })
  .refine((env) => !env.GOOGLE_CLIENT_ID === !env.GOOGLE_CLIENT_SECRET, {
    message: 'Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither',
    path: ['GOOGLE_CLIENT_SECRET'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || !!env.SECRETS_ENCRYPTION_KEY, {
    message: 'SECRETS_ENCRYPTION_KEY is required in production',
    path: ['SECRETS_ENCRYPTION_KEY'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || !env.MAIL_OUTBOX_DIR, {
    message: 'MAIL_OUTBOX_DIR is for development only',
    path: ['MAIL_OUTBOX_DIR'],
  });
export type Env = z.infer<typeof EnvSchema>;

/** The startup error for a bad `TRUST_PROXY` (it names the bad entry), or null when it is valid. */
function trustProxyError(raw: string | undefined, nodeEnv: string): string | null {
  try {
    parseTrustProxy(raw, nodeEnv, isIP);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Whether the Hermes subscription sign-in is available in this environment. */
export function hermesSubscriptionLoginEnabled(
  env: Pick<Env, 'NODE_ENV' | 'HERMES_SUBSCRIPTION_LOGIN'>,
): boolean {
  if (env.HERMES_SUBSCRIPTION_LOGIN) return env.HERMES_SUBSCRIPTION_LOGIN === 'true';
  return env.NODE_ENV !== 'production';
}

/** Whether the bot may look at customer images in this environment. */
export function botImageVisionEnabled(env: Pick<Env, 'NODE_ENV' | 'BOT_IMAGE_VISION'>): boolean {
  if (env.BOT_IMAGE_VISION) return env.BOT_IMAGE_VISION === 'true';
  return env.NODE_ENV !== 'production';
}

/** Extra image hosts for tests; always empty in production. */
export function botImageExtraHosts(env: Pick<Env, 'NODE_ENV' | 'BOT_IMAGE_EXTRA_HOSTS'>): string[] {
  if (env.NODE_ENV === 'production') return [];
  return (env.BOT_IMAGE_EXTRA_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/** Hosts the action executor may call over plain http; always empty in production. */
export function actionDevAllowHttpHosts(
  env: Pick<Env, 'NODE_ENV' | 'ACTION_DEV_ALLOW_HTTP_HOSTS'>,
): string[] {
  if (env.NODE_ENV === 'production') return [];
  return (env.ACTION_DEV_ALLOW_HTTP_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
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
