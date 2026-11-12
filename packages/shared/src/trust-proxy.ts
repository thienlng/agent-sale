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

const NAMED_RANGES = new Set(['loopback', 'linklocal', 'uniquelocal']);

/** `net.isIP` from `node:net`, passed in so this package stays free of Node built-ins. */
export type IsIp = (address: string) => number;

/**
 * Parses `TRUST_PROXY`: unset → the private ranges in production, loopback only elsewhere (a
 * local dev proxy); `false` → trust nothing; otherwise a comma-separated list of addresses or
 * CIDRs, each checked with `isIp` (prefix at most 32 for IPv4, 128 for IPv6). `true` is refused
 * (every hop trusted: the client picks its own address and every per-IP limit is void), and so is
 * a hop count (see `TrustProxySetting`). Throws an `Error` naming the bad entry.
 */
export function parseTrustProxy(
  raw: string | undefined,
  nodeEnv: string | undefined,
  isIp: IsIp,
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
  const bad = list.find((v) => !validEntry(v, isIp));
  if (bad !== undefined) {
    throw new Error(
      `TRUST_PROXY: "${bad}" is not an IP address, a CIDR (address/prefix, at most /32 for IPv4 ` +
        'and /128 for IPv6) or one of loopback, linklocal, uniquelocal',
    );
  }
  return list;
}

function validEntry(entry: string, isIp: IsIp): boolean {
  if (NAMED_RANGES.has(entry)) return true;
  const [address = '', prefix, ...rest] = entry.split('/');
  if (rest.length) return false;
  const version = isIp(address);
  if (version !== 4 && version !== 6) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (version === 4 ? 32 : 128);
}
