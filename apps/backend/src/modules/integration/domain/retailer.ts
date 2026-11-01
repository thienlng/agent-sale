const RETAILER = /^[a-z0-9-]{2,64}$/;
const KIOTVIET_HOST = '.kiotviet.vn';

/**
 * The KiotViet store name ("Tên gian hàng") from what the owner pasted: the bare name, the host
 * `abc.kiotviet.vn`, or a store URL such as `https://abc.kiotviet.vn/man`. Null when it is none.
 */
export function parseRetailer(input: string): string | null {
  const [host] = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .split(/[/?#]/, 1);
  if (!host) return null;
  let name = host;
  if (host.endsWith(KIOTVIET_HOST)) name = host.slice(0, -KIOTVIET_HOST.length);
  else if (host.includes('.')) return null;
  return RETAILER.test(name) ? name : null;
}
