import { Heart, ThumbsUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { BrandMark, Logo } from '@/components/logo';
import { siteUrl } from '@/lib/env';

import './login-layout.css';

const messages = [
  { key: 'stock', channel: 'Messenger', icon: 'messenger', face: 'an', minutes: 2 },
  { key: 'restock', channel: 'Instagram', icon: 'instagram', face: 'minh', minutes: 4 },
  { key: 'price', channel: 'Zalo', icon: 'zalo', face: 'nam', minutes: 3 },
  { key: 'plan', channel: 'Facebook', icon: 'facebook', face: 'lan', minutes: 1 },
  { key: 'size', channel: 'TikTok', icon: 'tiktok', face: 'an', minutes: 5 },
  { key: 'service', channel: 'Website chat', icon: 'web', face: 'nam', minutes: 6 },
  { key: 'quote', channel: 'Email', icon: 'email', face: 'minh', minutes: 10 },
  { key: 'booking', channel: 'Instagram', icon: 'instagram', face: 'an', minutes: 8 },
  { key: 'trial', channel: 'Zalo', icon: 'zalo', face: 'nam', minutes: 12 },
] as const;

function EnquiryPoster() {
  const { t } = useTranslation();
  return (
    <aside className="login-poster" aria-labelledby="enquiry-title">
      <h2 id="enquiry-title">
        {t('auth.enquiries.lead')} <em>{t('auth.enquiries.accent')}</em>
      </h2>
      <ul className="login-messages">
        {messages.map(({ key, channel, icon, face, minutes }) => (
          <li key={key} className={`login-message message-${key}`}>
            <img
              className="login-face"
              src={`/brand/login/${face}.webp`}
              width="40"
              height="40"
              alt=""
            />
            <div className="message-meta">
              <b>
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <use href={`/brand/login/channels.svg#${icon}`} />
                </svg>
                {channel}
              </b>
              <small>{t('auth.enquiries.minutes', { count: minutes })}</small>
            </div>
            <p>{t(`auth.enquiries.${key}`)}</p>
            {(key === 'stock' || key === 'plan' || key === 'booking') && (
              <span className="login-reaction" aria-hidden="true">
                {key === 'plan' ? <ThumbsUp /> : <Heart />}
              </span>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}

export function LoginLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <main className="login-entry">
      <div className="login-paper">
        <a className="login-signature" href={siteUrl()} aria-label={t('account.home')}>
          <Logo />
        </a>
        <div className="login-fields">{children}</div>
      </div>
      <div className="login-illustration-panel">
        <BrandMark className="login-watermark" />
        <EnquiryPoster />
      </div>
    </main>
  );
}
