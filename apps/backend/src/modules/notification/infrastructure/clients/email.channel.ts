import { notificationStrings } from '@agent-sales/i18n/notification';

import type { Mailer } from '../../../../common/email/mailer.js';

import type {
  NotificationChannel,
  OutgoingMessage,
} from '../../domain/ports/notification-channel.port.js';

/** Rapiz Orange (brand identity v2), the header bar of notification emails. */
export const EMAIL_BRAND_COLOR = '#FF7A45';
/** Accessible orange for link text on white (5.4:1); Rapiz Orange itself is 2.6:1. */
export const EMAIL_LINK_COLOR = '#B54708';
/** Charcoal, the brand text colour. */
const EMAIL_TEXT_COLOR = '#1F1F1F';

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
    ? `<p style="margin:24px 0 0;font-size:13px"><a href="${escapeHtml(m.link)}" style="color:${EMAIL_LINK_COLOR}">${escapeHtml(footer)}</a></p>`
    : '';
  const html =
    `<!doctype html><html><body style="margin:0;font-family:Arial,sans-serif;color:${EMAIL_TEXT_COLOR}">` +
    `<div style="background:${EMAIL_BRAND_COLOR};height:6px"></div>` +
    `<div style="padding:24px;max-width:560px">` +
    `<h1 style="font-size:18px;margin:0 0 16px">${escapeHtml(m.title)}</h1>` +
    `${paragraphs}${footerHtml}</div></body></html>`;
  return { text, html };
}

/**
 * Email through the backend's transactional `Mailer` (Resend, ADR-023), the same provider as the
 * signup codes. Built with no mailer (`RESEND_API_KEY` unset), the channel is off. Never logs the
 * address, the title or the body; Resend gives no message id back through the port.
 */
export class MailerEmailChannel implements NotificationChannel {
  readonly kind = 'email' as const;

  constructor(private readonly mailer: Mailer | null) {}

  available(): boolean {
    return this.mailer !== null;
  }

  async send(m: OutgoingMessage): Promise<{ providerMessageId: string | null }> {
    if (!this.mailer) throw new EmailDisabledError();
    const { text, html } = renderEmail(m);
    await this.mailer.send({ to: m.to, subject: m.title, text, html });
    return { providerMessageId: null };
  }
}

export class EmailDisabledError extends Error {
  constructor() {
    super('email channel is off');
    this.name = 'EmailDisabledError';
  }
}
