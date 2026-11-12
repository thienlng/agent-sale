/**
 * Which proxies an HTTP server believes about the client address (`X-Forwarded-For`), in a shape
 * Fastify's `trustProxy` option takes: addresses/CIDRs (or the `proxy-addr` names `loopback`,
 * `linklocal`, `uniquelocal`), or `false` for none. Hop counts are not offered: they cannot check
 * who the immediate peer is, and Fastify 5 treats a number as "trust nothing".
 */
export type TrustProxySetting = string[] | false;

/**
 * Production default: the private networks Nginx Proxy Manager and the Caddy `edge` container
 * talk on (docs/runbooks/deploy-vps.md). Walking `X-Forwarded-For` from the right, the first
 * public address is the peer NPM saw, whatever the client wrote into the header itself.
 */
export const PRODUCTION_TRUSTED_PROXIES: readonly string[] = [
  'loopback',
  'linklocal',
  'uniquelocal',
];

const ENTRY = /^(loopback|linklocal|uniquelocal|[0-9a-f.:]+(\/\d{1,3})?)$/;

/**
 * Parses `TRUST_PROXY`: unset → the private ranges in production, loopback only elsewhere (a
 * local dev proxy); `false` → trust nothing; otherwise a comma-separated list of addresses or
 * CIDRs. `true` is refused (every hop trusted: the client picks its own address and every per-IP
 * limit is void), and so is a hop count (see `TrustProxySetting`).
 */
export function parseTrustProxy(
  raw: string | undefined,
  nodeEnv: string | undefined,
): TrustProxySetting {
  const value = raw?.trim().toLowerCase() ?? '';
  if (!value) return nodeEnv === 'production' ? [...PRODUCTION_TRUSTED_PROXIES] : ['loopback'];
  if (value === 'false') return false;
  if (value === 'true' || /^\d+$/.test(value)) {
    throw new Error('TRUST_PROXY must list proxy addresses or CIDRs (not true or a hop count)');
  }
  const list = value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const bad = list.find((v) => !ENTRY.test(v));
  if (bad !== undefined) throw new Error(`TRUST_PROXY: "${bad}" is not an address or CIDR`);
  return list;
}
