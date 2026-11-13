import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { Readable } from 'node:stream';

/** A single GET that never follows redirects. */
export interface PinnedFetchInit {
  signal: AbortSignal;
  headers: Record<string, string>;
  redirect: 'manual';
  /**
   * The already validated IP to connect to. `url.hostname` stays the Host header and the TLS
   * servername, so certificates are still checked against the name. Undefined = normal DNS
   * (only for hosts that skipped the public-address check in tests).
   */
  address?: string | undefined;
}

export type PinnedFetch = (url: URL, init: PinnedFetchInit) => Promise<Response>;

const NULL_BODY = new Set([101, 103, 204, 205, 304]);

/**
 * node:http(s) GET whose socket connects to `init.address` whatever DNS answers at connect time
 * (no DNS rebinding between the check and the connection), answered as a web `Response` whose
 * body streams, so callers keep their own size caps.
 */
export const pinnedFetch: PinnedFetch = (url, init) =>
  new Promise((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const address = init.address;
    const family = address && isIP(address) === 6 ? 6 : 4;
    const req = send({
      protocol: url.protocol,
      hostname: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: init.headers,
      agent: false,
      signal: init.signal,
      // Pin the connection to the validated address; ignore whatever DNS says now.
      ...(address
        ? {
            lookup: ((_host, options, cb) => {
              const wantsAll =
                typeof options === 'object' && options !== null && 'all' in options && options.all;
              if (wantsAll)
                (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(
                  null,
                  [{ address, family }],
                );
              else cb(null, address, family);
            }) as LookupFunction,
          }
        : {}),
    });
    req.on('response', (res) => {
      const headers = new Headers();
      for (let i = 0; i + 1 < res.rawHeaders.length; i += 2)
        headers.append(res.rawHeaders[i] as string, res.rawHeaders[i + 1] as string);
      const status = res.statusCode ?? 0;
      if (NULL_BODY.has(status)) {
        res.resume();
        resolve(new Response(null, { status, headers }));
        return;
      }
      resolve(
        new Response(Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>, {
          status,
          headers,
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
