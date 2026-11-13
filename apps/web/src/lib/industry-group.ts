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

/**
 * A label that a `service` business (education, spa) words differently, as i18n keys: its own
 * key under `serviceBase` first, the shared key under `base` as the fallback (i18next picks the
 * first key that exists), so a service business never reads "sản phẩm", "tồn kho" or "đơn".
 * Hotels keep their own wording through their own pages.
 */
export function groupWording(
  industry: string | undefined,
  base: string,
  serviceBase: string,
): (key: string) => string | string[] {
  const service = industryGroup(industry) === 'service';
  return (key) => (service ? [`${serviceBase}.${key}`, `${base}.${key}`] : `${base}.${key}`);
}
