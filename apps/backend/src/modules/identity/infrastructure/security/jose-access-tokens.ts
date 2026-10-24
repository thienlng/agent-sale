import { userId } from '@agent-sales/shared';
import {
  type CryptoKey,
  exportSPKI,
  generateKeyPair,
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
} from 'jose';

import type { AccessClaims, AccessTokens } from '../../application/ports/security.js';

export const ACCESS_TTL_SECONDS = 15 * 60;
const ISSUER = 'rapiz';
const AUDIENCE = 'rapiz-api';

/** EdDSA-signed JWT access tokens (ADR-007). Keys rotate via `kid`. */
export class JoseAccessTokens implements AccessTokens {
  private constructor(
    private readonly privateKey: CryptoKey,
    private readonly publicKey: CryptoKey,
    private readonly kid: string,
  ) {}

  /**
   * Uses JWT_PRIVATE_KEY / JWT_PUBLIC_KEY (PEM) when set. Outside production a
   * missing key pair is generated per process (tokens die on restart — fine for dev/tests).
   */
  static async create(env: {
    NODE_ENV: string;
    JWT_PRIVATE_KEY?: string | undefined;
    JWT_PUBLIC_KEY?: string | undefined;
    JWT_KEY_ID?: string | undefined;
  }): Promise<JoseAccessTokens> {
    if (env.JWT_PRIVATE_KEY && env.JWT_PUBLIC_KEY) {
      return new JoseAccessTokens(
        await importPKCS8(env.JWT_PRIVATE_KEY.replace(/\\n/g, '\n'), 'EdDSA'),
        await importSPKI(env.JWT_PUBLIC_KEY.replace(/\\n/g, '\n'), 'EdDSA'),
        env.JWT_KEY_ID ?? 'k1',
      );
    }
    if (env.NODE_ENV === 'production') {
      throw new Error('JWT_PRIVATE_KEY and JWT_PUBLIC_KEY are required in production');
    }
    const { privateKey, publicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    await exportSPKI(publicKey);
    return new JoseAccessTokens(privateKey, publicKey, 'dev-ephemeral');
  }

  async issue(claims: AccessClaims): Promise<{ token: string; expiresIn: number }> {
    const token = await new SignJWT({ sid: claims.sessionId })
      .setProtectedHeader({ alg: 'EdDSA', kid: this.kid })
      .setSubject(claims.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
      .sign(this.privateKey);
    return { token, expiresIn: ACCESS_TTL_SECONDS };
  }

  async verify(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['EdDSA'],
      });
      if (typeof payload.sub !== 'string' || typeof payload['sid'] !== 'string') return null;
      return { userId: userId(payload.sub), sessionId: payload['sid'] };
    } catch {
      return null;
    }
  }
}
