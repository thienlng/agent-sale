import type { UserId } from '@agent-sales/shared';

export interface MfaRecord {
  userId: UserId;
  secretSealed: string;
  enabledAt: Date | null;
  lastUsedStep: number;
  recoveryHashes: string[];
}

export interface MfaRepository {
  find(userId: UserId): Promise<MfaRecord | null>;
  /** Stores a pending secret, replacing an earlier pending one. False when MFA is already enabled. */
  savePending(userId: UserId, secretSealed: string): Promise<boolean>;
  /** Turns a pending setup on. False when there is none (or it is already on). */
  enable(userId: UserId, step: number, recoveryHashes: string[]): Promise<boolean>;
  /** Atomically moves lastUsedStep forward; false when `step` was already used (replay). */
  advanceStep(userId: UserId, step: number): Promise<boolean>;
  /** Atomically burns one recovery code; false when it is not (or no longer) valid. */
  consumeRecovery(userId: UserId, hash: string): Promise<boolean>;
  replaceRecovery(userId: UserId, hashes: string[]): Promise<void>;
  remove(userId: UserId): Promise<boolean>;
}

export const MFA_REPOSITORY = Symbol('MFA_REPOSITORY');
