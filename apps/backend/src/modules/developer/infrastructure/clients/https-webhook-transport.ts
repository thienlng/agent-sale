import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import type { LookupFunction } from 'node:net';

import { checkAddresses, checkUrlShape } from '../../application/url-guard.js';
import type { PostResult, WebhookTransport } from '../../application/ports/webhook-transport.js';

const TIMEOUT_MS = 10_000;
/** Only the status matters; the body is read (to free the socket) up to this many bytes. */
const MAX_RESPONSE_BYTES = 64 * 1024;

type Resolve = (host: string) => Promise<string[]>;

const resolveAll: Resolve = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/**
 * Webhook POSTs over `node:https` with the SSRF guard (ADR-022 §6): the connection's DNS lookup
 * resolves every address of the host, refuses the request when any is private, and pins the
 * socket to a vetted address, so a rebinding DNS answer cannot redirect it after the check.
 * Redirects are never followed (a 3xx is a failed attempt).
 */
export class HttpsWebhookTransport implements WebhookTransport {
  constructor(private readonly resolve: Resolve = resolveAll) {}

  async check(url: string): Promise<string | null> {
    const shape = checkUrlShape(url);
    if (shape) return shape;
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    try {
      return checkAddresses(await this.resolve(host));
    } catch {
      return 'unresolvable_host';
    }
  }

  async post(url: string, headers: Record<string, string>, body: string): Promise<PostResult> {
    const shape = checkUrlShape(url);
    if (shape) return { ok: false, status: null, error: shape };
    let rejected: string | null = null;
    const guardedLookup: LookupFunction = (host, options, callback) => {
      this.resolve(host).then(
        (addresses) => {
          rejected = checkAddresses(addresses);
          if (rejected) return callback(new Error(rejected), '', 4);
          const address = addresses[0] as string;
          const family = address.includes(':') ? 6 : 4;
          if (options.all) return callback(null, [{ address, family }]);
          callback(null, address, family);
        },
        () => {
          rejected = 'unresolvable_host';
          callback(new Error(rejected), '', 4);
        },
      );
    };
    return new Promise<PostResult>((resolve) => {
      let settled = false;
      const done = (r: PostResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        resolve(r);
      };
      const req = request(
        url,
        {
          method: 'POST',
          headers: { ...headers, 'content-length': Buffer.byteLength(body).toString() },
          lookup: guardedLookup,
          timeout: TIMEOUT_MS,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          let read = 0;
          res.on('data', (chunk: Buffer) => {
            read += chunk.length;
            if (read > MAX_RESPONSE_BYTES) res.destroy();
          });
          const finish = () =>
            done(
              status >= 200 && status < 300
                ? { ok: true, status }
                : { ok: false, status, error: `HTTP ${status}` },
            );
          res.on('end', finish);
          res.on('close', finish);
          res.on('error', finish);
        },
      );
      // `timeout` is per socket inactivity; the deadline bounds the whole attempt.
      req.on('timeout', () => req.destroy(new Error('timeout')));
      const deadline = setTimeout(() => {
        req.destroy(new Error('timeout'));
        done({ ok: false, status: null, error: 'timeout' });
      }, TIMEOUT_MS);
      req.on('error', (err) =>
        done({ ok: false, status: null, error: rejected ?? err.message.slice(0, 200) }),
      );
      req.end(body);
    });
  }
}
