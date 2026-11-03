/** How the dashboard is shaped for a business; mirrors the backend dashboard map (`assistant`). */
export type IndustryGroup = 'shop' | 'hotel' | 'saas' | 'service';

/**
 * The dashboard group of an industry: `hotel` sells nights, `saas` keeps subscribers,
 * `service` (education, spa) sells courses and services and records requests instead of
 * orders; anything else is a `shop`. Undefined while the business is still loading.
 */
export function industryGroup(industry: string | undefined): IndustryGroup | undefined {
  if (industry === undefined) return undefined;
  if (industry === 'hotel') return 'hotel';
  if (industry === 'saas') return 'saas';
  if (industry === 'education' || industry === 'spa') return 'service';
  return 'shop';
}

/** The offering kind a `service` business sells; null for the other groups. */
export function offeringKindOf(industry: string | undefined): 'course' | 'service' | null {
  if (industry === 'education') return 'course';
  if (industry === 'spa') return 'service';
  return null;
}
