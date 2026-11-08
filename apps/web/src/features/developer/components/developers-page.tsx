import { BookOpen, Lock, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useCan } from '@/lib/permissions';

import { PUBLIC_OPENAPI_URL } from '../api/developer';
import { ApiKeysSection } from './api-keys-section';
import { WebhooksSection } from './webhooks-section';

/**
 * Settings → Developers (ADR-022): API keys and webhooks for the tenant's own systems. Owners and
 * admins only (`developer.manage`). `apiEnabled` is the plan's `feature.public_api` (undefined while
 * loading): without it nothing new can be created, but existing keys and webhooks can still be
 * revoked and removed.
 */
export function DevelopersPage({ apiEnabled }: { apiEnabled: boolean | undefined }) {
  const { t } = useTranslation('developer');
  const canManage = useCan('developer.manage');

  if (!canManage)
    return (
      <Alert className="max-w-3xl">
        <Lock />
        <AlertDescription>{t('noAccess')}</AlertDescription>
      </Alert>
    );

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">{t('subtitle')}</p>
        <a
          href={PUBLIC_OPENAPI_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-text hover:underline"
        >
          <BookOpen aria-hidden className="size-4" />
          {t('docs')}
        </a>
      </div>
      {apiEnabled === false ? (
        <Alert>
          <Sparkles />
          <AlertTitle>{t('upgrade.title')}</AlertTitle>
          <AlertDescription>{t('upgrade.body')}</AlertDescription>
        </Alert>
      ) : null}
      <ApiKeysSection canCreate={apiEnabled === true} />
      <WebhooksSection canCreate={apiEnabled === true} />
    </div>
  );
}
