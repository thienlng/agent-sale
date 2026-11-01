import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

import { SavingLabel } from './booking-fields';

/** Reports a tab's unsaved state to the editor (tab marker + leave guard). */
export function useReportDirty(dirty: boolean, onDirtyChange: (dirty: boolean) => void) {
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
}

/**
 * A tab's editable copy of `base` (memoised by the caller). When the property is
 * refetched and the copy was untouched, it follows the new data; edits are kept.
 */
export function useTabDraft<T>(base: T) {
  const [draft, setDraft] = useState<T>(base);
  const previous = useRef(base);
  useEffect(() => {
    const old = JSON.stringify(previous.current);
    previous.current = base;
    setDraft((d) => (JSON.stringify(d) === old ? base : d));
  }, [base]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  return { draft, setDraft, dirty };
}

/** Bottom bar of a tab: the submit button (spinner while saving) and an "unsaved" hint. */
export function TabSaveBar({
  dirty,
  pending,
  label,
  canEdit,
}: {
  dirty: boolean;
  pending: boolean;
  label: string;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  if (!canEdit)
    return <p className="text-sm text-muted-foreground">{t('lodging.editor.readOnly')}</p>;
  return (
    <div className="flex flex-wrap items-center gap-3 border-t pt-4">
      <Button type="submit" disabled={pending}>
        <SavingLabel saving={pending}>{label}</SavingLabel>
      </Button>
      {dirty && (
        <span className="text-xs text-muted-foreground">{t('lodging.editor.unsavedMark')}</span>
      )}
    </div>
  );
}

/** A labelled field with an optional hint and an inline error under it. */
export function Field({
  id,
  label,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className ?? 'grid gap-1.5'}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** Whole numbers from a number input; empty or invalid → null. */
export function intOrNull(raw: string): number | null {
  if (!raw.trim()) return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}
