const DEFAULT_TARGET = '/app/analytics';

/**
 * A post-login target, accepted only as a same-app path: one leading slash not followed by another
 * slash, and no backslash, space or control character anywhere (browsers drop tabs and newlines,
 * so `/\t/evil.example` would turn into `//evil.example`). Anything else gives the default page.
 * The backend keeps the same rule (`safeRedirect` in the identity module).
 */
export function safeRedirectPath(target: string | undefined | null): string {
  // eslint-disable-next-line no-control-regex
  return target && /^\/(?!\/)[^\x00-\x20\x7f\\]*$/.test(target) ? target : DEFAULT_TARGET;
}
