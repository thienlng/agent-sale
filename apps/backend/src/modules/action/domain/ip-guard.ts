import { isIPv4, isIPv6 } from 'node:net';

/**
 * Decides whether a resolved IP address may be contacted by the action executor.
 * Fails closed: anything that is not a canonical IPv4/IPv6 literal is "not public".
 * Pure, framework-free.
 */

type Cidr4 = readonly [base: number, bits: number];

const v4 = (a: number, b: number, c: number, d: number): number =>
  ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;

/** Non-public IPv4 ranges (IANA special-purpose registry, conservative). */
const BLOCKED_V4: readonly Cidr4[] = [
  [v4(0, 0, 0, 0), 8], // "this network"
  [v4(10, 0, 0, 0), 8], // RFC1918
  [v4(100, 64, 0, 0), 10], // CGNAT
  [v4(127, 0, 0, 0), 8], // loopback
  [v4(169, 254, 0, 0), 16], // link-local incl. cloud metadata
  [v4(172, 16, 0, 0), 12], // RFC1918
  [v4(192, 0, 0, 0), 24], // IETF protocol assignments
  [v4(192, 0, 2, 0), 24], // TEST-NET-1
  [v4(192, 168, 0, 0), 16], // RFC1918
  [v4(198, 18, 0, 0), 15], // benchmarking
  [v4(198, 51, 100, 0), 24], // TEST-NET-2
  [v4(203, 0, 113, 0), 24], // TEST-NET-3
  [v4(224, 0, 0, 0), 4], // multicast
  [v4(240, 0, 0, 0), 4], // reserved + broadcast
];

function inCidr4(ip: number, [base, bits]: Cidr4): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) >>> 0 === (base & mask) >>> 0;
}

function parseV4(text: string): number | null {
  if (!isIPv4(text)) return null;
  const [a, b, c, d] = text.split('.').map(Number) as [number, number, number, number];
  return v4(a, b, c, d);
}

/** Expands an IPv6 literal to 8 hextets, or null if it is not valid. */
function parseV6(input: string): number[] | null {
  const text = input.split('%')[0] ?? '';
  if (!isIPv6(text)) return null;
  let head = text;
  let tail4: number[] = [];
  const lastColon = text.lastIndexOf(':');
  const maybeV4 = text.slice(lastColon + 1);
  if (maybeV4.includes('.')) {
    const n = parseV4(maybeV4);
    if (n === null) return null;
    tail4 = [n >>> 16, n & 0xffff];
    head = text.slice(0, lastColon + 1) + '0:0';
  }
  const [left = '', right, ...extra] = head.split('::');
  if (extra.length > 0) return null;
  const toGroups = (s: string): number[] =>
    s === '' ? [] : s.split(':').map((h) => parseInt(h, 16));
  const l = toGroups(left);
  const r = right === undefined ? [] : toGroups(right);
  const groups =
    right === undefined ? l : [...l, ...new Array<number>(8 - l.length - r.length).fill(0), ...r];
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g))) return null;
  if (tail4.length === 2) {
    groups[6] = tail4[0] as number;
    groups[7] = tail4[1] as number;
  }
  return groups;
}

function isPublicV6(g: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  // IPv4-mapped (::ffff:a.b.c.d): judge the embedded IPv4 address.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return isPublicV4(((g6 << 16) | g7) >>> 0);
  }
  // Only global unicast 2000::/3 is considered; this drops ::, ::1, fc00::/7, fe80::/10,
  // ff00::/8, IPv4-compatible, NAT64 (64:ff9b::/96) and every other reserved block.
  if (g0 >> 13 !== 0b001) return false;
  if (g0 === 0x2001 && g1 === 0x0db8) return false; // documentation
  if (g0 === 0x2001 && g1 === 0) return false; // Teredo (embeds IPv4)
  if (g0 === 0x2002) return false; // 6to4 (embeds IPv4)
  return true;
}

function isPublicV4(ip: number): boolean {
  return !BLOCKED_V4.some((c) => inCidr4(ip, c));
}

export function isPublicAddress(ip: string): boolean {
  if (typeof ip !== 'string') return false;
  const asV4 = parseV4(ip);
  if (asV4 !== null) return isPublicV4(asV4);
  const asV6 = parseV6(ip);
  return asV6 !== null && isPublicV6(asV6);
}
