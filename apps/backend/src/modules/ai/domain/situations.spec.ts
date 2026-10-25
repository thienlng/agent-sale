import { describe, expect, it } from 'vitest';
import { situationsText } from './situations.js';

const rule = (title: string, extra: object = {}) => ({ title, content: `${title} body`, ...extra });

describe('situationsText', () => {
  it('never includes a disabled rule', () => {
    const text = situationsText([rule('On'), rule('Off', { enabled: false })]);
    expect(text).toContain('On body');
    expect(text).not.toContain('Off');
  });

  it('groups general and after-order rules under their own headers', () => {
    const text = situationsText([
      rule('Thanks', { section: 'after_order' }),
      rule('Greeting', { trigger: 'hi' }),
    ]);
    expect(text.indexOf('## General rules')).toBeLessThan(text.indexOf('Greeting'));
    expect(text.indexOf('Greeting')).toBeLessThan(text.indexOf('## After an order'));
    expect(text.indexOf('## After an order')).toBeLessThan(text.indexOf('Thanks'));
    expect(text).toContain('right after an order or booking was just completed or confirmed');
    expect(text).toContain('action call succeeded');
    expect(text).toContain('Khi: hi');
  });

  it('treats items without the new fields as enabled general rules and omits empty sections', () => {
    const text = situationsText([rule('Old')]);
    expect(text).toBe('## General rules\n\nOld\nOld body');
    expect(text).not.toContain('After an order');
    expect(situationsText([rule('Off', { enabled: false })])).toBe('');
  });

  it('counts only enabled rules towards the cap of 20', () => {
    const items = [
      ...Array.from({ length: 5 }, (_, i) => rule(`Off${i}`, { enabled: false })),
      ...Array.from({ length: 22 }, (_, i) => rule(`R${i}`)),
    ];
    const text = situationsText(items);
    expect(text).toContain('R19 body');
    expect(text).not.toContain('R20 body');
  });

  it('applies the cap to the oldest rules first, whatever order the list arrives in', () => {
    const items = Array.from({ length: 22 }, (_, i) =>
      rule(`R${i}`, { createdAt: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z` }),
    ).reverse();
    const text = situationsText(items);
    expect(text).toContain('R0 body');
    expect(text).toContain('R19 body');
    expect(text).not.toContain('R20 body');
    expect(text.indexOf('R0 body')).toBeLessThan(text.indexOf('R1 body'));
  });

  it('cuts each long rule fairly and keeps both headers and every rule', () => {
    const long = (title: string, extra: object = {}) => ({
      title,
      content: `${title}-${'x'.repeat(5_000)}`,
      ...extra,
    });
    const items = [
      ...Array.from({ length: 19 }, (_, i) => long(`G${i}`)),
      long('Thanks', { section: 'after_order' }),
    ];
    const text = situationsText(items);
    expect(text.length).toBeLessThanOrEqual(20_000);
    expect(text).toContain('## General rules');
    expect(text).toContain('## After an order');
    for (const i of [0, 9, 18]) expect(text).toContain(`G${i}\nG${i}-`);
    expect(text).toContain('Thanks\nThanks-');
    expect(text.slice(text.indexOf('## After an order'))).toContain('Thanks-xxx');
  });

  it('keeps short rules whole when only some are long', () => {
    const items = [rule('Short'), { title: 'Long', content: 'y'.repeat(30_000) }];
    const text = situationsText(items);
    expect(text.length).toBeLessThanOrEqual(20_000);
    expect(text).toContain('Short\nShort body');
  });
});
