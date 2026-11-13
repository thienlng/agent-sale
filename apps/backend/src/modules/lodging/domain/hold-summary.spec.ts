import { describe, expect, it } from 'vitest';

import {
  buildHoldSummary,
  holdDurationText,
  shortWeekdayLabel,
  weekdayLabel,
  type HoldSummaryInput,
} from './hold-summary.js';

const villa: HoldSummaryInput = {
  propertyName: 'SKY VILLA A17',
  whole: true,
  unitNames: [],
  checkIn: '2026-11-06',
  checkOut: '2026-11-08',
  adults: 20,
  childAges: [],
  totalSell: 27_000_000,
  guestName: 'Anh Nam',
  guestPhone: '0901234567',
  holdMinutes: 120,
  note: '',
};

describe('weekday labels', () => {
  it('names ISO weekdays in Vietnamese, computed from the date', () => {
    expect(weekdayLabel('2026-11-02')).toBe('Thứ Hai');
    expect(weekdayLabel('2026-11-06')).toBe('Thứ Sáu');
    expect(weekdayLabel('2026-11-07')).toBe('Thứ Bảy');
    expect(weekdayLabel('2026-11-08')).toBe('Chủ Nhật');
    expect(shortWeekdayLabel('2026-11-06')).toBe('T6');
    expect(shortWeekdayLabel('2026-11-08')).toBe('CN');
  });
});

describe('holdDurationText', () => {
  it('speaks hours and minutes', () => {
    expect(holdDurationText(120)).toBe('2 giờ');
    expect(holdDurationText(30)).toBe('30 phút');
    expect(holdDurationText(90)).toBe('1 giờ 30 phút');
    expect(holdDurationText(0)).toBe('0 phút');
  });
});

describe('buildHoldSummary', () => {
  it('renders the fixed summary of a whole villa', () => {
    expect(buildHoldSummary(villa)).toBe(
      [
        'Giữ chỗ SKY VILLA A17',
        '06/11 (T6) → 08/11 (CN) · 2 đêm',
        '20 người lớn',
        'Tổng: 27.000.000đ',
        'Tên: Anh Nam · SĐT: 0901 234 567',
        'Giữ trong 2 giờ, nhân viên sẽ gọi xác nhận.',
      ].join('\n'),
    );
  });

  it('lists the rooms, the children with their ages and the note', () => {
    const text = buildHoldSummary({
      ...villa,
      propertyName: 'Homestay HS1',
      whole: false,
      unitNames: ['P1', 'P2'],
      adults: 3,
      childAges: [5, 8],
      note: '  Đến muộn  ',
    });
    expect(text.split('\n')).toEqual([
      'Giữ chỗ Homestay HS1 · phòng P1, P2',
      '06/11 (T6) → 08/11 (CN) · 2 đêm',
      '3 người lớn, 2 trẻ em (5, 8 tuổi)',
      'Tổng: 27.000.000đ',
      'Tên: Anh Nam · SĐT: 0901 234 567',
      'Ghi chú: Đến muộn',
      'Giữ trong 2 giờ, nhân viên sẽ gọi xác nhận.',
    ]);
  });

  it('names the bedroom package of a whole villa (T-193)', () => {
    const text = buildHoldSummary({ ...villa, packages: [{ unitName: null, name: '5PN' }] });
    expect(text.split('\n')[0]).toBe('Giữ chỗ SKY VILLA A17 · Nguyên căn · gói 5PN');
  });

  it('names the package of each room that has one (T-193)', () => {
    const rooms = {
      ...villa,
      propertyName: 'Resort Đồi',
      whole: false,
      unitNames: ['Bungalow 1', 'P2'],
      packages: [{ unitName: 'Bungalow 1', name: '2PN' }],
    };
    expect(buildHoldSummary(rooms).split('\n')[0]).toBe(
      'Giữ chỗ Resort Đồi · phòng Bungalow 1 (gói 2PN), P2',
    );
    const whole = { ...rooms, whole: true };
    expect(buildHoldSummary(whole).split('\n')[0]).toBe(
      'Giữ chỗ Resort Đồi · Nguyên căn · gói Bungalow 1: 2PN',
    );
  });
});

describe('buildHoldSummary in English (VL4-1)', () => {
  it('renders the same lines and figures for an English-speaking guest', () => {
    const text = buildHoldSummary({
      propertyName: 'Villa E64',
      whole: true,
      unitNames: [],
      checkIn: '2027-12-17',
      checkOut: '2027-12-19',
      adults: 12,
      childAges: [1, 4],
      totalSell: 27_000_000,
      guestName: 'Emily Carter',
      guestPhone: '+61412345678',
      holdMinutes: 15,
      note: '',
      replaces: 'BK-0016',
      language: 'en',
    });
    expect(text).toBe(
      [
        'Hold: Villa E64',
        '17/12 (Fri) → 19/12 (Sun) · 2 nights',
        '12 adults, 2 children (aged 1, 4)',
        'Total: 27.000.000đ',
        'Name: Emily Carter · Phone: +61412345678',
        'Replaces hold BK-0016 (cancelled when this one is placed)',
        'Held for 15 minutes; our staff will call you to confirm.',
      ].join('\n'),
    );
  });
});
