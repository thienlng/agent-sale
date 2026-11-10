import { describe, expect, it } from 'vitest';
import { onColor } from './view.js';

describe('onColor', () => {
  it('puts charcoal on light colours', () => {
    expect(onColor('#FF7A45')).toBe('#1F1F1F');
    expect(onColor('#ffffff')).toBe('#1F1F1F');
    expect(onColor('#fc0')).toBe('#1F1F1F');
  });

  it('puts white on dark colours', () => {
    expect(onColor('#1F1F1F')).toBe('#FFFFFF');
    expect(onColor('#1d4ed8')).toBe('#FFFFFF');
    expect(onColor('#000a')).toBe('#FFFFFF');
  });
});
