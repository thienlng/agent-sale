import type { OfferingDetails } from '@agent-sales/contracts';
import type { TFunction } from 'i18next';

import { formatVnd } from '@/lib/format';

/**
 * The price cell of a product row. A course or service priced 0 shows its price note, or "Liên hệ", never "0 ₫"
 * (an education or spa business may list one before its price is set); any other note sits after
 * the price.
 */
export function priceLabel(
  p: { priceMin: number; priceMax: number; offering?: OfferingDetails | null },
  offeringBusiness: boolean,
  t: TFunction,
): string {
  const note = p.offering?.priceNote.trim() ?? '';
  if (p.priceMax === 0 && (p.offering || offeringBusiness))
    return note || t('commerce.offering.priceOnRequest');
  const price =
    p.priceMin === p.priceMax
      ? formatVnd(p.priceMin)
      : `${formatVnd(p.priceMin)} – ${formatVnd(p.priceMax)}`;
  return note ? `${price} (${note})` : price;
}
