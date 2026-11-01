import type { NightNoteDto, PropertyDto } from '@agent-sales/contracts';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { isStayRange, nightList } from '../lib/format';

export const MAX_NIGHT_NOTE = 300;

/** Where a night note goes: the property itself (null) or each selected room. */
export function noteTargets(
  property: Pick<PropertyDto, 'sellMode'> | undefined,
  sel: { whole: boolean; unitIds: string[] },
): Array<string | null> {
  if (!property || property.sellMode === 'whole' || sel.whole) return [null];
  return sel.unitIds;
}

/** The nights [checkIn, checkOut) of a valid range, else none. */
export function noteNights(checkIn: string, checkOut: string): string[] {
  return isStayRange(checkIn, checkOut) ? nightList(checkIn, checkOut) : [];
}

/**
 * Notes already stored on the targeted nights: `prefill` is their text when every targeted
 * night carries the same note, else ''; `any` = some night has a note; `mixed` = the nights
 * disagree (some differ or some have none), so saving replaces them all.
 */
export function existingNotes(
  notes: readonly NightNoteDto[],
  targets: Array<string | null>,
  nights: string[],
): { prefill: string; any: boolean; mixed: boolean } {
  const found = notes.filter((n) => targets.includes(n.unitId) && nights.includes(n.night));
  const texts = [...new Set(found.map((n) => n.text))];
  const uniform = texts.length === 1 && found.length === targets.length * nights.length;
  return {
    prefill: uniform ? (texts[0] ?? '') : '',
    any: found.length > 0,
    mixed: found.length > 0 && !uniform,
  };
}

/** The "Ghi chú" tab body: one staff-only text applied to each selected night. */
export function NightNoteFields({
  value,
  onChange,
  mixed,
}: {
  value: string;
  onChange: (text: string) => void;
  mixed: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="grid gap-1">
      <Label htmlFor={`${id}-note`} className="text-xs">
        {t('lodging.sheet.nightNoteLabel')}
      </Label>
      <Textarea
        id={`${id}-note`}
        rows={3}
        maxLength={MAX_NIGHT_NOTE}
        value={value}
        aria-describedby={`${id}-hint`}
        onChange={(e) => onChange(e.target.value)}
      />
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {mixed ? t('lodging.sheet.nightNoteMixed') : t('lodging.sheet.nightNoteHint')}
      </p>
    </div>
  );
}
