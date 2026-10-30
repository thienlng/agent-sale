import { describe, expect, it } from 'vitest';
import { AccommodationDetails, type ProductDto } from '@agent-sales/contracts';
import { catalogOverviewContext, catalogProductContext } from '../domain/catalog-context.js';
import { buildAllowlist, libraryImages, productImages } from '../domain/image-allowlist.js';

const details = AccommodationDetails.parse({
  rentalType: 'entire_property',
  bedrooms: 1,
  standardAdults: 2,
  standardChildren: 1,
  childAgeBelow: 6,
  maxGuests: null,
  roomLayout: [{ name: 'Room', beds: 'One bed' }],
  amenities: [],
  rateBasis: 'unconfirmed',
  rates: [{ days: [1, 2, 3, 4, 5, 6, 7], amount: 100000 }],
  gallery: [
    { url: 'https://images.example.test/private-path.jpg', caption: 'Property photograph' },
  ],
});
const product: ProductDto = {
  id: '01900000-0000-7000-8000-000000000001',
  code: 'TEST',
  name: 'Test property',
  description: 'One whole property',
  category: null,
  status: 'active',
  visibleToBot: true,
  botInstructions: 'Never infer availability',
  imageUrls: [],
  variants: [],
  priceMin: 0,
  priceMax: 0,
  available: 0,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  accommodation: details,
};
describe('lodging catalog grounding', () => {
  it('lists the whole gallery (up to 15) with captions, independent of the query', () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        url: `https://images.example.test/${i}.jpg`,
        caption: i === 11 ? 'Hành lang tầng trên' : 'Ngoại thất',
      }));
    const ids = (n: number) =>
      productImages(
        [{ ...product, accommodation: { ...details, gallery: make(n) } }],
        'Cho xem hành lang',
      );
    expect(ids(12)).toHaveLength(12);
    expect(ids(12)[11]?.label).toContain('Hành lang');
    expect(ids(20)).toHaveLength(15);
  });

  it('does not turn zero warehouse inventory into a sold-out property or zero-price offer', () => {
    const overview = catalogOverviewContext(product);
    const full = catalogProductContext(product);
    expect(overview).toMatchObject({
      catalogKind: 'accommodation',
      availability: 'unverified',
      rateBasis: 'unconfirmed',
    });
    expect(overview).not.toHaveProperty('inStock');
    expect(overview).not.toHaveProperty('fromVnd');
    expect(full).not.toHaveProperty('variants');
    expect(full).toHaveProperty('accommodation.rates.0.amount', 100000);
  });
  it('never puts gallery URLs into model context', () => {
    expect(JSON.stringify(catalogProductContext(product))).not.toContain('https://');
  });
  it('keeps retail overview semantics unchanged', () => {
    expect(
      catalogOverviewContext({
        ...product,
        accommodation: null,
        priceMin: 50,
        priceMax: 70,
        available: 3,
      }),
    ).toEqual({ name: 'Test property', fromVnd: 50, toVnd: 70, inStock: true });
  });
  it('ranks a specifically requested room feature ahead of generic property matches before capping images', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      id: String(i),
      kind: 'media',
      title: i === 11 ? 'A17 hành lang' : 'A17 ảnh căn',
      trigger: i === 11 ? 'hành lang' : 'A17',
      mediaUrl: `https://images.example.test/${i}.jpg`,
    }));
    const allowed = buildAllowlist([], libraryImages(items, 'Cho xem ảnh hành lang A17'));
    expect(allowed[0]?.id).toBe('m:11');
    expect(allowed).toHaveLength(10);
  });
});
