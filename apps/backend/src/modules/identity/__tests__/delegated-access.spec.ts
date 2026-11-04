import { newId, userId } from '@agent-sales/shared';
import { decodeJwt } from 'jose';
import { describe, expect, it } from 'vitest';

import {
  DelegatedAccessService,
  MAX_DELEGATED_TTL_SECONDS,
} from '../application/delegated-access.js';
import { JoseAccessTokens } from '../infrastructure/security/jose-access-tokens.js';

async function setup() {
  const tokens = await JoseAccessTokens.create({ NODE_ENV: 'test' });
  const service = new DelegatedAccessService(tokens);
  const owner = userId(newId());
  const sessionId = newId();
  return { tokens, service, owner, sessionId };
}

describe('DelegatedAccessService', () => {
  it('mints a short-lived token of the same user and session, even from a token about to expire', async () => {
    const { tokens, service, owner, sessionId } = await setup();
    // The owner's own token has 2 s left.
    const { token: own } = await tokens.issue({ userId: owner, sessionId }, 2);
    const minted = await service.delegate(`Bearer ${own}`, 270);
    expect(minted).toBeTruthy();
    const claims = decodeJwt(minted!);
    expect(claims.sub).toBe(owner);
    expect(claims['sid']).toBe(sessionId);
    expect(claims['dlg']).toBe(true);
    expect(claims.exp! - claims.iat!).toBe(270);
    expect(await tokens.verify(minted!)).toEqual({ userId: owner, sessionId, delegated: true });
  });

  it('caps the lifetime at 10 minutes', async () => {
    const { tokens, service, owner, sessionId } = await setup();
    const { token: own } = await tokens.issue({ userId: owner, sessionId });
    const claims = decodeJwt((await service.delegate(`Bearer ${own}`, 3_600))!);
    expect(claims.exp! - claims.iat!).toBe(MAX_DELEGATED_TTL_SECONDS);
  });

  it('refuses invalid, expired, API-key and already delegated credentials', async () => {
    const { tokens, service, owner, sessionId } = await setup();
    expect(await service.delegate('Bearer nope', 60)).toBeNull();
    expect(await service.delegate('Basic abc', 60)).toBeNull();
    expect(await service.delegate('Bearer rpz_live_abc', 60)).toBeNull();
    const { token: expired } = await tokens.issue({ userId: owner, sessionId }, -1);
    expect(await service.delegate(`Bearer ${expired}`, 60)).toBeNull();
    const { token: own } = await tokens.issue({ userId: owner, sessionId });
    const minted = await service.delegate(`Bearer ${own}`, 60);
    expect(await service.delegate(`Bearer ${minted}`, 60)).toBeNull();
  });
});
