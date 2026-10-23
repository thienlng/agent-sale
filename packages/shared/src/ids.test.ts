import { describe, expect, it } from 'vitest';

import { newId, workspaceId } from './ids.js';

describe('newId', () => {
  it('produces UUIDv7 values that sort by time', () => {
    const a = newId();
    const b = newId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a <= b).toBe(true);
  });
});

describe('workspaceId', () => {
  it('brands a valid uuid and rejects garbage', () => {
    expect(workspaceId(newId())).toBeTypeOf('string');
    expect(() => workspaceId('not-a-uuid')).toThrow(TypeError);
  });
});
