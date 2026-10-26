import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { AUDIT_FACADE } from '../api/index.js';
import { AuditModule } from '../audit.module.js';

/** Contract test: the public API behaves as MODULE.md promises. */
describe('AuditFacade (contract)', () => {
  it('is provided by the module', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AuditModule] }).compile();
    expect(moduleRef.get(AUDIT_FACADE)).toBeDefined();
  });
});
