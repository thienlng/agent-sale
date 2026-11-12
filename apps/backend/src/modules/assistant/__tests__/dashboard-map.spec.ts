import { describe, expect, it } from 'vitest';

import { industryGroup, pagesFor, renderDashboardMap } from '../domain/dashboard-map.js';

const paths = (industry: string | undefined): string[] => pagesFor(industry).map((p) => p.path);
const purposeOf = (industry: string, path: string): string =>
  pagesFor(industry).find((p) => p.path === path)?.purpose ?? '';

describe('dashboard map', () => {
  it('groups education and spa as service, hotel and saas on their own, the rest as shops', () => {
    expect(industryGroup('education')).toBe('service');
    expect(industryGroup('spa')).toBe('service');
    expect(industryGroup('hotel')).toBe('hotel');
    expect(industryGroup('saas')).toBe('saas');
    expect(industryGroup('retail')).toBe('shop');
    expect(industryGroup(undefined)).toBe('shop');
  });

  it.each(['education', 'spa'])(
    'gives %s its courses or services and its requests, but no orders or integrations',
    (industry) => {
      const have = paths(industry);
      expect(have).toContain('/app/products');
      expect(have).toContain('/app/products/new');
      expect(have).toContain('/app/contacts');
      expect(have.some((p) => p.startsWith('/app/orders'))).toBe(false);
      expect(have).not.toContain('/app/order-settings');
      expect(have).not.toContain('/app/integrations');
      expect(have).not.toContain('/app/calendar');
      expect(have).not.toContain('/app/crm-settings/saas-plans');
      expect(purposeOf(industry, '/app/products')).toContain(
        'courses (education) or services (spa) the business offers: duration, sessions, format, level, prices',
      );
      expect(purposeOf(industry, '/app/contacts')).toContain('requests the bot recorded');
      expect(renderDashboardMap(industry)).toContain('/app/products — courses (education)');
    },
  );

  it('keeps the shop, hotel and saas maps as they were', () => {
    expect(paths('retail')).toContain('/app/orders');
    expect(paths('retail')).toContain('/app/integrations');
    expect(purposeOf('retail', '/app/products')).toBe(
      'product catalog; /app/products/{productId} — edit one product',
    );
    expect(purposeOf('retail', '/app/contacts')).toBe('customers (CRM)');

    expect(paths('hotel')).toContain('/app/integrations');
    expect(paths('hotel')).toContain('/app/calendar');
    expect(paths('hotel')).not.toContain('/app/products');
    expect(paths('hotel').some((p) => p.startsWith('/app/orders'))).toBe(false);

    expect(paths('saas')).toContain('/app/crm-settings/saas-plans');
    expect(paths('saas')).not.toContain('/app/integrations');
    expect(paths('saas')).not.toContain('/app/products');
    expect(purposeOf('saas', '/app/contacts')).toBe('customers (CRM)');
  });

  it('opens Today inside the statistics page, with no page of its own', () => {
    for (const industry of ['retail', 'hotel', 'saas', 'education']) {
      expect(paths(industry)).not.toContain('/app/today');
      expect(purposeOf(industry, '/app/analytics')).toContain('what needs doing today');
      expect(purposeOf(industry, '/app/analytics')).toContain('statistics');
    }
  });
});
