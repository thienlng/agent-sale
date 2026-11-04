import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { requestDetailsLine, requestKindLabel } from './request-labels';

const t = ((key: string) => key) as unknown as TFunction;

describe('requestKindLabel', () => {
  it('uses one wording for every industry', () => {
    expect(requestKindLabel(t, 'trial', 'education')).toBe('crm.requests.kind.trial');
    expect(requestKindLabel(t, 'consultation', 'education')).toBe('crm.requests.kind.consultation');
    expect(requestKindLabel(t, 'placement_test', 'education')).toBe(
      'crm.requests.kind.placement_test',
    );
    expect(requestKindLabel(t, 'trial', 'saas')).toBe('crm.requests.kind.trial');
    expect(requestKindLabel(t, 'appointment', 'spa')).toBe('crm.requests.kind.appointment');
  });
});

describe('requestDetailsLine', () => {
  it('joins the item, the branch and when, skipping empty parts', () => {
    expect(
      requestDetailsLine(
        { service: 'Gội đầu dưỡng sinh', branch: 'Quận 3', preferredTime: '14h' },
        'Thứ Bảy 08/11/2026',
      ),
    ).toBe('Gội đầu dưỡng sinh · Quận 3 · Thứ Bảy 08/11/2026, 14h');
    expect(requestDetailsLine({ course: 'IELTS 6.5', goal: 'du học' }, null)).toBe('IELTS 6.5');
    expect(requestDetailsLine({ planInterest: 'Pro', preferredTime: 'sáng mai' }, null)).toBe(
      'Pro · sáng mai',
    );
    expect(requestDetailsLine({}, null)).toBe('');
  });
});
