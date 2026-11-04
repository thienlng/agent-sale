/**
 * `crypto.randomUUID` exists only in secure contexts (HTTPS, localhost). Opened over plain HTTP by
 * IP (a dev server reached from another machine) it is missing and every form that makes an
 * idempotency key crashes. `getRandomValues` has no such limit, so it backs an RFC 4122 v4 id.
 */
export function randomUuidFallback(): `${string}-${string}-${string}-${string}-${string}` {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Installs the fallback once at startup, leaving the native one alone where it exists. */
export function ensureRandomUuid(): void {
  if (typeof crypto.randomUUID !== 'function') crypto.randomUUID = randomUuidFallback;
}
