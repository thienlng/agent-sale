import 'reflect-metadata';
import { describe, expect, it } from 'vitest';

import { IS_WORKSPACE_SCOPED } from '../../../common/http/auth-context.js';
import { CatalogController } from '../interface/http/catalog.controller.js';

describe('CatalogController', () => {
  it('stays workspace-scoped (every catalog route needs a workspace)', () => {
    expect(Reflect.getMetadata(IS_WORKSPACE_SCOPED, CatalogController)).toBe(true);
  });
});
