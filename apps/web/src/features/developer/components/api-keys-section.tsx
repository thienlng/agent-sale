import type { ApiKeyDto } from '@agent-sales/contracts';
import { KeyRound, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatRelativeTime } from '@/lib/format';

import { useApiKeys, useRevokeApiKey } from '../api/developer';
import { ConfirmDialog } from './confirm-dialog';
import { CreateApiKeyDialog } from './create-api-key-dialog';
import { SecretRevealDialog } from './secret-reveal-dialog';

const STATUS_VARIANT = { active: 'secondary', expired: 'outline', revoked: 'destructive' } as const;

/** Workspace API keys: list, create (full key shown once) and revoke. */
export function ApiKeysSection({ canCreate }: { canCreate: boolean }) {
  const { t } = useTranslation('developer');
  const { t: tc } = useTranslation();
  const keys = useApiKeys();
  const revoke = useRevokeApiKey();
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyDto | null>(null);

  return (
    <section aria-labelledby="api-keys-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="api-keys-title" className="font-semibold">
            {t('keys.title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('keys.hint')}</p>
        </div>
        {canCreate ? (
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            {t('keys.create')}
          </Button>
        ) : null}
      </div>
      {keys.isPending ? (
        <Skeleton className="h-24" />
      ) : keys.isError ? (
        <p className="text-sm text-destructive">{t('common.loadError')}</p>
      ) : keys.data.length ? (
        <ul className="divide-y rounded-xl border">
          {keys.data.map((key) => (
            <li key={key.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <KeyRound aria-hidden className="size-4 text-muted-foreground" />
                  {key.name}
                  <Badge variant={STATUS_VARIANT[key.status]}>
                    {t(`keys.status.${key.status}`)}
                  </Badge>
                </p>
                <code className="font-mono text-xs text-muted-foreground">{key.prefix}…</code>
                <p className="text-xs text-muted-foreground">
                  {key.scopes.map((s) => t(`scopes.${s}`)).join(', ')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[
                    t('keys.createdBy', { name: key.createdBy.name }),
                    key.lastUsedAt
                      ? t('keys.lastUsed', { when: formatRelativeTime(key.lastUsedAt) })
                      : t('common.never'),
                    key.expiresAt
                      ? t('keys.expires', { when: formatDate(key.expiresAt) })
                      : t('keys.noExpiry'),
                  ].join(' · ')}
                </p>
              </div>
              {key.status === 'revoked' ? null : (
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`${t('keys.revoke')} ${key.name}`}
                  onClick={() => setRevoking(key)}
                >
                  {t('keys.revoke')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          {t('keys.empty')}
        </p>
      )}
      <CreateApiKeyDialog open={creating} onOpenChange={setCreating} onCreated={setRevealed} />
      <SecretRevealDialog
        value={revealed}
        title={t('keys.reveal.title')}
        warning={t('keys.reveal.warning')}
        done={t('keys.reveal.done')}
        onClose={() => setRevealed(null)}
      />
      <ConfirmDialog
        open={revoking !== null}
        title={t('keys.revokeTitle', { name: revoking?.name ?? '' })}
        body={t('keys.revokeBody')}
        action={t('keys.revoke')}
        cancel={t('common.cancel')}
        destructive
        onClose={() => setRevoking(null)}
        onConfirm={() => {
          if (!revoking) return;
          revoke.mutate(revoking.id, {
            onSuccess: () => toast.success(t('keys.revoked')),
            onError: (error) => toast.error(errorMessage(tc, error)),
          });
        }}
      />
    </section>
  );
}
