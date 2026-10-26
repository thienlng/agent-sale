import { ANALYTICS_DEFINITION_VERSION, METRIC_KEYS } from '@agent-sales/contracts';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { ANALYTICS_FACADE, type AnalyticsFacade } from '../api/index.js';
import { AnalyticsModule } from '../analytics.module.js';

/** Contract test: the public API behaves as MODULE.md promises. */
describe('AnalyticsFacade (contract)', () => {
  it('is provided by the module', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AnalyticsModule] }).compile();
    expect(moduleRef.get(ANALYTICS_FACADE)).toBeDefined();
  });

  it('serves a versioned definition for every metric', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AnalyticsModule] }).compile();
    const facade = moduleRef.get<AnalyticsFacade>(ANALYTICS_FACADE);
    const { version, definitions } = facade.definitions();
    expect(version).toBe(ANALYTICS_DEFINITION_VERSION);
    expect(definitions.map((d) => d.key).sort()).toEqual([...METRIC_KEYS].sort());
  });
});
