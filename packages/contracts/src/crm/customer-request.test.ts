import { describe, expect, it } from 'vitest';

import { Industry } from '../bot/industry.js';
import { profileFieldsFor } from '../bot/profile.js';
import { SaasLeadDetails, SaasRequestKind } from '../saas/saas.schema.js';
import {
  CustomerRequestDto,
  CustomerRequestKind,
  REQUEST_INDUSTRIES,
  REQUEST_PROFILES,
  RequestSummaryDto,
  isRequestIndustry,
  requestDetailsSchema,
  requestProfileFor,
  unmetRules,
} from './customer-request.js';

const rulesKeys = (rules: readonly (string | readonly string[])[] | undefined) =>
  (rules ?? []).flatMap((r) => (typeof r === 'string' ? [r] : [...r]));

describe('request industries', () => {
  it('are industries, and only they have a profile', () => {
    for (const i of REQUEST_INDUSTRIES) expect(Industry.options).toContain(i);
    expect(REQUEST_INDUSTRIES).toEqual(['saas', 'education', 'spa']);
    for (const i of Industry.options)
      expect(requestProfileFor(i) !== null).toBe(isRequestIndustry(i));
    expect(requestProfileFor('nope')).toBeNull();
  });
});

describe.each(REQUEST_INDUSTRIES)('the %s request profile', (industry) => {
  const profile = REQUEST_PROFILES[industry];
  const fieldKeys = profile.fields.map((f) => f.key);

  it('labels every kind and gives it a status move and requirements', () => {
    expect(profile.toolName).toBe('record_request');
    expect(profile.kinds.length).toBeGreaterThan(0);
    for (const kind of profile.kinds) {
      expect(CustomerRequestKind.options).toContain(kind);
      expect(profile.kindLabels[kind]).toBeTruthy();
      expect(profile.status[kind]?.key).toBeTruthy();
      expect(profile.required[kind]).toEqual(expect.arrayContaining(['name', 'phone']));
    }
    for (const map of [profile.kindLabels, profile.required, profile.recommended, profile.status])
      for (const kind of Object.keys(map)) expect(profile.kinds).toContain(kind);
  });

  it('only requires and recommends its own fields', () => {
    expect(new Set(fieldKeys).size).toBe(fieldKeys.length);
    expect(fieldKeys).toEqual(expect.arrayContaining(['name', 'phone']));
    for (const kind of profile.kinds) {
      for (const key of rulesKeys(profile.required[kind])) expect(fieldKeys).toContain(key);
      for (const key of rulesKeys(profile.recommended[kind])) expect(fieldKeys).toContain(key);
    }
  });

  it('tells the model staff confirm and to call again on corrections', () => {
    expect(profile.description).toMatch(/call it again when/i);
    expect(profile.description).toMatch(/recorded true/);
    expect(profile.description).toMatch(/never promise/i);
  });

  it('builds a details schema of exactly its fields', () => {
    const schema = requestDetailsSchema(industry);
    expect(Object.keys(schema.shape)).toEqual(fieldKeys);
    expect(requestDetailsSchema(industry)).toBe(schema);
  });
});

describe('the saas profile keeps ADR-020', () => {
  const fixture = { name: 'Chị Lan', phone: '0983 456 721', company: 'Shop Lan', teamSize: '5' };

  it('has the same kinds and details as before', () => {
    expect(SaasRequestKind.options).toEqual(['demo', 'trial', 'consultation']);
    expect(REQUEST_PROFILES.saas.kinds).toEqual(SaasRequestKind.options);
    const parsed = requestDetailsSchema('saas').parse({ ...fixture, extra: 'dropped' });
    expect(parsed).toEqual({
      name: 'Chị Lan',
      phone: '0983 456 721',
      email: null,
      company: 'Shop Lan',
      teamSize: '5',
      need: '',
      preferredTime: '',
      planInterest: '',
    });
    expect(SaasLeadDetails.parse(fixture)).toEqual(parsed);
  });

  it('rejects what SaasLeadDetails rejected', () => {
    const bad = [
      { phone: '0983456721' },
      { name: 'Lan' },
      { ...fixture, name: '   ' },
      { ...fixture, email: 'not-an-email' },
      { ...fixture, need: 'x'.repeat(2001) },
      { ...fixture, teamSize: 'x'.repeat(61) },
    ];
    for (const b of bad) expect(SaasLeadDetails.safeParse(b).success).toBe(false);
    expect(SaasLeadDetails.parse({ ...fixture, email: ' Lan@Example.TEST ' }).email).toBe(
      'lan@example.test',
    );
  });

  it('moves every kind forward to requested', () => {
    for (const kind of SaasRequestKind.options)
      expect(REQUEST_PROFILES.saas.status[kind]).toEqual({
        key: 'requested',
        move: 'forward_only',
      });
  });

  it('lists its note labels in the leadNote order', () => {
    expect(
      REQUEST_PROFILES.saas.fields.filter((f) => f.key !== 'phone').map((f) => f.label),
    ).toEqual([
      'Tên',
      'Công ty',
      'Quy mô',
      'Nhu cầu',
      'Thời gian mong muốn',
      'Gói quan tâm',
      'Email',
    ]);
  });
});

describe('education and spa profiles', () => {
  it('match the spec table', () => {
    expect(REQUEST_PROFILES.education.kinds).toEqual(['placement_test', 'trial', 'consultation']);
    expect(REQUEST_PROFILES.spa.kinds).toEqual(['appointment', 'consultation']);
    expect(REQUEST_PROFILES.spa.required.appointment).toEqual([
      'name',
      'phone',
      'service',
      ['preferredDate', 'preferredTime'],
    ]);
    expect(REQUEST_PROFILES.education.status.consultation).toEqual({
      key: 'consulting',
      move: 'unless',
      keep: ['test_requested', 'test_scheduled', 'tested', 'enrolled'],
    });
    expect(REQUEST_PROFILES.spa.status.appointment).toEqual({
      key: 'booking_requested',
      move: 'unless',
      keep: ['booked'],
    });
    expect(REQUEST_PROFILES.spa.description).toContain(
      'preferredDate is YYYY-MM-DD only when the customer named a day; otherwise put their words in preferredTime',
    );
  });

  it('have the profile fields their bots need', () => {
    const keys = (i: string) => profileFieldsFor(i).map((f) => f.key);
    expect(keys('education')).toContain('branches');
    expect(keys('spa')).toEqual(expect.arrayContaining(['branches', 'reschedule']));
  });
});

describe('preferredDate', () => {
  const spa = requestDetailsSchema('spa');
  const base = { name: 'Lan', phone: '0983456721', service: 'Gội đầu' };
  const date = (preferredDate: unknown) => spa.safeParse({ ...base, preferredDate });

  it('is empty or a real YYYY-MM-DD date', () => {
    expect(spa.parse(base).preferredDate).toBe('');
    expect(date('').success).toBe(true);
    expect(date('2026-11-08').success).toBe(true);
    expect(date(' 2026-11-08 ').data?.preferredDate).toBe('2026-11-08');
    for (const bad of ['2026-02-30', '08/11/2026', 'thứ bảy', '2026-11-8', 20261108])
      expect(date(bad).success).toBe(false);
  });
});

describe('unmetRules', () => {
  it('counts a group as one entry named by its first key', () => {
    const rules = [['course', 'goal'], ['studentAge', 'studentLevel'], 'branch'] as const;
    expect(unmetRules(rules, {})).toEqual(['course', 'studentAge', 'branch']);
    expect(unmetRules(rules, { goal: 'IELTS', studentLevel: ' ', branch: 'Q1' })).toEqual([
      'studentAge',
    ]);
    expect(unmetRules(rules, { course: 'A', studentAge: '8', branch: 'online' })).toEqual([]);
    expect(unmetRules(undefined, {})).toEqual([]);
    expect(unmetRules(['email'], { email: null })).toEqual(['email']);
  });
});

describe('request DTOs', () => {
  const dto = {
    id: '00000000-0000-4000-8000-000000000001',
    contactId: '00000000-0000-4000-8000-000000000002',
    kind: 'appointment',
    update: false,
    details: { service: 'Gội đầu', branch: 'Q1' },
    dateLabel: 'Thứ Bảy 08/11/2026',
    recordedAt: '2026-11-04T03:00:00.000Z',
  };

  it('parse a request and a summary', () => {
    expect(CustomerRequestDto.parse(dto)).toEqual(dto);
    expect(
      RequestSummaryDto.parse({
        statuses: [
          {
            statusId: '00000000-0000-4000-8000-000000000003',
            key: 'booking_requested',
            name: 'Yêu cầu đặt lịch',
            color: '#f97316',
            count: 2,
          },
        ],
        open: [{ ...dto, contactName: null, statusKey: 'booking_requested' }],
        recorded7d: 2,
      }).open,
    ).toHaveLength(1);
  });
});
