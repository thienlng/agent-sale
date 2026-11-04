import {
  REQUEST_INDUSTRIES,
  REQUEST_PROFILES,
  type RequestStatusMove,
} from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';

import { defaultStatusesFor } from './crm-defaults.js';
import {
  catalogNameIn,
  dateLabel,
  decideStatusMove,
  historyDetails,
  isPastDate,
  requestNote,
  UPDATE_WINDOW_MS,
  withCatalogItem,
} from './customer-request.js';

const saas = REQUEST_PROFILES.saas;
const education = REQUEST_PROFILES.education;
const spa = REQUEST_PROFILES.spa;

describe('requestNote', () => {
  // The fixtures of saas/__tests__/saas-lead.spec.ts and the ADR-020 `leadNote` output.
  it('keeps the saas note byte-identical to the ADR-020 leadNote', () => {
    expect(
      requestNote(
        saas,
        'demo',
        { name: 'Chị Lan', phone: '0983 456 721', company: 'Shop Lan', teamSize: '5' },
        false,
      ),
    ).toBe('Xin demo (bot ghi nhận)\nTên: Chị Lan\nCông ty: Shop Lan\nQuy mô: 5');
    expect(
      requestNote(
        saas,
        'consultation',
        {
          name: 'Lan',
          phone: '0983456721',
          email: 'lan@example.test',
          company: '',
          teamSize: '',
          need: 'Quản lý đơn',
          preferredTime: '',
          planInterest: 'Pro',
        },
        false,
      ),
    ).toBe(
      'Xin tư vấn (bot ghi nhận)\nTên: Lan\nNhu cầu: Quản lý đơn\nGói quan tâm: Pro\nEmail: lan@example.test',
    );
    expect(
      requestNote(
        saas,
        'trial',
        { name: 'Synthetic lead', phone: '+84 983 456 721', need: 'Quản lý bán hàng', email: null },
        false,
      ),
    ).toBe('Xin dùng thử (bot ghi nhận)\nTên: Synthetic lead\nNhu cầu: Quản lý bán hàng');
  });

  it('writes an education note in field order, the date as its day label', () => {
    expect(
      requestNote(
        education,
        'placement_test',
        {
          name: 'Chị Hoa',
          phone: '0983456721',
          email: 'hoa@example.test',
          studentName: 'Bé Minh',
          studentAge: '9 tuổi',
          course: 'Tiếng Anh thiếu nhi',
          branch: 'Cầu Giấy',
          preferredDate: '2026-11-07',
          preferredTime: 'sáng',
          note: '',
        },
        false,
      ),
    ).toBe(
      [
        'Đăng ký kiểm tra trình độ (bot ghi nhận)',
        'Tên: Chị Hoa',
        'Email: hoa@example.test',
        'Học viên: Bé Minh',
        'Tuổi học viên: 9 tuổi',
        'Khoá học quan tâm: Tiếng Anh thiếu nhi',
        'Cơ sở: Cầu Giấy',
        'Ngày mong muốn: Thứ Bảy 07/11/2026',
        'Thời gian mong muốn: sáng',
      ].join('\n'),
    );
  });

  it('writes a spa note and marks an update', () => {
    const details = {
      name: 'Chị Mai',
      phone: '0983456721',
      service: 'Chăm sóc da',
      preferredTime: '2h chiều',
      guests: '2',
    };
    expect(requestNote(spa, 'appointment', details, false)).toBe(
      'Đặt lịch (bot ghi nhận)\nTên: Chị Mai\nDịch vụ: Chăm sóc da\nGiờ mong muốn: 2h chiều\nSố khách: 2',
    );
    expect(requestNote(spa, 'appointment', details, true)).toBe(
      'Cập nhật: Đặt lịch (bot ghi nhận)\nTên: Chị Mai\nDịch vụ: Chăm sóc da\nGiờ mong muốn: 2h chiều\nSố khách: 2',
    );
  });
});

describe('historyDetails', () => {
  it('drops phone, email and empty fields', () => {
    expect(
      historyDetails(education, {
        name: 'Chị Hoa',
        phone: '0983456721',
        email: 'hoa@example.test',
        course: 'IELTS',
        goal: '',
        preferredDate: '2026-11-07',
      }),
    ).toEqual({ name: 'Chị Hoa', course: 'IELTS', preferredDate: '2026-11-07' });
  });
});

describe('decideStatusMove', () => {
  const at = (current: number | null, target = 3) => ({ current, target });
  const forward: RequestStatusMove = { key: 'requested', move: 'forward_only' };

  it('moves saas forward only', () => {
    expect(decideStatusMove(forward, null, at(null))).toBe(true);
    expect(decideStatusMove(forward, 'new_lead', at(1))).toBe(true);
    expect(decideStatusMove(forward, 'contacted', at(2))).toBe(true);
    expect(decideStatusMove(forward, 'requested', at(3))).toBe(false);
    expect(decideStatusMove(forward, 'demo_scheduled', at(4))).toBe(false);
    expect(decideStatusMove(forward, 'paying', at(7))).toBe(false);
    // A custom status (no key) counts by its position.
    expect(decideStatusMove(forward, null, at(1))).toBe(true);
    expect(decideStatusMove(forward, null, at(9))).toBe(false);
  });

  // Spec §4.1 status table, every row.
  const rows: Array<[keyof typeof REQUEST_PROFILES, string, string | null, boolean]> = [
    ['education', 'placement_test', null, true],
    ['education', 'placement_test', 'new_lead', true],
    ['education', 'placement_test', 'consulting', true],
    ['education', 'placement_test', 'test_requested', false],
    ['education', 'placement_test', 'test_scheduled', false],
    ['education', 'placement_test', 'tested', false],
    ['education', 'placement_test', 'enrolled', false],
    ['education', 'placement_test', 'lost', true],
    ['education', 'trial', 'consulting', true],
    ['education', 'trial', 'test_scheduled', false],
    ['education', 'trial', 'tested', false],
    ['education', 'trial', 'enrolled', false],
    ['education', 'trial', 'lost', true],
    ['education', 'consultation', 'new_lead', true],
    ['education', 'consultation', 'consulting', false],
    ['education', 'consultation', 'test_requested', false],
    ['education', 'consultation', 'test_scheduled', false],
    ['education', 'consultation', 'tested', false],
    ['education', 'consultation', 'enrolled', false],
    ['education', 'consultation', 'lost', true],
    ['spa', 'appointment', null, true],
    ['spa', 'appointment', 'new_lead', true],
    ['spa', 'appointment', 'consulting', true],
    ['spa', 'appointment', 'booking_requested', false],
    ['spa', 'appointment', 'booked', false],
    ['spa', 'appointment', 'visited', true],
    ['spa', 'appointment', 'no_show', true],
    ['spa', 'appointment', 'lost', true],
    ['spa', 'consultation', 'new_lead', true],
    ['spa', 'consultation', 'consulting', false],
    ['spa', 'consultation', 'booking_requested', false],
    ['spa', 'consultation', 'booked', false],
    ['spa', 'consultation', 'visited', false],
    ['spa', 'consultation', 'no_show', true],
    ['spa', 'consultation', 'lost', true],
  ];
  it.each(rows)('%s %s at %s moves: %s', (industry, kind, current, expected) => {
    const move = REQUEST_PROFILES[industry].status[kind as 'consultation'];
    expect(move).toBeDefined();
    expect(decideStatusMove(move!, current, at(current ? 2 : null))).toBe(expected);
  });
});

describe('dateLabel', () => {
  it('names each weekday', () => {
    expect(
      [
        '2026-11-02',
        '2026-11-03',
        '2026-11-04',
        '2026-11-05',
        '2026-11-06',
        '2026-11-07',
        '2026-11-08',
      ].map(dateLabel),
    ).toEqual([
      'Thứ Hai 02/11/2026',
      'Thứ Ba 03/11/2026',
      'Thứ Tư 04/11/2026',
      'Thứ Năm 05/11/2026',
      'Thứ Sáu 06/11/2026',
      'Thứ Bảy 07/11/2026',
      'Chủ Nhật 08/11/2026',
    ]);
  });

  it('is null for a value that is not a calendar date', () => {
    expect(dateLabel('')).toBeNull();
    expect(dateLabel('2026-02-30')).toBeNull();
    expect(dateLabel('mai')).toBeNull();
  });
});

describe('isPastDate', () => {
  it('compares against today in Asia/Ho_Chi_Minh', () => {
    // 16:59:59Z on Nov 4 is 23:59:59 on Nov 4 in Vietnam.
    const lateNov4 = new Date('2026-11-04T16:59:59Z');
    expect(isPastDate('2026-11-03', lateNov4)).toBe(true);
    expect(isPastDate('2026-11-04', lateNov4)).toBe(false);
    // 17:00Z on Nov 4 is already midnight of Nov 5 in Vietnam.
    const midnightNov5 = new Date('2026-11-04T17:00:00Z');
    expect(isPastDate('2026-11-04', midnightNov5)).toBe(true);
    expect(isPastDate('2026-11-05', midnightNov5)).toBe(false);
    expect(isPastDate('2027-01-01', midnightNov5)).toBe(false);
  });
});

describe('request profiles and statuses', () => {
  it('names only status keys the industry seeds', () => {
    for (const industry of REQUEST_INDUSTRIES) {
      const keys = new Set(defaultStatusesFor(industry).map((s) => s.key));
      for (const move of Object.values(REQUEST_PROFILES[industry].status)) {
        expect(keys).toContain(move.key);
        if (move.move === 'unless') for (const k of move.keep) expect(keys).toContain(k);
      }
    }
  });

  it('updates within 24 hours', () => {
    expect(UPDATE_WINDOW_MS).toBe(86_400_000);
  });
});

describe('catalogNameIn and withCatalogItem (T-187)', () => {
  const names = [
    'IELTS Foundation 5.5',
    'IELTS Intensive 6.5',
    'Khóa học Starters',
    'Gội đầu dưỡng sinh',
  ];

  it('finds the one catalog name a goal or note names, without diacritics too', () => {
    expect(catalogNameIn('Khoá Starters cho bé', names)).toBe('Khóa học Starters');
    expect(catalogNameIn('Đăng ký ielts foundation 5.5', names)).toBe('IELTS Foundation 5.5');
    expect(catalogNameIn('goi dau duong sinh', names)).toBe('Gội đầu dưỡng sinh');
  });

  it('leaves an ambiguous or unknown text alone', () => {
    expect(catalogNameIn('Kiểm tra trình độ IELTS', names)).toBeNull();
    expect(catalogNameIn('IELTS 6.5', names)).toBeNull();
    expect(catalogNameIn('IELTS Foundation', names)).toBeNull();
    expect(catalogNameIn('khoá học', names)).toBeNull();
    expect(catalogNameIn('Starters', [])).toBeNull();
  });

  it('fills an empty course from the goal and keeps the goal', () => {
    expect(withCatalogItem({ course: '', goal: 'Học khoá Starters' }, names)).toEqual({
      course: 'Khóa học Starters',
      goal: 'Học khoá Starters',
    });
  });

  it('fills an empty spa service from the note', () => {
    expect(withCatalogItem({ service: '', note: 'muốn gội đầu dưỡng sinh' }, names)).toMatchObject({
      service: 'Gội đầu dưỡng sinh',
    });
  });

  it('never replaces a given course, nor adds one where the profile has none', () => {
    expect(withCatalogItem({ course: 'IELTS', goal: 'Khoá Starters' }, names)).toMatchObject({
      course: 'IELTS',
    });
    expect(withCatalogItem({ need: 'IELTS Foundation' }, names)).toEqual({
      need: 'IELTS Foundation',
    });
  });
});
