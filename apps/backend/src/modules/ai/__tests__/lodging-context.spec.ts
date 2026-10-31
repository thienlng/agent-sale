import { describe, expect, it } from 'vitest';
import { AccommodationDetails, type ProductDto } from '@agent-sales/contracts';
import { catalogProductContext } from '../domain/catalog-context.js';
import { buildAllowlist, libraryImages, productImages } from '../domain/image-allowlist.js';
import { compactProduct, productDetails } from '../domain/product-view.js';

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
  it('lists the whole gallery (up to 15) with captions', () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        url: `https://images.example.test/${i}.jpg`,
        caption: i === 11 ? 'Hành lang tầng trên' : 'Ngoại thất',
      }));
    const ids = (n: number) =>
      productImages([{ ...product, accommodation: { ...details, gallery: make(n) } }]);
    expect(ids(12)).toHaveLength(12);
    expect(ids(12)[11]?.label).toContain('Hành lang');
    expect(ids(20)).toHaveLength(15);
  });

  it('does not turn zero warehouse inventory into a sold-out property or zero-price offer', () => {
    const compact = compactProduct(product);
    const full = productDetails(product);
    expect(compact).toMatchObject({ catalogKind: 'accommodation' });
    expect(compact).not.toHaveProperty('inStock');
    expect(compact).not.toHaveProperty('fromVnd');
    expect(full).toMatchObject({
      catalogKind: 'accommodation',
      availability: 'unverified',
      accommodation: { rateBasis: 'unconfirmed' },
    });
    expect(full).not.toHaveProperty('variants');
    expect(full).toHaveProperty('accommodation.rates.0.amount', 100000);
    expect(catalogProductContext(product)).not.toHaveProperty('variants');
  });
  it('never puts gallery URLs into model context', () => {
    expect(JSON.stringify(catalogProductContext(product))).not.toContain('https://');
    expect(JSON.stringify(productDetails(product))).not.toContain('https://');
  });
  it('keeps retail compact semantics unchanged', () => {
    expect(
      compactProduct({
        ...product,
        accommodation: null,
        priceMin: 50,
        priceMax: 70,
        variants: [{ stock: [{ available: 3 }] } as unknown as ProductDto['variants'][number]],
      }),
    ).toMatchObject({ name: 'Test property', fromVnd: 50, toVnd: 70, inStock: true });
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
