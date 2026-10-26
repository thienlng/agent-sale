import { describe, expect, it } from 'vitest';

import { hashInvitationToken, invitationStatus, newInvitationToken } from './invitation.js';

describe('invitations', () => {
  it('stores only a hash of a long random secret', () => {
    const { token, hash } = newInvitationToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(hash).toBe(hashInvitationToken(token));
    expect(hash).not.toContain(token);
  });

  it('accepted and revoked win over expiry', () => {
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 1000);
    expect(invitationStatus({ expiresAt: future, acceptedAt: null, revokedAt: null })).toBe(
      'pending',
    );
    expect(invitationStatus({ expiresAt: past, acceptedAt: null, revokedAt: null })).toBe(
      'expired',
    );
    expect(invitationStatus({ expiresAt: past, acceptedAt: past, revokedAt: null })).toBe(
      'accepted',
    );
    expect(invitationStatus({ expiresAt: future, acceptedAt: null, revokedAt: past })).toBe(
      'revoked',
    );
  });
});
