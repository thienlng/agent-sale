import { HealthResponse } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';

import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('returns a response that matches the contract', () => {
    const body = new HealthController().get();
    expect(HealthResponse.parse(body).status).toBe('ok');
  });
});
