import {
  type AccommodationDetails,
  UpsertProductRequest,
  type ProductDto,
} from '@agent-sales/contracts';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
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
import { lodgingErrorMessage } from '../hooks/lodging-errors';
import { useWorkspaceId } from '@/lib/use-workspace';
import { useCan } from '@/lib/permissions';
import { useSaveProduct } from '../api/commerce';

export function AccommodationForm({
  product,
  onSaved,
}: {
  product?: ProductDto | undefined;
  onSaved: () => void;
}) {
  const { t } = useTranslation(),
    save = useSaveProduct(),
    qc = useQueryClient(),
    ws = useWorkspaceId();
  const canManage = useCan('catalog.manage');
  const [name, setName] = useState(product?.name ?? ''),
    [code, setCode] = useState(product?.code ?? ''),
    [description, setDescription] = useState(product?.description ?? '');
  const [details, setDetails] = useState<AccommodationDetails>(
    product?.accommodation ?? {
      rentalType: 'entire_property',
      bedrooms: 1,
      standardAdults: 1,
      standardChildren: 0,
      childAgeBelow: 6,
      maxGuests: null,
      roomLayout: [{ name: '', beds: '' }],
      amenities: [],
      rateBasis: 'unconfirmed',
      rates: [
        { days: [1, 2, 3, 4], amount: Number.NaN },
        { days: [5, 7], amount: Number.NaN },
        { days: [6], amount: Number.NaN },
      ],
      checkInOut: '',
      depositPolicy: '',
      cancellationPolicy: '',
      extraGuestPolicy: '',
      holidayPolicy: '',
      gallery: [],
      notes: '',
    },
  );
  const [error, setError] = useState(false);
  function update<K extends keyof AccommodationDetails>(key: K, value: AccommodationDetails[K]) {
    setDetails((v) => ({ ...v, [key]: value }));
  }
  function rooms(next: AccommodationDetails['roomLayout']) {
    setDetails((v) => ({ ...v, roomLayout: next, bedrooms: next.length }));
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    const payload = UpsertProductRequest.safeParse({
      code,
      name,
      description,
      category: 'Accommodation',
      status: product?.status ?? 'active',
      visibleToBot: product?.visibleToBot ?? true,
      botInstructions: product?.botInstructions ?? '',
      accommodation: {
        ...details,
        amenities: details.amenities.map((v) => v.trim()).filter(Boolean),
      },
      imageUrls: details.gallery.slice(0, 5).map((p) => p.url),
      variants: [
        {
          ...(product?.variants[0] ? { id: product.variants[0].id } : {}),
          sku: product?.variants[0]?.sku ?? `${code}-WHOLE`,
          name: t('lodging.wholeProperty'),
          price: Math.min(...details.rates.map((r) => r.amount)),
        },
      ],
    });
    if (!payload.success) {
      setError(true);
      return;
    }
    save.mutate(
      { ...(product ? { id: product.id } : {}), body: payload.data },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: ['ws', ws, 'accommodations'] });
          toast.success(t('lodging.saved'));
          onSaved();
        },
        onError: (e) => toast.error(lodgingErrorMessage(t, e)),
      },
    );
  }
  const field = (id: string, label: string, node: ReactNode) => (
    <div className="space-y-2">
      <Label htmlFor={id}>{t(`lodging.${label}`)}</Label>
      {node}
    </div>
  );
  if (!canManage) return <p role="status">{t('lodging.permission')}</p>;
  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {field(
          'property-code',
          'code',
          <Input
            id="property-code"
            value={code}
            maxLength={64}
            onChange={(e) => setCode(e.target.value)}
            required
          />,
        )}
        {field(
          'property-name',
          'name',
          <Input
            id="property-name"
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            required
          />,
        )}
      </div>
      {field(
        'property-description',
        'description',
        <Textarea
          id="property-description"
          value={description}
          maxLength={5000}
          rows={4}
          onChange={(e) => setDescription(e.target.value)}
        />,
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {(['standardAdults', 'standardChildren', 'childAgeBelow'] as const).map((key) => (
          <div key={key}>
            {field(
              key,
              key,
              <Input
                id={key}
                type="number"
                min={key === 'standardChildren' ? 0 : 1}
                max={key === 'childAgeBelow' ? 18 : 1000}
                value={details[key]}
                onChange={(e) => update(key, Number(e.target.value))}
                required
              />,
            )}
          </div>
        ))}
        {field(
          'max-guests',
          'maxGuests',
          <Input
            id="max-guests"
            type="number"
            min={1}
            max={2000}
            value={details.maxGuests ?? ''}
            onChange={(e) =>
              update('maxGuests', e.target.value === '' ? null : Number(e.target.value))
            }
          />,
        )}
      </div>
      <fieldset className="space-y-3">
        <legend className="mb-2 font-semibold">
          {t('lodging.roomLayout')} · {details.roomLayout.length}
        </legend>
        {details.roomLayout.map((r, i) => (
          <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_2fr_auto]" key={i}>
            <Input
              aria-label={`${t('lodging.roomName')} ${i + 1}`}
              value={r.name}
              maxLength={100}
              placeholder={t('lodging.roomName')}
              onChange={(e) =>
                rooms(
                  details.roomLayout.map((v, j) => (j === i ? { ...v, name: e.target.value } : v)),
                )
              }
              required
            />
            <Textarea
              aria-label={`${t('lodging.beds')} ${i + 1}`}
              value={r.beds}
              maxLength={500}
              placeholder={t('lodging.beds')}
              onChange={(e) =>
                rooms(
                  details.roomLayout.map((v, j) => (j === i ? { ...v, beds: e.target.value } : v)),
                )
              }
              required
            />
            <Button
              type="button"
              variant="ghost"
              disabled={details.roomLayout.length <= 1}
              onClick={() => rooms(details.roomLayout.filter((_, j) => j !== i))}
            >
              {t('lodging.remove')}
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={details.roomLayout.length >= 100}
          onClick={() => rooms([...details.roomLayout, { name: '', beds: '' }])}
        >
          {t('lodging.addRoom')}
        </Button>
      </fieldset>
      {field(
        'amenities',
        'amenities',
        <Textarea
          id="amenities"
          rows={5}
          value={details.amenities.join('\n')}
          onChange={(e) => update('amenities', e.target.value.split('\n'))}
        />,
      )}
      {field(
        'rate-basis',
        'rateBasis',
        <Select
          value={details.rateBasis}
          onValueChange={(v) => update('rateBasis', v === 'night' ? 'night' : 'unconfirmed')}
        >
          <SelectTrigger id="rate-basis">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unconfirmed">{t('lodging.unconfirmedBasis')}</SelectItem>
            <SelectItem value="night">{t('lodging.nightBasis')}</SelectItem>
          </SelectContent>
        </Select>,
      )}
      <fieldset className="space-y-3">
        <legend className="font-semibold">{t('lodging.referenceRates')}</legend>
        {details.rates.map((r, i) => (
          <div key={i} className="grid items-center gap-2 sm:grid-cols-2">
            <Label htmlFor={`rate-${i}`}>
              {r.days.map((d) => t(`lodging.days.${d}`)).join(', ')}
            </Label>
            <Input
              id={`rate-${i}`}
              type="number"
              min={0}
              step={1}
              value={Number.isFinite(r.amount) ? r.amount : ''}
              onChange={(e) =>
                update(
                  'rates',
                  details.rates.map((v, j) =>
                    j === i ? { ...v, amount: e.target.valueAsNumber } : v,
                  ),
                )
              }
              required
            />
          </div>
        ))}
      </fieldset>
      {(
        [
          'checkInOut',
          'depositPolicy',
          'cancellationPolicy',
          'extraGuestPolicy',
          'holidayPolicy',
          'notes',
        ] as const
      ).map((key) => (
        <div key={key}>
          {field(
            key,
            (
              {
                depositPolicy: 'deposit',
                cancellationPolicy: 'cancellation',
                extraGuestPolicy: 'extraGuests',
                holidayPolicy: 'holidays',
              } as Record<string, string>
            )[key] ?? key,
            <Textarea
              id={key}
              value={details[key]}
              maxLength={key === 'notes' ? 3000 : key === 'checkInOut' ? 500 : 1000}
              onChange={(e) => update(key, e.target.value)}
              placeholder={t('lodging.unknown')}
            />,
          )}
        </div>
      ))}
      <fieldset className="space-y-3">
        <legend className="font-semibold">
          {t('lodging.gallery')} · {details.gallery.length}
        </legend>
        {details.gallery.map((photo, i) => (
          <div key={i} className="space-y-2 rounded-lg border p-3">
            <Input
              aria-label={`${t('lodging.imageUrl')} ${i + 1}`}
              value={photo.url}
              type="url"
              maxLength={2000}
              placeholder={t('lodging.imageUrl')}
              onChange={(e) =>
                update(
                  'gallery',
                  details.gallery.map((v, j) => (i === j ? { ...v, url: e.target.value } : v)),
                )
              }
            />
            <Input
              aria-label={`${t('lodging.caption')} ${i + 1}`}
              value={photo.caption}
              maxLength={300}
              placeholder={t('lodging.caption')}
              onChange={(e) =>
                update(
                  'gallery',
                  details.gallery.map((v, j) => (i === j ? { ...v, caption: e.target.value } : v)),
                )
              }
            />
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                update(
                  'gallery',
                  details.gallery.filter((_, j) => i !== j),
                )
              }
            >
              {t('lodging.remove')}
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={details.gallery.length >= 30}
          onClick={() => update('gallery', [...details.gallery, { url: '', caption: '' }])}
        >
          {t('lodging.addPhoto')}
        </Button>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t('lodging.invalid')}
        </p>
      )}
      <Button type="submit" disabled={save.isPending}>
        {t('lodging.save')}
      </Button>
    </form>
  );
}
