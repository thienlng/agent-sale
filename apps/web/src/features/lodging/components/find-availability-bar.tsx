import type { AvailabilityRequest } from '@agent-sales/contracts';
import { Search, X } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { isStayRange } from '../lib/format';
import { EMPTY_PARTY, type PartyValue, toParty } from '../lib/party';
import { PartyInput } from './party-input';

/**
 * One compact row answering "ngày X–Y, N người, còn căn nào?":
 * [Nhận phòng] [Trả phòng] [Người lớn] [Trẻ em + tuổi] [Tìm].
 */
export function FindAvailabilityBar({
  initial,
  active,
  status,
  onSearch,
  onClear,
}: {
  /** The search restored from the URL (prefills the fields). */
  initial?: AvailabilityRequest | null;
  active: boolean;
  /** One line under the bar: result count, nothing found or an error. */
  status: string | null;
  onSearch: (body: AvailabilityRequest) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation('lodging');
  const id = useId();
  const [checkIn, setCheckIn] = useState(initial?.checkIn ?? '');
  const [checkOut, setCheckOut] = useState(initial?.checkOut ?? '');
  const [party, setParty] = useState<PartyValue>(
    initial
      ? { adults: initial.party.adults, childAges: initial.party.childAges ?? [] }
      : EMPTY_PARTY,
  );
  // Which field blocks the search: the dates, or a child's age still empty (VL-A2).
  const [error, setError] = useState<'dates' | 'ages' | null>(null);
  const invalid = error === 'dates';
  // The age message goes away as soon as every age is filled in.
  const shown = error === 'ages' && toParty(party) ? null : error;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const p = toParty(party);
    if (!isStayRange(checkIn, checkOut)) {
      setError('dates');
      return;
    }
    if (!p) {
      setError('ages');
      return;
    }
    setError(null);
    onSearch({ checkIn, checkOut, party: p });
  };
  const clear = () => {
    setCheckIn('');
    setCheckOut('');
    setParty(EMPTY_PARTY);
    setError(null);
    onClear();
  };

  return (
    <form
      role="search"
      aria-label={t('find.title')}
      onSubmit={submit}
      className="grid gap-1 rounded-lg border border-border bg-card p-2"
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor={`${id}-in`} className="text-xs">
            {t('find.checkIn')}
          </Label>
          <Input
            id={`${id}-in`}
            type="date"
            className="w-36 tabular-nums"
            value={checkIn}
            aria-invalid={invalid || undefined}
            onChange={(e) => setCheckIn(e.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${id}-out`} className="text-xs">
            {t('find.checkOut')}
          </Label>
          <Input
            id={`${id}-out`}
            type="date"
            className="w-36 tabular-nums"
            min={checkIn || undefined}
            value={checkOut}
            aria-invalid={invalid || undefined}
            onChange={(e) => setCheckOut(e.target.value)}
          />
        </div>
        <PartyInput value={party} onChange={setParty} compact />
        <Button type="submit">
          <Search aria-hidden />
          {t('find.search')}
        </Button>
        {active && (
          <Button type="button" variant="ghost" onClick={clear}>
            <X aria-hidden />
            {t('find.clear')}
          </Button>
        )}
      </div>
      {shown && (
        <p role="alert" className="text-xs text-destructive">
          {t(shown === 'dates' ? 'find.invalid' : 'party.agesRequired')}
        </p>
      )}
      {status && (
        <p role="status" className="text-xs text-muted-foreground">
          {status}
        </p>
      )}
    </form>
  );
}
