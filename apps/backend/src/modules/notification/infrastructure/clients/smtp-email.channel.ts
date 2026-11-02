import { notificationStrings } from '@agent-sales/i18n/notification';
import nodemailer from 'nodemailer';

import type {
  NotificationChannel,
  OutgoingMessage,
} from '../../domain/ports/notification-channel.port.js';

/** Rapiz orange (brand), the header bar of notification emails. */
export const EMAIL_BRAND_COLOR = '#F97316';

/** The part of nodemailer the channel uses (a fake in tests). */
export interface MailTransport {
  sendMail(m: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<{ messageId?: string }>;
}

export interface SmtpEmailConfig {
  /** `smtp://` / `smtps://` URL with credentials; unset turns email off (S3-R7). */
  smtpUrl: string | undefined;
  from: string;
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/** Plain text and a minimal escaped HTML version of a notification email. */
export function renderEmail(m: OutgoingMessage): { text: string; html: string } {
  const strings = notificationStrings(m.locale);
  const footer = strings['email.footer'] ?? '';
  const text = m.link ? `${m.body}\n\n${footer}: ${m.link}` : m.body;
  const paragraphs = m.body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const footerHtml = m.link
    ? `<p style="margin:24px 0 0;font-size:13px"><a href="${escapeHtml(m.link)}" style="color:${EMAIL_BRAND_COLOR}">${escapeHtml(footer)}</a></p>`
    : '';
  const html =
    `<!doctype html><html><body style="margin:0;font-family:Arial,sans-serif;color:#111">` +
    `<div style="background:${EMAIL_BRAND_COLOR};height:6px"></div>` +
    `<div style="padding:24px;max-width:560px">` +
    `<h1 style="font-size:18px;margin:0 0 16px">${escapeHtml(m.title)}</h1>` +
    `${paragraphs}${footerHtml}</div></body></html>`;
  return { text, html };
}

/**
 * Email over SMTP (`nodemailer`, S3-R7). The transport is built once, and only when `SMTP_URL`
 * is set. Never logs the address, the title or the body.
 */
export class SmtpEmailChannel implements NotificationChannel {
  readonly kind = 'email' as const;
  readonly #transport: MailTransport | null;

  constructor(
    private readonly config: SmtpEmailConfig,
    createTransport: (url: string) => MailTransport = (url) => nodemailer.createTransport(url),
  ) {
    this.#transport = config.smtpUrl ? createTransport(config.smtpUrl) : null;
  }

  available(): boolean {
    return this.#transport !== null;
  }

  async send(m: OutgoingMessage): Promise<{ providerMessageId: string | null }> {
    if (!this.#transport) throw new EmailDisabledError();
    const { text, html } = renderEmail(m);
    const info = await this.#transport.sendMail({
      from: this.config.from,
      to: m.to,
      subject: m.title,
      text,
      html,
    });
    return { providerMessageId: info.messageId ?? null };
  }
}

export class EmailDisabledError extends Error {
  constructor() {
    super('email channel is off');
    this.name = 'EmailDisabledError';
  }
}
