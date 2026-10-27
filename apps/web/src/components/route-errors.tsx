import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { ApiClientError } from '@/lib/api-client';

// Root fallbacks load before every route: native controls keep optional button/Slot/style helpers out of the entry graph.
const actionClass =
  'mt-2 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

export function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-5xl font-semibold text-primary">404</p>
      <h1 className="text-xl font-semibold">{t('errors.notFoundTitle')}</h1>
      <p className="max-w-sm text-muted-foreground">{t('errors.notFoundBody')}</p>
      <Link className={actionClass} to="/app/bots">
        {t('errors.home')}
      </Link>
    </div>
  );
}

export function RouteError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (error instanceof ApiClientError && error.status === 404) return <NotFound />;
  const traceId = error instanceof ApiClientError ? (error.traceId ?? '—') : '—';
  return (
    <div
      role="alert"
      className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <h1 className="text-xl font-semibold">{t('errors.crashTitle')}</h1>
      <p className="max-w-md text-muted-foreground">{t('errors.crashBody', { traceId })}</p>
      <button type="button" className={actionClass} onClick={() => window.location.reload()}>
        {t('errors.reload')}
      </button>
    </div>
  );
}
