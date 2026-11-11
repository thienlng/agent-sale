import { z } from 'zod';

const email = z
  .email()
  .max(254)
  .transform((v) => v.trim().toLowerCase());
const password = z.string().min(8).max(128);

/** A 6-digit code sent by email (signup, password reset). */
const emailCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/);

/** Signup, before the form is sent: emails a code to the address (one per minute). */
export const SignupCodeRequest = z.object({
  email,
  /** Greets the reader of the email when the form already has it. */
  name: z.string().trim().max(120).optional(),
});
export type SignupCodeRequest = z.infer<typeof SignupCodeRequest>;

/**
 * Creates the user, its email already verified by `code` (from `POST /auth/signup/code`). The first
 * business (name, industry) is chosen afterwards (`POST /auth/signup/business`). Unknown fields are
 * ignored.
 */
export const SignupRequest = z.object({
  name: z.string().trim().min(1).max(120),
  email,
  password,
  code: emailCode,
  phone: z.string().trim().max(32).optional(),
  /** `native` returns the refresh token in the body instead of a cookie (mobile/desktop clients). */
  client: z.enum(['web', 'native']).default('web'),
});
export type SignupRequest = z.infer<typeof SignupRequest>;

export const ForgotPasswordRequest = z.object({ email });
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequest>;

export const ResetPasswordRequest = z.object({ email, code: emailCode, password });
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequest>;

/** The second signup step: the user's first business, with the signup trial. */
export const SignupBusinessRequest = z.object({
  workspaceName: z.string().trim().min(1).max(120),
  industry: z.string().trim().min(1).max(64),
});
export type SignupBusinessRequest = z.infer<typeof SignupBusinessRequest>;

export const SignupBusinessResponse = z.object({ workspaceId: z.uuid() });
export type SignupBusinessResponse = z.infer<typeof SignupBusinessResponse>;

export const LoginRequest = z.object({
  email,
  password: z.string().min(1).max(128),
  /** Authenticator code or recovery code; required when the account has two-factor on. */
  code: z.string().trim().min(6).max(32).optional(),
  client: z.enum(['web', 'native']).default('web'),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

/** Which sign-in methods besides email + password this server offers. */
export const AuthProvidersResponse = z.object({ google: z.boolean() });
export type AuthProvidersResponse = z.infer<typeof AuthProvidersResponse>;

/** `redirect`: the same-app path to open after signing in. */
export const GoogleStartQuery = z.object({ redirect: z.string().max(500).optional() });
export type GoogleStartQuery = z.infer<typeof GoogleStartQuery>;

export const GoogleCallbackQuery = z.object({
  code: z.string().max(2048).optional(),
  state: z.string().max(200).optional(),
  error: z.string().max(200).optional(),
});
export type GoogleCallbackQuery = z.infer<typeof GoogleCallbackQuery>;

/** The second factor after a Google sign-in; the pending sign-in rides in an HttpOnly cookie. */
export const GoogleMfaRequest = z.object({ code: z.string().trim().min(6).max(32) });
export type GoogleMfaRequest = z.infer<typeof GoogleMfaRequest>;

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
  isPlatformAdmin: z.boolean(),
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
  /** Changes with the business logo; absent or null when it has none (fetch `GET /workspace/logo`). */
  logoVersion: z.string().nullable().optional(),
  /** Icon shown when there is no logo (one of `BUSINESS_ICONS`). */
  icon: z.string().optional(),
  industry: z.string().default(''),
  /** The account that owns the business (ADR-012); null until the backfill ran. */
  accountId: z.uuid().nullable().default(null),
  /** Shown to group the business switcher; membership of the account is not implied. */
  accountName: z.string().nullable().default(null),
  /** When the business was created (ISO); absent from older clients' cached sessions. */
  createdAt: z.string().optional(),
});
export type MembershipDto = z.infer<typeof MembershipDto>;

/** An account the user belongs to (ADR-012); the role covers account actions only. */
export const AccountMembershipDto = z.object({
  accountId: z.uuid(),
  name: z.string(),
  role: z.enum(['owner', 'billing']),
});
export type AccountMembershipDto = z.infer<typeof AccountMembershipDto>;

/** Everything the SPA needs before first paint (docs/09 token storage, docs/16 §1). */
export const BootstrapResponse = z.object({
  user: UserDto,
  memberships: z.array(MembershipDto),
  accounts: z.array(AccountMembershipDto).default([]),
});
export type BootstrapResponse = z.infer<typeof BootstrapResponse>;

// ─── two-factor (ADM-04) ─────────────────────────────────────────────────────

export const MfaStatus = z.object({
  enabled: z.boolean(),
  recoveryCodesLeft: z.number().int().nonnegative(),
});
export type MfaStatus = z.infer<typeof MfaStatus>;

export const MfaSetupRequest = z.object({ password: z.string().min(1).max(128) });
export type MfaSetupRequest = z.infer<typeof MfaSetupRequest>;

export const MfaSetup = z.object({
  /** Base32, for typing into an authenticator app by hand. */
  secret: z.string(),
  otpauthUri: z.string(),
});
export type MfaSetup = z.infer<typeof MfaSetup>;

export const MfaEnableRequest = z.object({ code: z.string().trim().length(6) });
export type MfaEnableRequest = z.infer<typeof MfaEnableRequest>;

/** Password again plus a current code: required to turn it off or to get new recovery codes. */
export const MfaReauthRequest = z.object({
  password: z.string().min(1).max(128),
  code: z.string().trim().min(6).max(32),
});
export type MfaReauthRequest = z.infer<typeof MfaReauthRequest>;

export const RecoveryCodes = z.object({ recoveryCodes: z.array(z.string()) });
export type RecoveryCodes = z.infer<typeof RecoveryCodes>;
