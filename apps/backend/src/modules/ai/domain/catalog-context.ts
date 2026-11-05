import type { OfferingDetails, ProductDto } from '@agent-sales/contracts';

/** The offering facts the business filled in: empty texts, nulls and empty lists left out. */
export function offeringFacts(
  facts: Omit<OfferingDetails, 'kind'>,
): Partial<Omit<OfferingDetails, 'kind'>> {
  return Object.fromEntries(
    Object.entries(facts).filter(([, v]) =>
      Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim() !== '' : v !== null,
    ),
  );
}

/** What each folder holds, never a URL: the model sends one through its album / video ids. */
function folderSummary(
  albums: readonly { name: string; items: readonly { kind: string }[] }[] | undefined,
) {
  return (albums ?? []).map((a) => ({
    name: a.name,
    photos: a.items.filter((i) => i.kind === 'image').length,
    videos: a.items.filter((i) => i.kind === 'video').length,
    links: a.items.filter((i) => i.kind === 'link').length,
  }));
}

/**
 * The model view of a product that `product-view.ts` builds on. Accommodations have reference
 * tariffs and date occupancy, never stock availability. Courses and services (`offering`) have
 * their facts and prices, never stock either.
 */
export function catalogProductContext(product: ProductDto) {
  const base = {
    id: product.id,
    code: product.code,
    name: product.name,
    description: product.description,
    instructions: product.botInstructions,
  };
  if (product.accommodation) {
    const { gallery: _gallery, albums, units, ...details } = product.accommodation;
    const summary = folderSummary(albums);
    // A unit's own folders (T-193) are summarised the same way.
    const unitViews = units?.map(({ albums: own, ...unit }) => {
      const folders = folderSummary(own);
      return folders.length ? { ...unit, albums: folders } : unit;
    });
    const accommodation = {
      ...details,
      ...(unitViews ? { units: unitViews } : {}),
      ...(summary.length ? { albums: summary } : {}),
    };
    return {
      ...base,
      catalogKind: 'accommodation',
      accommodation,
      availability: 'unverified',
    };
  }
  if (product.offering) {
    // A course or a service: its facts instead of stock, prices without availability.
    const { kind, ...facts } = product.offering;
    return {
      ...base,
      catalogKind: kind,
      offering: offeringFacts(facts),
      variants: product.variants.map((v) => ({ sku: v.sku, name: v.name, priceVnd: v.price })),
    };
  }
  return {
    ...base,
    variants: product.variants.map((v) => ({
      sku: v.sku,
      name: v.name,
      priceVnd: v.price,
      available: v.stock.reduce((sum, s) => sum + s.available, 0),
    })),
  };
}
