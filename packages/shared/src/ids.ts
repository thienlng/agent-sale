/**
 * Branded identifier types. A `WorkspaceId` cannot be passed where a `UserId`
 * is expected even though both are UUID strings — this is the cheapest
 * tenant-isolation guard we have at compile time (ADR-004).
 */

declare const brand: unique symbol;
export type Brand<T, Name extends string> = T & { readonly [brand]: Name };

export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type UserId = Brand<string, 'UserId'>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string): void {
  if (!UUID_RE.test(value)) {
    throw new TypeError(`${label} must be a UUID, got "${value}"`);
  }
}

export function workspaceId(value: string): WorkspaceId {
  assertUuid(value, 'WorkspaceId');
  return value as WorkspaceId;
}

export function userId(value: string): UserId {
  assertUuid(value, 'UserId');
  return value as UserId;
}

/** UUIDv7 (time-ordered) — the id format for every table (docs/05). */
export function newId(): string {
  const now = BigInt(Date.now());
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[0] = Number((now >> 40n) & 0xffn);
  bytes[1] = Number((now >> 32n) & 0xffn);
  bytes[2] = Number((now >> 24n) & 0xffn);
  bytes[3] = Number((now >> 16n) & 0xffn);
  bytes[4] = Number((now >> 8n) & 0xffn);
  bytes[5] = Number(now & 0xffn);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70; // version 7
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
