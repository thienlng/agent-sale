import type { ProductDto } from '@agent-sales/contracts';

/** Accommodations have reference tariffs and date occupancy, never stock availability. */
export function catalogProductContext(product: ProductDto) {
  const base = {
    id: product.id,
    code: product.code,
    name: product.name,
    description: product.description,
    instructions: product.botInstructions,
  };
  if (product.accommodation) {
    const { gallery: _gallery, ...details } = product.accommodation;
    return {
      ...base,
      catalogKind: 'accommodation',
      accommodation: details,
      availability: 'unverified',
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

export function catalogOverviewContext(product: ProductDto) {
  if (product.accommodation)
    return {
      name: product.name,
      catalogKind: 'accommodation',
      rentalType: product.accommodation.rentalType,
      rateBasis: product.accommodation.rateBasis,
      referenceRates: product.accommodation.rates,
      availability: 'unverified',
    };
  return {
    name: product.name,
    fromVnd: product.priceMin,
    toVnd: product.priceMax,
    inStock: product.available > 0,
  };
}
