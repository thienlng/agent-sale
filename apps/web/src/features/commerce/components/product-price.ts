import type { OfferingDetails } from '@agent-sales/contracts';
import type { TFunction } from 'i18next';

import { formatVnd } from '@/lib/format';

const ON_REQUEST = /^liên hệ$/iu;
const FROM = /^(giá\s+)?từ$/iu;

/**
 * The price cell of a product row. A course or service never shows "0 ₫" (an education or spa
 * business may list one before its price is set): its range skips the 0-priced variants and says
 * when some packages are priced on request ("· có gói liên hệ"); with no price at all it shows
 * its price note (capitalised), or "Liên hệ" (one casing, whatever the note's). A "từ" note reads as a prefix
 * ("Từ 150.000 ₫", MS-28); any other note sits after the price.
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
  let note = p.offering?.priceNote.trim() ?? '';
  let min = p.priceMin;
  let max = p.priceMax;
  let onRequest = false;
  if (p.offering || offeringBusiness) {
    const all = p.variants?.length ? p.variants.map((v) => v.price) : [min, max];
    const prices = all.filter((price) => price > 0);
    if (!prices.length) {
      // A note shown alone starts upper case (LM3-10). A 0 price is not "Miễn phí": the seeded
      // catalogs use 0 for "not priced yet" as well, so only a note can say a thing is free.
      if (note && !ON_REQUEST.test(note))
        return note.charAt(0).toLocaleUpperCase('vi') + note.slice(1);
      return t('commerce.offering.priceOnRequest');
    }
    min = Math.min(...prices);
    max = Math.max(...prices);
    onRequest = Boolean(p.variants?.length) && prices.length < all.length;
    if (ON_REQUEST.test(note)) {
      onRequest = true;
      note = '';
    }
  }
  let price = min === max ? formatVnd(min) : `${formatVnd(min)} – ${formatVnd(max)}`;
  if (FROM.test(note)) {
    price = t('commerce.offering.priceFrom', { price: formatVnd(min) });
    note = '';
  }
  if (onRequest) price = t('commerce.offering.priceWithOnRequest', { price });
  return note ? `${price} (${note})` : price;
}
