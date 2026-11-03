import { BlockList, isIP } from 'node:net';

/**
 * SSRF guard of webhook URLs (ADR-022 §6). A URL may receive webhooks when it is `https`, on port
 * 443 or ≥ 1024, has no credentials, and every address its host resolves to is public unicast.
 */
const blocked = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata (169.254.169.254)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
] as const)
  blocked.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
  ['::', 96], // unspecified, loopback, IPv4-compatible (deprecated)
  ['64:ff9b::', 96], // NAT64 (embeds IPv4)
  ['64:ff9b:1::', 48], // local NAT64
  ['100::', 64], // discard
  ['2001::', 23], // IETF protocol assignments (Teredo, ORCHID…)
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4 (embeds IPv4)
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
  ['fd00:ec2::254', 128], // AWS metadata over IPv6
] as const)
  blocked.addSubnet(net, bits, 'ipv6');

/** True when the address must not receive a webhook. Anything that is not an IP is blocked. */
export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return blocked.check(ip, 'ipv4');
  // BlockList checks IPv4-mapped IPv6 (`::ffff:10.0.0.1`) against the IPv4 rules.
  if (kind === 6) return blocked.check(ip, 'ipv6');
  return true;
}

/** Static checks of a URL before any DNS lookup; null when it passes, else the rule it breaks. */
export function checkUrlShape(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'invalid_url';
  }
  if (url.protocol !== 'https:') return 'https_required';
  if (url.username || url.password) return 'credentials_not_allowed';
  const port = url.port ? Number(url.port) : 443;
  if (port !== 443 && port < 1024) return 'port_not_allowed';
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return 'private_address';
  if (host.endsWith('.local') || host.endsWith('.internal')) return 'private_address';
  if (isIP(host) && isBlockedAddress(host)) return 'private_address';
  return null;
}

/** Checks resolved addresses: every one must be public (a host with one private address fails). */
export function checkAddresses(addresses: readonly string[]): string | null {
  if (!addresses.length) return 'unresolvable_host';
  return addresses.some(isBlockedAddress) ? 'private_address' : null;
}
