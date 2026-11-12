import { afterEach, describe, expect, it } from 'vitest';

import { configureEnv } from '../../../common/config.js';
import type { CheckReadiness } from '../application/check-readiness.js';
import { HealthController } from '../interface/http/health.controller.js';

type OpenApiDoc = { info: { version: string }; paths: Record<string, unknown> };

const controller = (): HealthController =>
  new HealthController({
    execute: async () => ({ status: 'ready', checks: [] }),
  } as unknown as CheckReadiness);

describe('HealthController', () => {
  afterEach(() => {
    configureEnv({ NODE_ENV: 'test' });
  });

  it('omits the build version from liveness in production', () => {
    configureEnv({ NODE_ENV: 'production', SECRETS_ENCRYPTION_KEY: 'k' });
    expect(controller().get()).not.toHaveProperty('version');
  });

  it('serves only the public API subset as /openapi.json in production', () => {
    configureEnv({ NODE_ENV: 'production', SECRETS_ENCRYPTION_KEY: 'k' });
    const c = controller();
    const doc = c.openapi() as OpenApiDoc;
    expect(doc).toEqual(c.publicOpenapi());
    expect(Object.keys(doc.paths)).not.toContain('/me');
    expect(doc.info.version).toBe('1');
  });

  it('keeps the build version and the full route map outside production', () => {
    configureEnv({ NODE_ENV: 'test' });
    const c = controller();
    expect(c.get()).toHaveProperty('version');
    expect(Object.keys((c.openapi() as OpenApiDoc).paths)).toContain('/me');
  });
});
