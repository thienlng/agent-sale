import type { EmailMessage } from '../../../common/email/mailer.js';
import type { EmailCodePurpose } from '../domain/ports/email-code.repository.js';

// Product copy sent to Vietnamese users (Rule 01: user-facing content may be Vietnamese).
const COPY: Record<EmailCodePurpose, { subject: string; intro: string }> = {
  signup: {
    subject: 'Mã xác minh đăng ký Rapiz',
    intro: 'Nhập mã sau để xác minh email và hoàn tất đăng ký Rapiz:',
  },
  reset_password: {
    subject: 'Mã đặt lại mật khẩu Rapiz',
    intro: 'Nhập mã sau để đặt mật khẩu mới cho tài khoản Rapiz:',
  },
};

function escapeHtml(v: string): string {
  return v.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

/** The email carrying a one-time code; `minutes` is how long the code is valid. */
export function codeEmail(input: {
  to: string;
  name: string | null;
  purpose: EmailCodePurpose;
  code: string;
  minutes: number;
}): EmailMessage {
  const { subject, intro } = COPY[input.purpose];
  const hello = input.name ? `Xin chào ${input.name},` : 'Xin chào,';
  const validity = `Mã có hiệu lực trong ${input.minutes} phút. Không chia sẻ mã này với bất kỳ ai.`;
  const ignore = 'Nếu bạn không yêu cầu mã này, hãy bỏ qua email.';
  return {
    to: input.to,
    subject: `${subject}: ${input.code}`,
    text: [hello, '', intro, '', input.code, '', validity, ignore, '', 'Rapiz'].join('\n'),
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#111;line-height:1.5">
<p>${escapeHtml(hello)}</p>
<p>${escapeHtml(intro)}</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px;margin:16px 0">${input.code}</p>
<p>${escapeHtml(validity)}<br>${escapeHtml(ignore)}</p>
<p>Rapiz</p>
</div>`,
  };
}
