import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { ApiClientError } from '@/lib/api-client';

export function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-5xl font-semibold text-primary">404</p>
      <h1 className="text-xl font-semibold">{t('errors.notFoundTitle')}</h1>
      <p className="max-w-sm text-muted-foreground">{t('errors.notFoundBody')}</p>
      <Button asChild className="mt-2">
        <Link to="/app/bots">{t('errors.home')}</Link>
      </Button>
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
      <Button className="mt-2" onClick={() => window.location.reload()}>
        {t('errors.reload')}
      </Button>
    </div>
  );
}
