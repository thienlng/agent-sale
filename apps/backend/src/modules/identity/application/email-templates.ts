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
  reauth: {
    subject: 'Mã xác nhận thao tác bảo mật Rapiz',
    intro: 'Nhập mã sau để xác nhận lại danh tính trước một thao tác bảo mật trên Rapiz:',
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

/** Account changes the user is told about by email (the account may not be in their hands). */
export type SecurityNotice = 'password_reset' | 'mfa_enabled' | 'mfa_disabled' | 'recovery_codes';

const NOTICE: Record<SecurityNotice, { subject: string; body: string }> = {
  password_reset: {
    subject: 'Mật khẩu Rapiz của bạn vừa được đổi',
    body: 'Mật khẩu tài khoản Rapiz của bạn vừa được đặt lại. Mọi phiên đăng nhập, khoá API do bạn tạo và liên kết đăng nhập Google đã bị gỡ.',
  },
  mfa_enabled: {
    subject: 'Đã bật xác thực hai lớp cho Rapiz',
    body: 'Xác thực hai lớp vừa được bật cho tài khoản Rapiz của bạn.',
  },
  mfa_disabled: {
    subject: 'Đã tắt xác thực hai lớp của Rapiz',
    body: 'Xác thực hai lớp vừa được tắt cho tài khoản Rapiz của bạn.',
  },
  recovery_codes: {
    subject: 'Mã khôi phục Rapiz vừa được tạo lại',
    body: 'Bộ mã khôi phục mới vừa được tạo cho tài khoản Rapiz của bạn; các mã cũ không còn dùng được.',
  },
};

/** "Was this you?" email after a security change of the account. */
export function securityNoticeEmail(input: {
  to: string;
  name: string | null;
  notice: SecurityNotice;
}): EmailMessage {
  const { subject, body } = NOTICE[input.notice];
  const hello = input.name ? `Xin chào ${input.name},` : 'Xin chào,';
  const warn =
    'Nếu không phải bạn, hãy đặt lại mật khẩu ngay (Quên mật khẩu trên trang đăng nhập) và liên hệ hỗ trợ Rapiz.';
  return {
    to: input.to,
    subject,
    text: [hello, '', body, '', warn, '', 'Rapiz'].join('\n'),
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#111;line-height:1.5">
<p>${escapeHtml(hello)}</p>
<p>${escapeHtml(body)}</p>
<p>${escapeHtml(warn)}</p>
<p>Rapiz</p>
</div>`,
  };
}

function notice(to: string, subject: string, lines: string[]): EmailMessage {
  const body = ['Xin chào,', '', ...lines, '', 'Rapiz'];
  return {
    to,
    subject,
    text: body.join('\n'),
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#111;line-height:1.5">
${body
  .filter(Boolean)
  .map((l) => `<p>${escapeHtml(l)}</p>`)
  .join('\n')}
</div>`,
  };
}

/**
 * Sent instead of a signup code when the address already has an account, so the signup answer
 * never tells whether it does (no account enumeration).
 */
export function accountExistsEmail(input: { to: string }): EmailMessage {
  return notice(input.to, 'Email này đã có tài khoản Rapiz', [
    'Có người vừa yêu cầu mã đăng ký Rapiz cho email này, nhưng email đã có tài khoản.',
    'Hãy đăng nhập. Nếu quên mật khẩu, chọn "Quên mật khẩu?" ở trang đăng nhập.',
    'Nếu bạn không yêu cầu, hãy bỏ qua email này.',
  ]);
}

/** Tells the owner that a password-reset code was killed by wrong guesses (at most once a day). */
export function codeGuessAlertEmail(input: { to: string }): EmailMessage {
  return notice(input.to, 'Cảnh báo bảo mật tài khoản Rapiz', [
    'Mã đặt lại mật khẩu cho tài khoản Rapiz của bạn bị nhập sai quá nhiều lần nên đã bị hủy. Nếu bạn đang đặt lại mật khẩu, hãy yêu cầu một mã mới.',
    'Nếu đó không phải bạn, mật khẩu hiện tại vẫn an toàn. Bạn nên bật xác thực hai lớp trong phần bảo mật tài khoản.',
  ]);
}
