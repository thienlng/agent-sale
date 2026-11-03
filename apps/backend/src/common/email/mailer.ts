import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Sends transactional email (ADR-023). Throws when the provider refuses or cannot be reached. */
export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}
export const MAILER = Symbol('MAILER');

const RESEND_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

/** Resend's HTTP API; no SDK. Logs the status only, never the address or the content. */
export class ResendMailer implements Mailer {
  readonly #log = new Logger(ResendMailer.name);

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const res = await this.fetchFn(RESEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      this.#log.error(`Resend refused an email: HTTP ${res.status}`);
      throw new Error(`Email provider answered ${res.status}`);
    }
  }
}

/**
 * No provider configured. Tests read `sent`; development also prints the text (it carries the
 * code) so a local signup can be finished, and with `outboxDir` writes each message there as JSON
 * (the live-backend e2e suite reads codes from it); production logs a warning without any content.
 */
export class LocalMailer implements Mailer {
  readonly #log = new Logger(LocalMailer.name);
  readonly sent: EmailMessage[] = [];

  constructor(
    private readonly nodeEnv: string,
    private readonly outboxDir?: string | undefined,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    if (this.nodeEnv === 'test') {
      this.sent.push(message);
      return;
    }
    if (this.nodeEnv === 'development') {
      if (this.outboxDir) {
        await mkdir(this.outboxDir, { recursive: true });
        const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
        await writeFile(join(this.outboxDir, name), JSON.stringify(message));
      }
      this.#log.log(`Email (not sent, no RESEND_API_KEY): ${message.subject}\n${message.text}`);
      return;
    }
    this.#log.warn('Email not sent: RESEND_API_KEY is not set');
  }
}

export function createMailer(env: {
  NODE_ENV: string;
  RESEND_API_KEY?: string | undefined;
  EMAIL_FROM: string;
  MAIL_OUTBOX_DIR?: string | undefined;
}): Mailer {
  return env.RESEND_API_KEY
    ? new ResendMailer(env.RESEND_API_KEY, env.EMAIL_FROM)
    : new LocalMailer(env.NODE_ENV, env.MAIL_OUTBOX_DIR);
}
