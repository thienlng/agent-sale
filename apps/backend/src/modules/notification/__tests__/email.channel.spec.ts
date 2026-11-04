import { describe, expect, it, vi } from 'vitest';

import type { Mailer } from '../../../common/email/mailer.js';
import {
  EMAIL_BRAND_COLOR,
  EmailDisabledError,
  MailerEmailChannel,
  renderEmail,
} from '../infrastructure/clients/email.channel.js';

const message = {
  to: 'lan@example.test',
  locale: 'vi' as const,
  title: 'Doanh thu <hôm qua>',
  body: 'Doanh thu: 1.250.000 ₫\n<script>alert(1)</script>\n\nĐơn: 3',
  link: 'https://app.rapiz.test/app',
};

describe('MailerEmailChannel', () => {
  it('is off without a mailer (no RESEND_API_KEY) and refuses to send', async () => {
    const off = new MailerEmailChannel(null);
    expect(off.available()).toBe(false);
    await expect(off.send(message)).rejects.toBeInstanceOf(EmailDisabledError);
  });

  it('sends text and escaped HTML through the mailer with the title as the subject', async () => {
    const send = vi.fn<Mailer['send']>(async () => undefined);
    const channel = new MailerEmailChannel({ send });
    expect(channel.available()).toBe(true);
    expect(await channel.send(message)).toEqual({ providerMessageId: null });
    const mail = send.mock.calls[0]![0];
    expect(mail).toMatchObject({ to: 'lan@example.test', subject: 'Doanh thu <hôm qua>' });
    expect(mail.text).toContain('Quản lý lịch báo cáo trong Rapiz: https://app.rapiz.test/app');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).toContain('Doanh thu &lt;hôm qua&gt;');
    expect(mail.html).toContain(EMAIL_BRAND_COLOR);
  });

  it('lets a provider failure through so the runner retries', async () => {
    const channel = new MailerEmailChannel({
      send: async () => {
        throw new Error('Email provider answered 500');
      },
    });
    await expect(channel.send(message)).rejects.toThrow('500');
  });

  it('leaves the link out when APP_PUBLIC_URL is unset and renders English', () => {
    const { text, html } = renderEmail({ ...message, locale: 'en', link: null });
    expect(text).toBe(message.body);
    expect(html).not.toContain('<a ');
    expect(renderEmail({ ...message, locale: 'en' }).text).toContain(
      'Manage report schedules in Rapiz',
    );
  });
});
