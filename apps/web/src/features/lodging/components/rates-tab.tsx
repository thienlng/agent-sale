import type { PropertyDto } from '@agent-sales/contracts';
import { type FormEvent, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { MoneyInput } from '@/components/money-input';
import { Input } from '@/components/ui/input';

import { usePutRates, useUpdateProperty } from '../api/properties';
import { useSaveError } from '../hooks/use-save-error';
import { validatePackages } from '../lib/packages-model';
import {
  hasRatesErrors,
  packagesOf,
  type PriceDraft,
  rateRows,
  ratesBody,
  type RatesDraft,
  ratesDraftOf,
  validateRates,
  withPackages,
} from '../lib/rates-model';
import { OverridesSection } from './overrides-section';
import { PackagesSection } from './packages-section';
import { Field, intOrNull, TabSaveBar, useReportDirty, useTabDraft } from './property-tab-parts';
import { RatesMatrix, rowTitle } from './rates-matrix';

/**
 * "Giá" tab: weekday prices per target (whole place / rooms) with sell and cost, the
 * bedroom packages of a target ("Gói phòng"), surcharges and child ages saved together
 * (PUT rates with every package, then PATCH the ages when they changed); special dates
 * below are saved one by one.
 *
 * `target` narrows the editor to one target (a unit page: `unitId`; `null` = the whole
 * place): only its packages, matrix rows and special dates are shown, surcharges and
 * child ages are hidden, and a save still sends every target's prices and packages as
 * loaded. Without `target`, a `whole` place edits the whole place's packages; the rooms
 * of a `rooms` place show their packages' rows, edited on each unit's page.
 */
export function RatesTab({
  property: p,
  canEdit,
  onDirtyChange,
  target,
}: {
  property: PropertyDto;
  canEdit: boolean;
  onDirtyChange: (dirty: boolean) => void;
  target?: string | null;
}) {
  const { t } = useTranslation();
  const id = useId();
  const wholeName = t('lodging.rates.whole');
  const base = useMemo(() => ratesDraftOf(p, wholeName), [p, wholeName]);
  const { draft, setDraft, dirty, discard } = useTabDraft<RatesDraft>(base);
  const [submitted, setSubmitted] = useState(false);
  const putRates = usePutRates();
  const updateProperty = useUpdateProperty();
  const saveError = useSaveError();
  const pending = putRates.isPending || updateProperty.isPending;
  useReportDirty(dirty, onDirtyChange);
  const errors = validateRates(draft);
  const packageProblems = validatePackages(draft.packages);
  const set = (patch: Partial<RatesDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const filtered = target !== undefined;
  const packagesTarget = filtered ? target : p.sellMode === 'whole' ? null : undefined;
  const rows = rateRows(draft);
  const shownRows = filtered ? rows.filter((r) => r.unitId === target) : rows;
  const hiddenMissing = rows.filter((r) => r.unitId !== target && errors.rows.has(r.key));
  const overridesOf = (packageId: string) =>
    p.rates.filter((r) => r.kind === 'override' && r.packageId === packageId).length;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (hasRatesErrors(errors) || packageProblems.size > 0 || pending || !canEdit) return;
    const agesChanged =
      draft.childFreeBelow !== p.childFreeBelow || draft.childAdultFrom !== p.childAdultFrom;
    putRates.mutate(
      { id: p.id, body: ratesBody(draft, p.version) },
      {
        onSuccess: (saved) => {
          if (!agesChanged) return finish(saved);
          updateProperty.mutate(
            {
              id: p.id,
              body: {
                version: saved.version,
                patch: {
                  childFreeBelow: draft.childFreeBelow,
                  childAdultFrom: draft.childAdultFrom,
                },
              },
            },
            { onSuccess: finish, onError: (error) => saveError(error, { onStale: discard }) },
          );
        },
        onError: (error) => saveError(error, { onStale: discard }),
      },
    );
  };
  const finish = (saved: PropertyDto) => {
    setDraft(ratesDraftOf(saved, wholeName));
    setSubmitted(false);
    toast.success(t('lodging.editor.saved'), { duration: 3500 });
  };

  const price = (key: 'extraAdult' | 'extraChild') => (
    <PriceInputs
      id={`${id}-${key}`}
      label={t(`lodging.rates.${key}`)}
      value={draft[key]}
      disabled={!canEdit}
      onChange={(v) => set({ [key]: v })}
    />
  );

  return (
    <div className="grid gap-8">
      <form onSubmit={submit} noValidate className="grid gap-6">
        {packagesTarget !== undefined && (
          <PackagesSection
            unitId={packagesTarget}
            packages={packagesOf(draft.packages, packagesTarget)}
            problems={submitted ? packageProblems : new Map()}
            overridesOf={overridesOf}
            disabled={!canEdit}
            onChange={(next) => setDraft((d) => withPackages(d, packagesTarget, next))}
          />
        )}
        <section className="grid gap-2">
          <h2 className="text-base font-semibold">{t('lodging.rates.weekdayTitle')}</h2>
          <p className="text-xs text-muted-foreground">{t('lodging.rates.weekdayHint')}</p>
          <RatesMatrix
            rows={shownRows}
            errors={submitted ? errors.rows : new Map()}
            disabled={!canEdit}
            onChange={(key, cells) =>
              setDraft((d) => ({ ...d, cells: { ...d.cells, [key]: cells } }))
            }
          />
          {submitted && errors.empty && (
            <p role="alert" className="text-xs text-destructive">
              {t('lodging.rates.empty')}
            </p>
          )}
          {submitted && filtered && hiddenMissing.length > 0 && (
            <p role="alert" className="text-xs text-destructive">
              {t('lodging.rates.otherMissing', { rows: hiddenMissing.map(rowTitle).join(', ') })}
            </p>
          )}
        </section>
        {!filtered && (
          <>
            <section className="grid gap-3">
              <div>
                <h2 className="text-base font-semibold">{t('lodging.rates.surchargesTitle')}</h2>
                <p className="text-xs text-muted-foreground">{t('lodging.rates.surchargesHint')}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {price('extraAdult')}
                {price('extraChild')}
              </div>
            </section>
            <section className="grid gap-3">
              <h2 className="text-base font-semibold">{t('lodging.rates.childAgesTitle')}</h2>
              <div className="flex flex-wrap gap-4">
                <Field id={`${id}-free`} label={t('lodging.rates.childFreeBelow')}>
                  <Input
                    id={`${id}-free`}
                    type="number"
                    min={0}
                    max={18}
                    className="w-28"
                    disabled={!canEdit}
                    value={draft.childFreeBelow}
                    aria-invalid={(submitted && errors.childAges) || undefined}
                    onChange={(e) => set({ childFreeBelow: intOrNull(e.target.value) ?? 0 })}
                  />
                </Field>
                <Field
                  id={`${id}-adult`}
                  label={t('lodging.rates.childAdultFrom')}
                  error={
                    submitted && errors.childAges ? t('lodging.rates.childAgesInvalid') : undefined
                  }
                >
                  <Input
                    id={`${id}-adult`}
                    type="number"
                    min={1}
                    max={18}
                    className="w-28"
                    disabled={!canEdit}
                    value={draft.childAdultFrom}
                    aria-invalid={(submitted && errors.childAges) || undefined}
                    onChange={(e) => set({ childAdultFrom: intOrNull(e.target.value) ?? 1 })}
                  />
                </Field>
              </div>
            </section>
          </>
        )}
        <TabSaveBar
          dirty={dirty}
          pending={pending}
          canEdit={canEdit}
          label={t('lodging.rates.save')}
        />
      </form>
      <OverridesSection property={p} canEdit={canEdit} target={target} />
    </div>
  );
}

function PriceInputs({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: PriceDraft;
  disabled: boolean;
  onChange: (value: PriceDraft) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        <MoneyInput
          id={`${id}-sell`}
          aria-label={`${label} · ${t('lodging.rates.sell')}`}
          placeholder={t('lodging.rates.sell')}
          disabled={disabled}
          value={value.sell}
          onValueChange={(sell) => onChange({ ...value, sell })}
        />
        <MoneyInput
          id={`${id}-cost`}
          aria-label={`${label} · ${t('lodging.rates.cost')}`}
          placeholder={t('lodging.rates.cost')}
          disabled={disabled}
          value={value.cost}
          onValueChange={(cost) => onChange({ ...value, cost })}
        />
      </div>
    </fieldset>
  );
}
