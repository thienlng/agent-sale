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
});
