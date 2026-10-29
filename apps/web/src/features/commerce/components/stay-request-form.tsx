import {
  CreateStayRequest,
  StayQuoteRequest,
  type StayRequestDto,
  type StayQuote,
} from '@agent-sales/contracts';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatVnd } from '@/lib/format';
import { lodgingErrorMessage } from '../hooks/lodging-errors';
import { useCan } from '@/lib/permissions';
import { useAccommodations, useCreateStay, useStayQuote } from '../api/lodging';

export function StayRequestForm({
  onSaved,
  initialName = '',
  initialPhone = '',
}: {
  onSaved: (row: StayRequestDto) => void;
  initialName?: string;
  initialPhone?: string;
}) {
  const { t } = useTranslation(),
    properties = useAccommodations(),
    create = useCreateStay(),
    quote = useStayQuote();
  const canCreate = useCan('orders.manage');
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const [propertyId, setPropertyId] = useState(''),
    [checkIn, setCheckIn] = useState(''),
    [checkOut, setCheckOut] = useState('');
  const [adults, setAdults] = useState(1),
    [children, setChildren] = useState(0),
    [ages, setAges] = useState('');
  const [guestName, setName] = useState(initialName),
    [guestPhone, setPhone] = useState(initialPhone),
    [note, setNote] = useState(''),
    [invalid, setInvalid] = useState(false);
  const [shownQuote, setShownQuote] = useState<{ value: StayQuote; signature: string }>();
  const selected =
    propertyId || (properties.data?.length === 1 ? (properties.data[0]?.id ?? '') : '');
  const body = {
    propertyId: selected,
    dates: { checkIn, checkOut },
    party: {
      adults,
      children,
      childAges: ages.trim()
        ? ages.split(',').map((v) => (v.trim() ? Number(v.trim()) : Number.NaN))
        : [],
    },
  };
  const signature = JSON.stringify(body),
    currentQuote = shownQuote?.signature === signature ? shownQuote.value : undefined;
  function preview() {
    const parsed = StayQuoteRequest.safeParse(body);
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    quote.mutate(parsed.data, {
      onSuccess: (value) => setShownQuote({ value, signature }),
      onError: (e) => toast.error(lodgingErrorMessage(t, e)),
    });
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = CreateStayRequest.safeParse({
      ...body,
      clientRequestId,
      guestName,
      guestPhone,
      note,
    });
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    create.mutate(parsed.data, {
      onSuccess: (r) => {
        toast.success(t('lodging.requestSaved'));
        onSaved(r);
      },
      onError: (e) => toast.error(lodgingErrorMessage(t, e)),
    });
  }
  if (!canCreate) return <p role="status">{t('lodging.permission')}</p>;
  if (properties.isPending) return <p role="status">{t('lodging.loading')}</p>;
  if (properties.isError)
    return (
      <div role="alert">
        {t('lodging.loadError')}
        <Button variant="outline" onClick={() => void properties.refetch()}>
          {t('lodging.retry')}
        </Button>
      </div>
    );
  if (!properties.data?.length) return <p>{t('lodging.emptyProperties')}</p>;
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="stay-property">{t('lodging.property')}</Label>
        <Select value={selected} onValueChange={setPropertyId}>
          <SelectTrigger id="stay-property">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {properties.data.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="stay-in">{t('lodging.checkIn')}</Label>
          <Input
            id="stay-in"
            type="date"
            value={checkIn}
            onChange={(e) => setCheckIn(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="stay-out">{t('lodging.checkOut')}</Label>
          <Input
            id="stay-out"
            type="date"
            value={checkOut}
            min={checkIn || undefined}
            onChange={(e) => setCheckOut(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="stay-adults">{t('lodging.adults')}</Label>
          <Input
            id="stay-adults"
            type="number"
            min={1}
            max={1000}
            value={adults}
            onChange={(e) => setAdults(Number(e.target.value))}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="stay-children">{t('lodging.children')}</Label>
          <Input
            id="stay-children"
            type="number"
            min={0}
            max={1000}
            value={children}
            onChange={(e) => {
              const count = Number(e.target.value);
              setChildren(count);
              if (count === 0) setAges('');
            }}
            required
          />
        </div>
      </div>
      {children > 0 && (
        <div className="space-y-2">
          <Label htmlFor="stay-ages">{t('lodging.childAges')}</Label>
          <Input
            id="stay-ages"
            value={ages}
            maxLength={3000}
            onChange={(e) => setAges(e.target.value)}
          />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="stay-name">{t('lodging.guestName')}</Label>
          <Input
            id="stay-name"
            value={guestName}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="stay-phone">{t('lodging.guestPhone')}</Label>
          <Input
            id="stay-phone"
            type="tel"
            value={guestPhone}
            minLength={5}
            maxLength={40}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="stay-note">{t('lodging.requestNote')}</Label>
        <Textarea
          id="stay-note"
          value={note}
          maxLength={2000}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={quote.isPending || create.isPending}
        onClick={preview}
      >
        {t('lodging.viewQuote')}
      </Button>
      {shownQuote && !currentQuote && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('lodging.staleQuote')}
        </p>
      )}
      {currentQuote && (
        <section className="space-y-2 rounded-xl border bg-muted/30 p-4 text-sm" aria-live="polite">
          <p className="font-medium">{t('lodging.nights', { count: currentQuote.nights })}</p>
          <p>
            {currentQuote.baseTotal === null
              ? t('lodging.quoteUnknown')
              : t('lodging.quoteTotal', { amount: formatVnd(currentQuote.baseTotal) })}
          </p>
          <dl className="space-y-1">
            {currentQuote.nightlyReferences.map((r) => (
              <div key={r.date} className="flex flex-wrap justify-between gap-2">
                <dt>
                  {r.date} · {t(`lodging.days.${r.weekday}`)}
                </dt>
                <dd>{formatVnd(r.amount)}</dd>
              </div>
            ))}
          </dl>
          <p
            className={
              currentQuote.internalAvailability === 'conflict'
                ? 'text-destructive'
                : 'text-muted-foreground'
            }
          >
            {t(
              currentQuote.internalAvailability === 'conflict'
                ? 'lodging.calendarConflict'
                : 'lodging.calendarUnknown',
            )}
          </p>
          {currentQuote.needsGuestApproval && <p>{t('lodging.guestApproval')}</p>}
          <p className="text-muted-foreground">{t('lodging.quoteExclusions')}</p>
        </section>
      )}
      {invalid && (
        <p role="alert" className="text-sm text-destructive">
          {t('lodging.invalidRequest')}
        </p>
      )}
      <p className="text-sm text-muted-foreground">{t('lodging.requestsIntro')}</p>
      <Button type="submit" disabled={create.isPending || quote.isPending}>
        {t('lodging.createRequest')}
      </Button>
    </form>
  );
}
