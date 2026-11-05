import { Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

import {
  MAX_PACKAGES,
  newPackage,
  type PackageDraft,
  type PackageField,
  type PackageProblems,
} from '../lib/packages-model';
import { intOrNull } from './property-tab-parts';

/** Name column, then bedrooms / standard adults / standard children / max, then remove. */
const GRID = 'sm:grid-cols-[minmax(10rem,1fr)_repeat(4,7.5rem)_2rem]';

const NUMBER_FIELDS = ['bedrooms', 'standardAdults', 'standardChildren', 'maxGuests'] as const;

/**
 * "Gói phòng" of one target (whole place or one unit): one line per bedroom package
 * with its name, bedrooms, standard adults / children and maximum, edited in place and
 * saved with the weekday prices. On a phone each package is a small card with labelled
 * fields; from `sm` the lines form a table under one header row.
 */
export function PackagesSection({
  unitId,
  packages,
  problems,
  overridesOf,
  disabled,
  onChange,
}: {
  unitId: string | null;
  /** Packages of this target, in saved order. */
  packages: PackageDraft[];
  /** Field problems per package key (shown after a save attempt). */
  problems: Map<string, PackageProblems>;
  /** Saved date-range prices of a package (removing it deletes them on save). */
  overridesOf: (packageId: string) => number;
  disabled: boolean;
  onChange: (next: PackageDraft[]) => void;
}) {
  const { t } = useTranslation('lodging');
  const id = useId();
  const [added, setAdded] = useState<string | null>(null);
  const [removing, setRemoving] = useState<PackageDraft | null>(null);
  const label = (field: PackageField) => t(`packages.${field}`);
  const set = (key: string, patch: Partial<PackageDraft>) =>
    onChange(packages.map((k) => (k.key === key ? { ...k, ...patch } : k)));
  const remove = (k: PackageDraft) => onChange(packages.filter((o) => o.key !== k.key));
  const add = () => {
    const k = newPackage(unitId);
    setAdded(k.key);
    onChange([...packages, k]);
  };
  const full = packages.length >= MAX_PACKAGES;
  const removingOverrides = removing?.id ? overridesOf(removing.id) : 0;

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{t('packages.title')}</h2>
          <p className="text-xs text-muted-foreground">{t('packages.hint')}</p>
        </div>
        {!disabled && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={full}
            title={full ? t('packages.limit', { count: MAX_PACKAGES }) : undefined}
            onClick={add}
          >
            <Plus aria-hidden />
            {t('packages.add')}
          </Button>
        )}
      </div>
      {packages.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('packages.empty')}</p>
      ) : (
        <div className="rounded-lg border">
          <div
            aria-hidden
            className={cn(
              'hidden gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground sm:grid',
              GRID,
            )}
          >
            <span>{label('name')}</span>
            {NUMBER_FIELDS.map((f) => (
              <span key={f} className="text-right">
                {label(f)}
              </span>
            ))}
            <span />
          </div>
          <ul className="divide-y">
            {packages.map((k, i) => {
              const fieldId = (f: PackageField) => `${id}-${i}-${f}`;
              const issues = problems.get(k.key) ?? {};
              const messages = Object.values(issues).map((code) => t(`packages.errors.${code}`));
              const errorId = `${id}-${i}-error`;
              const invalid = (f: PackageField) => (issues[f] ? true : undefined);
              const describe = (f: PackageField) => (issues[f] ? errorId : undefined);
              return (
                <li key={k.key} className={cn('relative grid grid-cols-2 gap-2 px-3 py-2.5', GRID)}>
                  <div className="col-span-2 grid gap-1.5 sm:col-span-1">
                    <Label htmlFor={fieldId('name')} className="text-xs sm:sr-only">
                      {label('name')}
                    </Label>
                    <Input
                      id={fieldId('name')}
                      value={k.name}
                      maxLength={50}
                      autoFocus={k.key === added}
                      disabled={disabled}
                      placeholder={t('packages.namePlaceholder')}
                      aria-invalid={invalid('name')}
                      aria-describedby={describe('name')}
                      onChange={(e) => set(k.key, { name: e.target.value })}
                    />
                  </div>
                  {!disabled && (
                    // Phone: top-right of the card, on the label line, so the name input
                    // keeps the full width; from `sm`: the last column of the line.
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      className="absolute top-1.5 right-2 sm:static sm:col-start-6 sm:row-start-1 sm:self-center"
                      aria-label={t('packages.remove', {
                        name: k.name.trim() || t('packages.unnamed'),
                      })}
                      onClick={() => (k.id && overridesOf(k.id) > 0 ? setRemoving(k) : remove(k))}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                  {NUMBER_FIELDS.map((f) => (
                    <div key={f} className="grid content-start gap-1.5">
                      <Label htmlFor={fieldId(f)} className="text-xs sm:sr-only">
                        {label(f)}
                      </Label>
                      <Input
                        id={fieldId(f)}
                        type="number"
                        inputMode="numeric"
                        min={f === 'standardChildren' ? 0 : 1}
                        disabled={disabled}
                        className="text-right tabular-nums"
                        placeholder={f === 'maxGuests' ? '—' : undefined}
                        value={k[f] ?? ''}
                        aria-invalid={invalid(f)}
                        aria-describedby={describe(f)}
                        onChange={(e) => {
                          const v = intOrNull(e.target.value);
                          set(k.key, { [f]: f === 'standardChildren' ? (v ?? 0) : v });
                        }}
                      />
                    </div>
                  ))}
                  {messages.length > 0 && (
                    <p id={errorId} className="col-span-full text-xs text-destructive">
                      {messages.join(' ')}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('packages.removeTitle', { name: removing?.name.trim() ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('packages.removeDescription', { count: removingOverrides })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('packages.keep')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (removing) remove(removing);
                setRemoving(null);
              }}
            >
              {t('packages.removeConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
