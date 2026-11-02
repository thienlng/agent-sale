import { describe, expect, it, vi } from 'vitest';

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: vi.fn(async () => ({ messageId: 'x' })) })),
  },
}));

import nodemailer from 'nodemailer';

import {
  EMAIL_BRAND_COLOR,
  type MailTransport,
  renderEmail,
  SmtpEmailChannel,
} from '../infrastructure/clients/smtp-email.channel.js';

const message = {
  to: 'lan@example.test',
  locale: 'vi' as const,
  title: 'Doanh thu <hôm qua>',
  body: 'Doanh thu: 1.250.000 ₫\n<script>alert(1)</script>\n\nĐơn: 3',
  link: 'https://app.rapiz.test/app',
};

describe('SmtpEmailChannel', () => {
  it('is off without SMTP_URL and builds the transport once when set', () => {
    const create = vi.mocked(nodemailer.createTransport);
    expect(new SmtpEmailChannel({ smtpUrl: undefined, from: 'Rapiz <a@b.c>' }).available()).toBe(
      false,
    );
    expect(create).not.toHaveBeenCalled();
    const on = new SmtpEmailChannel({ smtpUrl: 'smtp://localhost:1025', from: 'Rapiz <a@b.c>' });
    expect(on.available()).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith('smtp://localhost:1025');
  });

  it('sends text and escaped HTML with the title as the subject', async () => {
    const sendMail = vi.fn<MailTransport['sendMail']>(async () => ({ messageId: '<id@smtp>' }));
    const channel = new SmtpEmailChannel(
      { smtpUrl: 'smtp://localhost:1025', from: 'Rapiz <no-reply@rapiz.io>' },
      () => ({ sendMail }),
    );
    expect(await channel.send(message)).toEqual({ providerMessageId: '<id@smtp>' });
    const mail = sendMail.mock.calls[0]![0];
    expect(mail).toMatchObject({
      from: 'Rapiz <no-reply@rapiz.io>',
      to: 'lan@example.test',
      subject: 'Doanh thu <hôm qua>',
    });
    expect(mail.text).toContain('Quản lý lịch báo cáo trong Rapiz: https://app.rapiz.test/app');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).toContain('Doanh thu &lt;hôm qua&gt;');
    expect(mail.html).toContain(EMAIL_BRAND_COLOR);
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
