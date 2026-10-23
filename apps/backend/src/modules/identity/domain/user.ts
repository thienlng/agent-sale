import { newId, type UserId, userId } from '@agent-sales/shared';

import { WeakPasswordError } from './identity.errors.js';

export interface UserProps {
  id: UserId;
  email: string;
  name: string;
  phone: string | null;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  locale: string;
  timezone: string;
  createdAt: Date;
}

const COMMON_PASSWORDS = new Set([
  '12345678',
  '123456789',
  'password',
  'password1',
  'qwerty123',
  '11111111',
  '87654321',
  'abc12345',
  'matkhau123',
  'iloveyou',
]);

/**
 * Password policy (docs/09 §2): 8–128 chars, not a common password, not the
 * email/name. Checked before hashing; the hash itself is an infrastructure concern.
 */
export function assertPasswordAcceptable(
  password: string,
  ctx: { email: string; name: string },
): void {
  if (password.length < 8 || password.length > 128) {
    throw new WeakPasswordError('Password must be 8–128 characters');
  }
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) throw new WeakPasswordError('Password is too common');
  if (lower === ctx.email.toLowerCase() || lower === ctx.name.trim().toLowerCase()) {
    throw new WeakPasswordError('Password must differ from your email and name');
  }
}

export class User {
  private constructor(private readonly props: UserProps) {}

  static register(input: {
    email: string;
    name: string;
    phone?: string | undefined;
    passwordHash: string;
  }): User {
    return new User({
      id: userId(newId()),
      email: input.email.trim().toLowerCase(),
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      passwordHash: input.passwordHash,
      emailVerifiedAt: null,
      locale: 'vi',
      timezone: 'Asia/Ho_Chi_Minh',
      createdAt: new Date(),
    });
  }

  static rehydrate(props: UserProps): User {
    return new User(props);
  }

  get id(): UserId {
    return this.props.id;
  }

  get passwordHash(): string {
    return this.props.passwordHash;
  }

  snapshot(): Readonly<UserProps> {
    return { ...this.props };
  }
}
