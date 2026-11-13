import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { requestDetailsLine, requestKindLabel } from './request-labels';

describe('requestKindLabel', () => {
  it('reads the service-group wording first for education and spa (LM3-10)', () => {
    const tt = ((key: string | string[]) =>
      Array.isArray(key) ? key.join('|') : key) as unknown as TFunction;
    expect(requestKindLabel(tt, 'trial', 'education')).toBe(
      'crm.requests.kindService.trial|crm.requests.kind.trial',
    );
    expect(requestKindLabel(tt, 'trial', 'saas')).toBe('crm.requests.kind.trial');
    expect(requestKindLabel(tt, 'appointment', 'spa')).toBe(
      'crm.requests.kindService.appointment|crm.requests.kind.appointment',
    );
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
