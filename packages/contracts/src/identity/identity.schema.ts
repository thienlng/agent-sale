import { z } from 'zod';

const email = z
  .email()
  .max(254)
  .transform((v) => v.trim().toLowerCase());
const password = z.string().min(8).max(128);

export const SignupRequest = z.object({
  name: z.string().trim().min(1).max(120),
  email,
  password,
  phone: z.string().trim().max(32).optional(),
  workspaceName: z.string().trim().min(1).max(120),
  industry: z.string().trim().min(1).max(64),
  /** `native` returns the refresh token in the body instead of a cookie (mobile/desktop clients). */
  client: z.enum(['web', 'native']).default('web'),
});
export type SignupRequest = z.infer<typeof SignupRequest>;

export const LoginRequest = z.object({
  email,
  password: z.string().min(1).max(128),
  client: z.enum(['web', 'native']).default('web'),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

/** Native clients send the refresh token in the body; web clients rely on the HttpOnly cookie. */
export const RefreshRequest = z.object({
  refreshToken: z.string().min(20).max(200).optional(),
  client: z.enum(['web', 'native']).default('web'),
});
export type RefreshRequest = z.infer<typeof RefreshRequest>;

export const UserDto = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  emailVerified: z.boolean(),
  locale: z.string(),
  timezone: z.string(),
});
export type UserDto = z.infer<typeof UserDto>;

export const AuthResponse = z.object({
  accessToken: z.string(),
  /** Seconds until the access token expires. */
  expiresIn: z.number().int().positive(),
  user: UserDto,
  /** Only for `client: native`. */
  refreshToken: z.string().optional(),
});
export type AuthResponse = z.infer<typeof AuthResponse>;

export const MembershipDto = z.object({
  workspaceId: z.uuid(),
  workspaceName: z.string(),
  role: z.string(),
});
export type MembershipDto = z.infer<typeof MembershipDto>;

/** Everything the SPA needs before first paint (docs/09 token storage, docs/16 §1). */
export const BootstrapResponse = z.object({
  user: UserDto,
  memberships: z.array(MembershipDto),
});
export type BootstrapResponse = z.infer<typeof BootstrapResponse>;
