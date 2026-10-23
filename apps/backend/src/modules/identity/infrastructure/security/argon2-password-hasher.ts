import { hash, verify } from '@node-rs/argon2';

import type { PasswordHasher } from '../../application/ports/security.js';

// Argon2id with OWASP 2024 baseline parameters (19 MiB, t=2, p=1).
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export class Argon2PasswordHasher implements PasswordHasher {
  #dummyHash: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  async verify(stored: string, password: string): Promise<boolean> {
    try {
      return await verify(stored, password);
    } catch {
      return false;
    }
  }

  async dummyVerify(password: string): Promise<void> {
    this.#dummyHash ??= hash('razpi-timing-equalizer', OPTIONS);
    await this.verify(await this.#dummyHash, password);
  }
}
