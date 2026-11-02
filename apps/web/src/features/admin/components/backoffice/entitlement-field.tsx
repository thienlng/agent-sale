import { AI_MODEL_TIERS, type EntitlementKind } from '@agent-sales/contracts';
import { useTranslation } from 'react-i18next';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/** "" → NaN, so an empty box fails validation instead of silently becoming 0. */
const toNumber = (text: string) => (text.trim() === '' ? Number.NaN : Number(text));
const toText = (n: unknown) => (typeof n === 'number' && !Number.isNaN(n) ? String(n) : '');

/** One entitlement value, edited according to its kind (`ENTITLEMENT_KEYS`). */
export function EntitlementField({
  id,
  entitlementKey,
  kind,
  value,
  invalid,
  onChange,
}: {
  id: string;
  entitlementKey: string;
  kind: EntitlementKind;
  value: unknown;
  invalid?: boolean;
  onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation('backoffice');
  const label = t(`entitlements.${entitlementKey}`, { defaultValue: entitlementKey });

  if (kind === 'flag') {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
        <Label htmlFor={id}>{label}</Label>
        <Switch id={id} checked={value === true} onCheckedChange={(v) => onChange(v)} />
      </div>
    );
  }

  if (kind === 'limit') {
    const unlimited = value === null;
    return (
      <div className="flex flex-col gap-2">
        <Label htmlFor={id}>{label}</Label>
        <div className="flex items-center gap-3">
          <Input
            id={id}
            inputMode="numeric"
            className="h-9"
            disabled={unlimited}
            value={unlimited ? '' : toText(value)}
            aria-invalid={invalid}
            onChange={(e) => onChange(toNumber(e.target.value))}
          />
          <label className="flex shrink-0 items-center gap-2 text-sm">
            <Switch
              checked={unlimited}
              aria-label={`${label}: ${t('common.unlimited')}`}
              onCheckedChange={(v) => onChange(v ? null : 0)}
            />
            {t('common.unlimited')}
          </label>
        </div>
        {invalid ? <p className="text-sm text-destructive">{t('plans.invalidNumber')}</p> : null}
      </div>
    );
  }

  if (kind === 'models') {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">{label}</legend>
        <div className="flex flex-wrap gap-4">
          {AI_MODEL_TIERS.map((tier) => (
            <label key={tier} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected.includes(tier)}
                onCheckedChange={(on) =>
                  onChange(
                    on
                      ? AI_MODEL_TIERS.filter((x) => x === tier || selected.includes(x))
                      : selected.filter((x) => x !== tier),
                  )
                }
              />
              {tier}
            </label>
          ))}
        </div>
        {invalid ? <p className="text-sm text-destructive">{t('plans.needModel')}</p> : null}
      </fieldset>
    );
  }

  const allowance = (value ?? {}) as { amount?: number; periodDays?: number };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-amount`} className="text-xs text-muted-foreground">
            {t('entitlements.amount')}
          </Label>
          <Input
            id={`${id}-amount`}
            inputMode="numeric"
            className="h-9"
            value={toText(allowance.amount)}
            aria-invalid={invalid}
            onChange={(e) => onChange({ ...allowance, amount: toNumber(e.target.value) })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-days`} className="text-xs text-muted-foreground">
            {t('entitlements.periodDays')}
          </Label>
          <Input
            id={`${id}-days`}
            inputMode="numeric"
            className="h-9"
            value={toText(allowance.periodDays)}
            aria-invalid={invalid}
            onChange={(e) => onChange({ ...allowance, periodDays: toNumber(e.target.value) })}
          />
        </div>
      </div>
      {invalid ? <p className="text-sm text-destructive">{t('plans.invalidNumber')}</p> : null}
    </fieldset>
  );
}
