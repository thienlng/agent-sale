import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { authProviders, googleSignInUrl } from '@/lib/session';

/** Google's "G" mark (brand colours, as Google's sign-in guidelines require). */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15Z"
      />
      <path
        fill="#34A853"
        d="M24 44c5.5 0 10.1-1.8 13.5-4.5l-6.6-5.1c-1.8 1.2-4.1 1.9-6.9 1.9-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20.4 20.4 0 0 0 24 44Z"
      />
      <path fill="#FBBC05" d="M12.6 27.9a12.2 12.2 0 0 1 0-7.8v-5.3H5.8a20 20 0 0 0 0 18.4Z" />
      <path
        fill="#EA4335"
        d="M24 11.7c3 0 5.7 1 7.8 3.1l5.8-5.8A19.4 19.4 0 0 0 24 4 20.4 20.4 0 0 0 5.8 14.8l6.8 5.3c1.6-4.8 6.1-8.4 11.4-8.4Z"
      />
    </svg>
  );
}

/**
 * "Continue with Google": a plain link to the server, which sends the browser to Google and back to
 * /login. Shown as coming soon while the server has no Google client configured.
 */
const PLAIN =
  'flex h-11 w-full items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 disabled:cursor-not-allowed disabled:text-muted-foreground disabled:hover:bg-background [&_small]:text-xs [&_small]:font-normal';

export function GoogleButton({
  redirect,
  variant = 'login',
}: {
  /** Same-app path to open after signing in. */
  redirect?: string | undefined;
  /** `login`: styled by the login page's stylesheet; `plain`: standalone (sign-up page). */
  variant?: 'login' | 'plain';
}) {
  const className = variant === 'login' ? 'login-google' : PLAIN;
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    void authProviders().then((p) => {
      if (live) setEnabled(p.google);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!enabled) {
    return (
      <button type="button" className={className} disabled>
        <GoogleMark />
        {t('auth.googleLogin')}
        {enabled === false ? <small>{t('auth.googleSoon')}</small> : null}
      </button>
    );
  }
  return (
    <a href={googleSignInUrl(redirect)} className={className} data-enabled>
      <GoogleMark />
      {t('auth.googleLogin')}
    </a>
  );
}
