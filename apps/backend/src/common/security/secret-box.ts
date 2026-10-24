import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const VERSION = 'v1';

/**
 * Encrypts small secrets stored in the database (LLM API keys, later channel
 * tokens) with AES-256-GCM. The key lives outside the database
 * (SECRETS_ENCRYPTION_KEY), so a database dump alone does not leak secrets.
 * Format: `v1.<iv>.<tag>.<ciphertext>` (base64url); the version prefix leaves
 * room for key rotation.
 */
export class SecretBox {
  readonly #key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) throw new Error('SecretBox key must be 32 bytes');
    this.#key = key;
  }

  /** `base64` must decode to 32 bytes, e.g. `openssl rand -base64 32`. */
  static fromBase64(base64: string): SecretBox {
    return new SecretBox(Buffer.from(base64, 'base64'));
  }

  /** Deterministic key for development and tests only — never for real secrets. */
  static insecureDevelopmentBox(): SecretBox {
    return new SecretBox(createHash('sha256').update('rapiz-insecure-development-key').digest());
  }

  seal(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv, tag, data]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.');
  }

  /** Throws when the value was tampered with or sealed with another key. */
  open(sealed: string): string {
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== VERSION || !iv || !tag || data === undefined) {
      throw new Error('Unsupported secret format');
    }
    const authTag = Buffer.from(tag, 'base64url');
    // Pin the tag length: GCM would otherwise accept truncated tags, which are easier to forge.
    if (authTag.length !== 16) throw new Error('Invalid secret authentication tag');
    const decipher = createDecipheriv('aes-256-gcm', this.#key, Buffer.from(iv, 'base64url'), {
      authTagLength: 16,
    });
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}

export const SECRET_BOX = Symbol('SECRET_BOX');
