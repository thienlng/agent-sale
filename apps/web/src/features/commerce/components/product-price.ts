import type { OfferingDetails } from '@agent-sales/contracts';
import type { TFunction } from 'i18next';

import { formatVnd } from '@/lib/format';

/**
 * The price cell of a product row. A course or service never shows "0 ₫" (an education or spa
 * business may list one before its price is set): its range skips the 0-priced variants, and
 * with no price at all it shows its price note, or "Liên hệ". Any other note sits after the
 * price.
 */
export function priceLabel(
  p: {
    priceMin: number;
    priceMax: number;
    offering?: OfferingDetails | null;
    variants?: ReadonlyArray<{ price: number }>;
  },
  offeringBusiness: boolean,
  t: TFunction,
): string {
  const note = p.offering?.priceNote.trim() ?? '';
  let min = p.priceMin;
  let max = p.priceMax;
  if (p.offering || offeringBusiness) {
    const prices = (p.variants?.length ? p.variants.map((v) => v.price) : [min, max]).filter(
      (price) => price > 0,
    );
    if (!prices.length) return note || t('commerce.offering.priceOnRequest');
    min = Math.min(...prices);
    max = Math.max(...prices);
  }
  const price = min === max ? formatVnd(min) : `${formatVnd(min)} – ${formatVnd(max)}`;
  return note ? `${price} (${note})` : price;
}
