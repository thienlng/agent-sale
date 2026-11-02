/** `signup`: proves the address before the account exists. `reset_password`: forgotten password. */
export type EmailCodePurpose = 'signup' | 'reset_password';

export interface EmailCodeRecord {
  /** Lower-cased address the code was sent to. */
  email: string;
  purpose: EmailCodePurpose;
  codeHash: string;
  attempts: number;
  sentAt: Date;
  expiresAt: Date;
}

/** One live emailed code per address and purpose (migration 0056). */
export interface EmailCodeRepository {
  find(email: string, purpose: EmailCodePurpose): Promise<EmailCodeRecord | null>;
  /** Replaces any earlier code of the same address and purpose. */
  put(record: EmailCodeRecord): Promise<void>;
  /** Counts a wrong guess. */
  addAttempt(email: string, purpose: EmailCodePurpose): Promise<void>;
  delete(email: string, purpose: EmailCodePurpose): Promise<void>;
}

export const EMAIL_CODE_REPOSITORY = Symbol('EMAIL_CODE_REPOSITORY');
