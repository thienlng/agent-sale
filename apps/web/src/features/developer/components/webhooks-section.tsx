import type { WebhookEndpointDto } from '@agent-sales/contracts';
import { Ellipsis, Plus, Webhook } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';

import {
  useDeleteWebhookEndpoint,
  useRotateWebhookSecret,
  useSendTestEvent,
  useWebhookEndpoints,
} from '../api/developer';
import { ConfirmDialog } from './confirm-dialog';
import { DeliveriesSheet } from './deliveries-sheet';
import { SecretRevealDialog } from './secret-reveal-dialog';
import { WebhookEndpointDialog } from './webhook-endpoint-dialog';

type Confirm = { kind: 'rotate' | 'delete'; endpoint: WebhookEndpointDto };

function StateBadge({ endpoint }: { endpoint: WebhookEndpointDto }) {
  const { t } = useTranslation('developer');
  if (endpoint.enabled) return <Badge variant="secondary">{t('webhooks.enabled')}</Badge>;
  return (
    <Badge variant={endpoint.disabledReason === 'failing' ? 'destructive' : 'outline'}>
      {endpoint.disabledReason === 'failing'
        ? t('webhooks.disabledFailing')
        : t('webhooks.disabled')}
    </Badge>
  );
}

/** Webhook endpoints: add, edit, rotate the signing secret, send a test, delete, delivery log. */
export function WebhooksSection({ canCreate }: { canCreate: boolean }) {
  const { t } = useTranslation('developer');
  const { t: tc } = useTranslation();
  const endpoints = useWebhookEndpoints();
  const rotate = useRotateWebhookSecret();
  const test = useSendTestEvent();
  const remove = useDeleteWebhookEndpoint();
  // `undefined` = closed, `null` = adding a new endpoint.
  const [editing, setEditing] = useState<WebhookEndpointDto | null | undefined>(undefined);
  const [secret, setSecret] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [log, setLog] = useState<WebhookEndpointDto | null>(null);
  const failed = (error: unknown) => toast.error(errorMessage(tc, error));

  function confirmed() {
    if (!confirm) return;
    const { kind, endpoint } = confirm;
    if (kind === 'rotate')
      rotate.mutate(endpoint.id, { onSuccess: (r) => setSecret(r.secret), onError: failed });
    else
      remove.mutate(endpoint.id, {
        onSuccess: () => toast.success(t('webhooks.deleted')),
        onError: failed,
      });
  }

  return (
    <section aria-labelledby="webhooks-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="webhooks-title" className="font-semibold">
            {t('webhooks.title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('webhooks.hint')}</p>
        </div>
        {canCreate ? (
          <Button onClick={() => setEditing(null)}>
            <Plus aria-hidden />
            {t('webhooks.add')}
          </Button>
        ) : null}
      </div>
      {endpoints.isPending ? (
        <Skeleton className="h-24" />
      ) : endpoints.isError ? (
        <p className="text-sm text-destructive">{t('common.loadError')}</p>
      ) : endpoints.data.length ? (
        <ul className="divide-y rounded-xl border">
          {endpoints.data.map((endpoint) => (
            <li key={endpoint.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <Webhook aria-hidden className="size-4 text-muted-foreground" />
                  <span className="break-all">{endpoint.url}</span>
                  <StateBadge endpoint={endpoint} />
                </p>
                {endpoint.description ? (
                  <p className="text-sm text-muted-foreground">{endpoint.description}</p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {[
                    t('webhooks.eventCount', { count: endpoint.events.length }),
                    endpoint.failingSince
                      ? t('webhooks.failingSince', { when: formatDateTime(endpoint.failingSince) })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${t('webhooks.actions')} ${endpoint.url}`}
                  >
                    <Ellipsis aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setLog(endpoint)}>
                    {t('webhooks.deliveries')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setEditing(endpoint)}>
                    {t('webhooks.edit')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      test.mutate(endpoint.id, {
                        onSuccess: () => toast.success(t('webhooks.testSent')),
                        onError: failed,
                      })
                    }
                  >
                    {t('webhooks.test')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setConfirm({ kind: 'rotate', endpoint })}>
                    {t('webhooks.rotate')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setConfirm({ kind: 'delete', endpoint })}
                  >
                    {t('webhooks.delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          {t('webhooks.empty')}
        </p>
      )}
      <WebhookEndpointDialog
        open={editing !== undefined}
        endpoint={editing ?? null}
        onOpenChange={(open) => !open && setEditing(undefined)}
        onCreated={setSecret}
      />
      <SecretRevealDialog
        value={secret}
        title={t('webhooks.secret.title')}
        warning={t('webhooks.secret.warning')}
        done={t('webhooks.secret.done')}
        onClose={() => setSecret(null)}
      />
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === 'delete' ? t('webhooks.deleteTitle') : t('webhooks.rotateTitle')}
        body={
          confirm?.kind === 'delete'
            ? t('webhooks.deleteBody', { url: confirm.endpoint.url })
            : t('webhooks.rotateBody')
        }
        action={confirm?.kind === 'delete' ? t('webhooks.delete') : t('webhooks.rotate')}
        cancel={t('common.cancel')}
        destructive={confirm?.kind === 'delete'}
        onConfirm={confirmed}
        onClose={() => setConfirm(null)}
      />
      <DeliveriesSheet endpoint={log} onClose={() => setLog(null)} />
    </section>
  );
}
