import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface Option {
  value: string;
  label: string;
}

/** Choose none (= everyone), one or several; the button says what is chosen. */
export function MultiSelect({
  label,
  allLabel,
  emptyLabel,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  allLabel: string;
  /** Shown instead of the list when there is nothing to choose from. */
  emptyLabel: string;
  options: Option[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const chosen = options.filter((o) => value.includes(o.value));
  const summary =
    chosen.length === 0
      ? allLabel
      : chosen.length === 1
        ? (chosen[0]?.label ?? allLabel)
        : t('analytics.filters.selected', { count: chosen.length, defaultValue: '{{count}}' });
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label className="text-sm text-muted-foreground">{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="h-9 w-full min-w-40 justify-between font-normal"
            disabled={disabled}
          >
            <span className="truncate">{summary}</span>
            <ChevronDown className="size-4 shrink-0 opacity-60" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2" align="start">
          {options.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">{emptyLabel}</p>
          ) : (
            <ul className="flex max-h-64 flex-col overflow-y-auto">
              {options.map((o) => {
                const id = `ms-${label}-${o.value}`;
                return (
                  <li
                    key={o.value}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
                  >
                    <Checkbox
                      id={id}
                      checked={value.includes(o.value)}
                      onCheckedChange={(on) =>
                        onChange(on ? [...value, o.value] : value.filter((v) => v !== o.value))
                      }
                    />
                    <Label
                      htmlFor={id}
                      className="min-w-0 flex-1 cursor-pointer truncate font-normal"
                    >
                      {o.label}
                    </Label>
                  </li>
                );
              })}
            </ul>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
