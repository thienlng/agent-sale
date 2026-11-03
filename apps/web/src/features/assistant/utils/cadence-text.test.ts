import { beforeAll, describe, expect, it } from 'vitest';

import { i18n, loadNamespace } from '@/lib/i18n';

import { cadenceText } from './cadence-text';

beforeAll(() => loadNamespace('assistant'));

describe('cadenceText', () => {
  it('says each kind in words', () => {
    const fixed = i18n.getFixedT('vi', 'assistant');
    expect(cadenceText({ kind: 'daily', at: '08:00' }, fixed)).toBe('Hằng ngày lúc 08:00');
    expect(cadenceText({ kind: 'weekly', days: [4, 1], at: '08:00' }, fixed)).toBe(
      'Thứ Hai, Thứ Năm hằng tuần lúc 08:00',
    );
    expect(cadenceText({ kind: 'weekly', days: [1, 2, 3, 4, 5, 6, 7], at: '07:30' }, fixed)).toBe(
      'Hằng ngày lúc 07:30',
    );
    expect(cadenceText({ kind: 'monthly', day: 1, at: '09:00' }, fixed)).toBe(
      'Ngày 1 hằng tháng lúc 09:00',
    );
    expect(cadenceText({ kind: 'monthly', day: -1, at: '18:00' }, fixed)).toBe(
      'Ngày cuối tháng lúc 18:00',
    );
    expect(cadenceText({ kind: 'every', minutes: 30 }, fixed)).toBe('Mỗi 30 phút');
    expect(cadenceText({ kind: 'every', minutes: 120 }, fixed)).toBe('Mỗi 2 giờ');
    expect(cadenceText({ kind: 'every', minutes: 1440 }, fixed)).toBe('Mỗi 1 ngày');
    expect(
      cadenceText({ kind: 'every', minutes: 60, activeFrom: '08:00', activeTo: '22:00' }, fixed),
    ).toBe('Mỗi 1 giờ (08:00–22:00)');
  });

  it('has English words too', () => {
    const fixed = i18n.getFixedT('en', 'assistant');
    expect(cadenceText({ kind: 'every', minutes: 60 }, fixed)).toBe('Every 1 hour');
    expect(cadenceText({ kind: 'weekly', days: [1], at: '08:00' }, fixed)).toBe(
      'Every Monday at 08:00',
    );
  });
});
