import { describe, expect, it } from 'vitest';

import {
  displayShortcut,
  filterQuickReplies,
  isValidShortcut,
  normalizeShortcut,
} from './quick-replies';
import { trainingItem } from './test-items';

describe('filterQuickReplies', () => {
  const withImage = trainingItem({
    kind: 'quick_reply',
    trigger: 'gia',
    content: 'Bảng giá mới',
    mediaUrl: 'https://cdn.test/price.png',
  });
  const textOnly = trainingItem({ kind: 'quick_reply', trigger: 'ship', content: 'Phí ship 30k' });
  const items = [withImage, textOnly, trainingItem({ kind: 'media', title: 'gia' })];

  it('keeps only quick replies', () => {
    expect(filterQuickReplies(items, '', 'all')).toEqual([withImage, textOnly]);
  });

  it('filters by image presence', () => {
    expect(filterQuickReplies(items, '', 'with')).toEqual([withImage]);
    expect(filterQuickReplies(items, '', 'without')).toEqual([textOnly]);
  });

  it('searches content and shortcut without accents', () => {
    expect(filterQuickReplies(items, 'phi', 'all')).toEqual([textOnly]);
    expect(filterQuickReplies(items, 'GIA', 'all')).toEqual([withImage]);
  });
});

describe('shortcuts', () => {
  it('strips the leading slash and spaces around', () => {
    expect(normalizeShortcut('  /chao ')).toBe('chao');
  });

  it('rejects empty shortcuts and inner spaces', () => {
    expect(isValidShortcut('chao')).toBe(true);
    expect(isValidShortcut('')).toBe(false);
    expect(isValidShortcut('xin chao')).toBe(false);
  });

  it('displays with a slash, falling back to the title', () => {
    expect(displayShortcut({ trigger: 'abc', title: 'x' })).toBe('/abc');
    expect(displayShortcut({ trigger: '', title: 'old' })).toBe('/old');
  });
});
