import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Logo } from '@/components/logo';
import { siteUrl } from '@/lib/env';

import './login-layout.css';

export function LoginLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <main className="login-entry">
      <aside className="login-poster" aria-hidden="true">
        <img className="login-art" src="/brand/login-fold.webp" alt="" fetchPriority="high" />
        <p className="login-poster-title">
          {t('auth.posterFrom')}
          <br />
          <em>{t('auth.posterTo')}</em>
        </p>
      </aside>
      <div className="login-paper">
        <a className="login-signature" href={siteUrl()} aria-label={t('account.home')}>
          <Logo />
        </a>
        <div className="login-fields">{children}</div>
      </div>
    </main>
  );
}
