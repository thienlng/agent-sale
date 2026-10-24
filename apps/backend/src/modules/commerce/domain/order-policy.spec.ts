import { describe, expect, it } from 'vitest';

import { missingFields } from './order-policy.js';

describe('missingFields', () => {
  const order = {
    customer: { phone: '', email: undefined },
    recipient: { phone: '0901234567', address: '   ' },
  };

  it('lists required fields that are blank, ignoring the rest', () => {
    expect(missingFields(order, ['recipientAddress', 'customerPhone', 'recipientPhone'])).toEqual([
      'customerPhone',
      'recipientAddress',
    ]);
  });

  it('nothing required, nothing missing', () => {
    expect(missingFields(order, [])).toEqual([]);
  });
});
