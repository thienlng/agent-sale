import type { LinkedIdentityDto } from '@agent-sales/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiClientError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { formatDay, isoDate } from '@/lib/format';

import { useLinkedIdentities, useUnlinkIdentity } from '../api/identities';

/**
 * Linked sign-ins (Google): the user can see which Google account can open theirs and remove one
 * they do not recognise. Removing needs a recent step-up (the API client prompts for it).
 */
export function LinkedSignIns() {
  const { t } = useTranslation();
  const list = useLinkedIdentities();
  const unlink = useUnlinkIdentity();
  const [removing, setRemoving] = useState<LinkedIdentityDto | null>(null);

  function remove(identity: LinkedIdentityDto) {
    unlink.mutate(
      { provider: identity.provider, subject: identity.subject },
      {
        onSuccess: () => toast.success(t('wsettings.security.linked.removed')),
        onError: (error) =>
          toast.error(
            error instanceof ApiClientError && error.details?.['reason'] === 'last_sign_in_method'
              ? t('wsettings.security.linked.lastMethod')
              : errorMessage(t, error),
          ),
      },
    );
  }

  return (
    <section className="max-w-2xl rounded-lg border p-5" aria-labelledby="linked-sign-ins">
      <h2 id="linked-sign-ins" className="text-lg font-semibold">
        {t('wsettings.security.linked.title')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('wsettings.security.linked.hint')}</p>
      {list.isPending ? (
        <Skeleton className="mt-4 h-12" />
      ) : list.isError ? (
        <p className="mt-4 text-sm text-destructive">{t('wsettings.security.linked.loadError')}</p>
      ) : list.data.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t('wsettings.security.linked.empty')}</p>
      ) : (
        <ul className="mt-4 divide-y rounded-md border">
          {list.data.map((identity) => (
            <li
              key={`${identity.provider}:${identity.subject}`}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {t('wsettings.security.linked.google')} · {identity.email}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('wsettings.security.linked.since', {
                    date: formatDay(isoDate(new Date(identity.createdAt))),
                  })}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={unlink.isPending}
                aria-label={`${t('wsettings.security.linked.remove')} ${identity.email}`}
                onClick={() => setRemoving(identity)}
              >
                {t('wsettings.security.linked.remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('wsettings.security.linked.removeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('wsettings.security.linked.removeBody', { email: removing?.email ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('wsettings.security.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removing) remove(removing);
                setRemoving(null);
              }}
            >
              {t('wsettings.security.linked.remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
