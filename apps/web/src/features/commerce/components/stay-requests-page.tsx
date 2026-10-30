import type { StayRequestDto, UpdateStayStatusRequest } from '@agent-sales/contracts';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plus, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCan } from '@/lib/permissions';
import { formatVnd } from '@/lib/format';
import { lodgingErrorMessage } from '../hooks/lodging-errors';
import { useStays, useUpdateStayStatus } from '../api/lodging';
import { StayRequestForm } from './stay-request-form';

export function StayRequestsPage() {
  const [offset, setOffset] = useState(0);
  const { t } = useTranslation(),
    query = useStays(offset),
    update = useUpdateStayStatus(),
    canManage = useCan('orders.manage');
  const [creating, setCreating] = useState(false),
    [confirming, setConfirming] = useState<StayRequestDto>();
  function status(row: StayRequestDto, status: 'reviewing' | 'cancelled') {
    update.mutate(
      { id: row.id, body: { status, version: row.version } },
      {
        onSuccess: () => toast.success(t('lodging.statusSaved')),
        onError: (e) => {
          toast.error(lodgingErrorMessage(t, e));
          void query.refetch();
        },
      },
    );
  }
  return (
    <div className="flex w-full min-w-0 flex-col gap-5">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('lodging.requestsTitle')}</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            {t('lodging.requestsIntro')}
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setCreating(true)}>
            <Plus />
            {t('lodging.newRequest')}
          </Button>
        )}
      </div>
      {query.isPending && <p role="status">{t('lodging.loading')}</p>}
      {query.isError && (
        <div role="alert">
          {t('lodging.loadError')}
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t('lodging.retry')}
          </Button>
        </div>
      )}
      {query.data?.data.length === 0 && (
        <div className="rounded-xl border p-8 text-center">
          <CalendarDays className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p>{t('lodging.emptyRequests')}</p>
        </div>
      )}
      {query.data?.data.map((r) => (
        <article className="space-y-3 rounded-xl border bg-card p-4" key={r.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{r.propertyName}</h2>
            <Badge variant={r.status === 'confirmed' ? 'default' : 'secondary'}>
              {t(`lodging.status.${r.status}`)}
            </Badge>
          </div>
          <p className="font-medium">
            {r.dates.checkIn} → {r.dates.checkOut}
          </p>
          <p className="text-sm">
            {r.guestName} · {r.guestPhone}
          </p>
          <p className="text-sm">
            {t('lodging.adults')}: {r.party.adults} · {t('lodging.children')}: {r.party.children}
            {r.party.childAges.length > 0 ? ` (${r.party.childAges.join(', ')})` : ''}
          </p>
          {r.note && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{r.note}</p>}
          <p className="text-sm">
            {r.agreedTotal !== null
              ? t('lodging.totalAgreed', { amount: formatVnd(r.agreedTotal) })
              : r.quote.baseTotal !== null
                ? t('lodging.quoteTotal', { amount: formatVnd(r.quote.baseTotal) })
                : t('lodging.quoteUnknown')}
          </p>
          {r.quote.needsGuestApproval && (
            <p className="text-sm text-muted-foreground">{t('lodging.guestApproval')}</p>
          )}
          {canManage && r.status !== 'cancelled' && (
            <div className="flex flex-wrap gap-2">
              {r.status === 'requested' && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={update.isPending}
                  onClick={() => status(r, 'reviewing')}
                >
                  {t('lodging.review')}
                </Button>
              )}
              {r.status !== 'confirmed' && (
                <Button size="sm" disabled={update.isPending} onClick={() => setConfirming(r)}>
                  {t('lodging.confirm')}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={update.isPending}
                onClick={() => status(r, 'cancelled')}
              >
                {t('lodging.cancelStay')}
              </Button>
            </div>
          )}
        </article>
      ))}
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={offset === 0 || query.isPending}
          onClick={() => setOffset(Math.max(0, offset - 100))}
        >
          {t('lodging.previous')}
        </Button>
        <Button
          variant="outline"
          disabled={typeof query.data?.nextOffset !== 'number' || query.isPending}
          onClick={() => {
            if (typeof query.data?.nextOffset === 'number') setOffset(query.data.nextOffset);
          }}
        >
          {t('lodging.next')}
        </Button>
      </div>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('lodging.newRequest')}</DialogTitle>
            <DialogDescription>{t('lodging.requestsIntro')}</DialogDescription>
          </DialogHeader>
          {creating && <StayRequestForm onSaved={() => setCreating(false)} />}
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(confirming)} onOpenChange={(open) => !open && setConfirming(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('lodging.confirmTitle')}</DialogTitle>
            <DialogDescription>{t('lodging.confirmedHint')}</DialogDescription>
          </DialogHeader>
          {confirming && (
            <StayConfirmation
              key={confirming.id + confirming.version}
              row={confirming}
              onSaved={() => setConfirming(undefined)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StayConfirmation({ row, onSaved }: { row: StayRequestDto; onSaved: () => void }) {
  const { t } = useTranslation(),
    update = useUpdateStayStatus();
  const [availability, setAvailability] = useState(false),
    [terms, setTerms] = useState(false),
    [amount, setAmount] = useState(''),
    [invalid, setInvalid] = useState(false);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (
      !availability ||
      !terms ||
      !amount.trim() ||
      !Number.isSafeInteger(Number(amount)) ||
      Number(amount) < 0
    ) {
      setInvalid(true);
      return;
    }
    const body: UpdateStayStatusRequest = {
      status: 'confirmed',
      version: row.version,
      availabilityVerified: true,
      termsAndGuestsVerified: true,
      agreedTotal: Number(amount),
    };
    update.mutate(
      { id: row.id, body },
      {
        onSuccess: () => {
          toast.success(t('lodging.statusSaved'));
          onSaved();
        },
        onError: (e) => toast.error(lodgingErrorMessage(t, e)),
      },
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="font-medium">{row.propertyName}</p>
      <p>
        {row.dates.checkIn} → {row.dates.checkOut}
      </p>
      <div className="flex items-start gap-3">
        <Checkbox
          id="availability-verified"
          checked={availability}
          onCheckedChange={(v) => setAvailability(v === true)}
        />
        <Label htmlFor="availability-verified" className="leading-5">
          {t('lodging.confirmAvailability')}
        </Label>
      </div>
      <div className="flex items-start gap-3">
        <Checkbox
          id="terms-verified"
          checked={terms}
          onCheckedChange={(v) => setTerms(v === true)}
        />
        <Label htmlFor="terms-verified" className="leading-5">
          {t('lodging.confirmTerms')}
        </Label>
      </div>
      <div className="space-y-2">
        <Label htmlFor="agreed-total">{t('lodging.agreedTotal')}</Label>
        <Input
          id="agreed-total"
          type="number"
          min={0}
          max={1000000000000}
          step={1}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </div>
      {invalid && (
        <p role="alert" className="text-sm text-destructive">
          {t('lodging.confirmRequired')}
        </p>
      )}
      <Button type="submit" disabled={update.isPending}>
        {t('lodging.confirm')}
      </Button>
    </form>
  );
}
