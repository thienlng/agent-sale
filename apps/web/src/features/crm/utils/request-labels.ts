import type { CustomerRequestKind } from '@agent-sales/contracts';
import type { TFunction } from 'i18next';
import { groupWording } from '@/lib/industry-group';

/** The kind of a recorded request, in the service-group words for education and spa. */
export function requestKindLabel(
  t: TFunction,
  kind: CustomerRequestKind | string,
  industry?: string | undefined,
): string {
  // A service business (education, spa) words a trial as a trial class (LM3-10).
  return t(groupWording(industry, 'crm.requests.kind', 'crm.requests.kindService')(kind));
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
