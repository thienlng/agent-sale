import { type SaasRequestDto, SaasRequestStatus } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { Inbox, Plus, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { useCan } from '@/lib/permissions';

import { useSaasRequests, useUpdateSaasRequest } from '../api/saas';
import { SaasRequestForm } from './saas-request-form';

type Status = SaasRequestStatus;
type Target = Exclude<Status, 'new'>;
/** Mirrors the server's transitions (saas domain); converted and closed are final. */
const NEXT: Record<Status, readonly Target[]> = {
  new: ['contacted', 'scheduled', 'converted', 'closed'],
  contacted: ['scheduled', 'converted', 'closed'],
  scheduled: ['contacted', 'converted', 'closed'],
  converted: [],
  closed: [],
};
const ALL = 'all';

export function SaasRequestsPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>();
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const query = useSaasRequests({ ...(status ? { status } : {}), offset });
  const update = useUpdateSaasRequest();
  const canEdit = useCan('contacts.edit');

  function move(row: SaasRequestDto, next: Target) {
    update.mutate(
      { id: row.id, body: { version: row.version, status: next } },
      {
        onSuccess: () => toast.success(t('saas.statusSaved')),
        onError: (e) => {
          toast.error(errorMessage(t, e));
          void query.refetch();
        },
      },
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-5">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('saas.requestsTitle')}</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t('saas.requestsIntro')}</p>
        </div>
        {canEdit && (
          <Button onClick={() => setCreating(true)}>
            <Plus />
            {t('saas.newRequest')}
          </Button>
        )}
      </div>
      <div className="w-56">
        <Select
          value={status ?? ALL}
          onValueChange={(v) => {
            setStatus(v === ALL ? undefined : SaasRequestStatus.parse(v));
            setOffset(0);
          }}
        >
          <SelectTrigger aria-label={t('saas.filterStatus')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('saas.allStatuses')}</SelectItem>
            {SaasRequestStatus.options.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`saas.status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {query.isPending && <p role="status">{t('saas.loading')}</p>}
      {query.isError && (
        <div role="alert" className="flex items-center gap-3">
          {t('saas.loadError')}
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t('saas.retry')}
          </Button>
        </div>
      )}
      {query.data?.data.length === 0 && (
        <div className="rounded-xl border p-8 text-center">
          <Inbox className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p>{t('saas.emptyRequests')}</p>
        </div>
      )}
      {query.data?.data.map((r) => (
        <article className="space-y-2 rounded-xl border bg-card p-4" key={r.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">
              {r.name}
              {r.company ? (
                <span className="font-normal text-muted-foreground"> · {r.company}</span>
              ) : null}
            </h2>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{t(`saas.kind.${r.kind}`)}</Badge>
              <Badge variant={r.status === 'new' ? 'default' : 'secondary'}>
                {t(`saas.status.${r.status}`)}
              </Badge>
            </div>
          </div>
          <p className="text-sm">{[r.phone, r.email].filter(Boolean).join(' · ')}</p>
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            {(['teamSize', 'planInterest', 'preferredTime'] as const).map((key) =>
              r[key] ? (
                <div key={key} className="flex gap-1">
                  <dt className="text-muted-foreground">{t(`saas.field.${key}`)}:</dt>
                  <dd>{r[key]}</dd>
                </div>
              ) : null,
            )}
          </dl>
          {r.need && <p className="whitespace-pre-wrap text-sm">{r.need}</p>}
          {r.note && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{r.note}</p>}
          <p className="text-xs text-muted-foreground">
            {t(`saas.source.${r.source}`)} · {formatDateTime(r.createdAt)}
          </p>
          <div className="flex flex-wrap gap-2">
            {r.contactId && (
              <Button asChild size="sm" variant="ghost">
                <Link to="/app/contacts" search={{ contact: r.contactId }}>
                  <UserRound />
                  {t('saas.openContact')}
                </Link>
              </Button>
            )}
            {r.conversationId && (
              <Button asChild size="sm" variant="ghost">
                <Link to="/app/inbox" search={{ conversation: r.conversationId }}>
                  {t('saas.openConversation')}
                </Link>
              </Button>
            )}
            {canEdit &&
              NEXT[r.status].map((next) => (
                <Button
                  key={next}
                  size="sm"
                  variant={next === 'converted' ? 'default' : 'outline'}
                  disabled={update.isPending}
                  onClick={() => move(r, next)}
                >
                  {t(`saas.moveTo.${next}`)}
                </Button>
              ))}
          </div>
        </article>
      ))}
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={offset === 0 || query.isPending}
          onClick={() => setOffset(Math.max(0, offset - 100))}
        >
          {t('saas.previous')}
        </Button>
        <Button
          variant="outline"
          disabled={typeof query.data?.nextOffset !== 'number'}
          onClick={() => {
            if (typeof query.data?.nextOffset === 'number') setOffset(query.data.nextOffset);
          }}
        >
          {t('saas.next')}
        </Button>
      </div>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('saas.newRequest')}</DialogTitle>
            <DialogDescription>{t('saas.requestsIntro')}</DialogDescription>
          </DialogHeader>
          {creating && <SaasRequestForm onSaved={() => setCreating(false)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
