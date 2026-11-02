import { describe, expect, it } from 'vitest';

import { API_KEY_SCOPES, apiKeyRole, memberRoleOf, roleCan } from './access.schema.js';

describe('roleCan', () => {
  it('reads the capabilities of a member role', () => {
    expect(roleCan('owner', 'developer.manage')).toBe(true);
    expect(roleCan('sales', 'contacts.view_all')).toBe(false);
    expect(roleCan('legacy', 'contacts.view')).toBe(false);
    expect(roleCan(undefined, 'contacts.view')).toBe(false);
  });

  it('an API-key role can exactly its capabilities', () => {
    const role = apiKeyRole(['orders.view', 'contacts.view'], 'care');
    expect(role).toBe('api-key:care:contacts.view,orders.view');
    expect(memberRoleOf(role)).toBe('care');
    expect(memberRoleOf('sales')).toBe('sales');
    expect(roleCan(role, 'contacts.view')).toBe(true);
    expect(roleCan(role, 'orders.view')).toBe(true);
    expect(roleCan(role, 'orders.manage')).toBe(false);
    expect(roleCan(apiKeyRole([], 'owner'), 'contacts.view')).toBe(false);
  });

  it('no API-key scope manages people, settings, keys or the audit trail', () => {
    for (const c of ['members.manage', 'settings.manage', 'developer.manage', 'audit.view'])
      expect(API_KEY_SCOPES).not.toContain(c);
  });
});
