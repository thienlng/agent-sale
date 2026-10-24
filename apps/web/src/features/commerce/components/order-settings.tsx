import { OPTIONAL_ORDER_STATUSES, OrderStatus } from '@agent-sales/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';

import { useOrderSettings, useSaveOrderSettings } from '../api/commerce';

function Chips<T extends string>({
  options,
  selected,
  onToggle,
  label,
}: {
  options: readonly T[];
  selected: ReadonlySet<string>;
  onToggle: (value: T) => void;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((s) => {
        const on = selected.has(s);
        return (
          <button
            key={s}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(s)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none',
              on
                ? 'border-primary bg-primary-soft font-medium text-accent-foreground'
                : 'hover:bg-muted',
            )}
          >
            {t(`status.${s}`)}
          </button>
        );
      })}
    </div>
  );
}

/** Order status settings (Preny "Trạng thái đơn hàng" tab). */
export function OrderStatusSettings() {
  const { t } = useTranslation();
  const settings = useOrderSettings();
  const save = useSaveOrderSettings();
  const [extra, setExtra] = useState<Set<string>>(new Set());
  const [requireNote, setRequireNote] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (settings.data) {
      setExtra(new Set(settings.data.extraStatuses));
      setRequireNote(new Set(settings.data.requireNoteStatuses));
    }
  }, [settings.data]);

  const toggle = (set: Set<string>, value: string) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  if (!settings.data) return <Skeleton className="h-64 rounded-xl" />;
  return (
    <div className="flex flex-col gap-6 rounded-xl border bg-card p-4 md:p-6">
      <section>
        <h2 className="font-semibold">{t('orderSettings.extra')}</h2>
        <p className="mt-1 mb-3 text-sm text-muted-foreground">{t('orderSettings.extraHint')}</p>
        <Chips
          label={t('orderSettings.extra')}
          options={OPTIONAL_ORDER_STATUSES}
          selected={extra}
          onToggle={(s) => setExtra(toggle(extra, s))}
        />
      </section>
      <section>
        <h2 className="font-semibold">{t('orderSettings.requireNote')}</h2>
        <p className="mt-1 mb-3 text-sm text-muted-foreground">
          {t('orderSettings.requireNoteHint')}
        </p>
        <Chips
          label={t('orderSettings.requireNote')}
          options={OrderStatus.options}
          selected={requireNote}
          onToggle={(s) => setRequireNote(toggle(requireNote, s))}
        />
      </section>
      <div>
        <Button
          disabled={save.isPending}
          onClick={() =>
            save.mutate(
              {
                extraStatuses: [...extra] as Array<(typeof OPTIONAL_ORDER_STATUSES)[number]>,
                requireNoteStatuses: [...requireNote] as OrderStatus[],
              },
              {
                onSuccess: () => toast.success(t('orderSettings.saved')),
                onError: (err) => toast.error(errorMessage(t, err)),
              },
            )
          }
        >
          {t('orderSettings.save')}
        </Button>
      </div>
    </div>
  );
}
