import type { CustomerRequestKind } from '@agent-sales/contracts';
import type { TFunction } from 'i18next';

/** The kind of a recorded request; every industry shares one wording. */
export function requestKindLabel(
  t: TFunction,
  kind: CustomerRequestKind | string,
  _industry?: string | undefined,
): string {
  return t(`crm.requests.kind.${kind}`);
}

/**
 * One line about a request: what (course, service or plan), where (branch) and when (the day
 * label and the time window), skipping what the customer did not say.
 */
export function requestDetailsLine(
  details: Readonly<Record<string, unknown>>,
  dateLabel: string | null | undefined,
): string {
  const text = (key: string) => {
    const v = details[key];
    return typeof v === 'string' ? v.trim() : '';
  };
  const when = [dateLabel ?? '', text('preferredTime')].filter(Boolean).join(', ');
  return [text('course') || text('service') || text('planInterest'), text('branch'), when]
    .filter(Boolean)
    .join(' · ');
}
