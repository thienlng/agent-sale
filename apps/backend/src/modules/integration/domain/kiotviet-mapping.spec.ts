import { describe, expect, it } from 'vitest';

import { groupKvProducts, type KvProduct, masterOf, stripHtml } from './kiotviet-mapping.js';

const kv = (p: Partial<KvProduct> & { id: number }): KvProduct => ({
  code: `SP${p.id}`,
  name: `Product ${p.id}`,
  ...p,
});

describe('masterOf', () => {
  it('is the product itself for a master', () => expect(masterOf(kv({ id: 1 }))).toBe(1));
  it('follows masterProductId, then masterUnitId', () => {
    expect(masterOf(kv({ id: 2, masterProductId: 1 }))).toBe(1);
    expect(masterOf(kv({ id: 3, masterUnitId: 1 }))).toBe(1);
  });
});

describe('groupKvProducts', () => {
  it('maps a lone master to one product with one unnamed variant', () => {
    const [item, ...rest] = groupKvProducts([
      kv({
        id: 10,
        code: 'AO-01',
        name: 'Áo thun',
        fullName: 'Áo thun (full)',
        categoryName: 'Áo',
        basePrice: 150000.4,
        weight: 250.6,
        description: '<p>Cotton <b>100%</b></p>',
        images: ['https://img/1.jpg'],
      }),
    ]);
    expect(rest).toEqual([]);
    expect(item).toEqual({
      externalId: '10',
      name: 'Áo thun',
      description: 'Cotton 100%',
      category: 'Áo',
      active: true,
      sourceImageUrls: ['https://img/1.jpg'],
      variants: [
        { externalId: '10', sku: 'AO-01', name: '', price: 150000, weightGram: 251, position: 0 },
      ],
    });
  });

  it('joins attribute variants under their master, master first', () => {
    const items = groupKvProducts([
      kv({
        id: 22,
        code: 'AO-L',
        masterProductId: 20,
        attributes: [
          { attributeName: 'Màu', attributeValue: 'Đỏ' },
          { attributeName: 'Size', attributeValue: 'L' },
        ],
      }),
      kv({
        id: 20,
        code: 'AO-M',
        hasVariants: true,
        attributes: [
          { attributeName: 'Màu', attributeValue: 'Đỏ' },
          { attributeName: 'Size', attributeValue: 'M' },
        ],
      }),
      kv({
        id: 21,
        code: 'AO-S',
        masterProductId: 20,
        attributes: [{ attributeName: 'Size', attributeValue: 'S' }],
      }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]!.externalId).toBe('20');
    expect(items[0]!.variants.map((v) => [v.externalId, v.sku, v.name, v.position])).toEqual([
      ['20', 'AO-M', 'Đỏ / M', 0],
      ['21', 'AO-S', 'S', 1],
      ['22', 'AO-L', 'Đỏ / L', 2],
    ]);
  });

  it('adds the unit to variant names only when the group has several units', () => {
    const [many] = groupKvProducts([
      kv({ id: 30, unit: 'Lon', attributes: [{ attributeName: 'Vị', attributeValue: 'Cam' }] }),
      kv({ id: 31, masterUnitId: 30, unit: 'Thùng', conversionValue: 24, basePrice: 200000 }),
    ]);
    expect(many!.variants.map((v) => [v.name, v.price])).toEqual([
      ['Cam / Lon', 0],
      ['Thùng', 200000],
    ]);
    const [one] = groupKvProducts([
      kv({ id: 40, unit: 'Cái', attributes: [{ attributeName: 'Size', attributeValue: 'M' }] }),
      kv({
        id: 41,
        masterProductId: 40,
        unit: 'Cái',
        attributes: [{ attributeName: 'Size', attributeValue: 'L' }],
      }),
    ]);
    expect(one!.variants.map((v) => v.name)).toEqual(['M', 'L']);
  });

  it('keeps separate masters apart and in first-seen order', () => {
    const items = groupKvProducts([
      kv({ id: 2 }),
      kv({ id: 1 }),
      kv({ id: 3, masterProductId: 2 }),
    ]);
    expect(items.map((i) => [i.externalId, i.variants.length])).toEqual([
      ['2', 2],
      ['1', 1],
    ]);
  });

  it('groups children whose master is not in the set under the master id, leaving position 0 free', () => {
    const items = groupKvProducts([
      kv({
        id: 52,
        masterProductId: 50,
        name: 'Quần',
        attributes: [{ attributeName: 'Size', attributeValue: 'L' }],
      }),
      kv({
        id: 51,
        masterProductId: 50,
        name: 'Quần',
        attributes: [{ attributeName: 'Size', attributeValue: 'M' }],
      }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]!.externalId).toBe('50');
    expect(items[0]!.name).toBe('Quần');
    expect(items[0]!.variants.map((v) => [v.externalId, v.position])).toEqual([
      ['51', 1],
      ['52', 2],
    ]);
  });

  it('archives a master that is not for sale and takes only five pictures', () => {
    const [item] = groupKvProducts([
      kv({ id: 60, allowsSale: false, images: ['a', 'b', 'c', 'd', 'e', 'f'] }),
    ]);
    expect(item!.active).toBe(false);
    expect(item!.sourceImageUrls).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('handles a product without pictures, description, category, price or weight', () => {
    const [item] = groupKvProducts([kv({ id: 70, description: null, categoryName: null })]);
    expect(item).toMatchObject({ description: '', category: null, sourceImageUrls: [] });
    expect(item!.variants[0]).toMatchObject({ price: 0, weightGram: 0 });
  });

  it('returns nothing for an empty page', () => expect(groupKvProducts([])).toEqual([]));
});

describe('stripHtml', () => {
  it('removes tags and decodes common entities', () =>
    expect(stripHtml('<div>Giá&nbsp;tốt &amp; <i>bền</i> &lt;3&gt;</div>')).toBe(
      'Giá tốt & bền <3>',
    ));
  it('turns line breaks and paragraphs into new lines', () =>
    expect(stripHtml('<p>Dòng 1</p><p>Dòng 2<br/>Dòng 3</p>')).toBe('Dòng 1\nDòng 2\nDòng 3'));
  it('drops script and style content', () =>
    expect(stripHtml('<style>p{}</style>Hi<script>alert(1)</script>')).toBe('Hi'));
  it('leaves plain text alone', () => expect(stripHtml('  plain  text ')).toBe('plain text'));
});
