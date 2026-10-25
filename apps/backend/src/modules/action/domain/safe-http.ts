import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

import { isPublicAddress } from './ip-guard.js';

/**
 * Hardened outbound HTTP client for bot actions (SSRF-safe). Pure Node, no Nest.
 *
 * - https only (http only for hosts in `allowHttpHosts`, which also skip the IP guard).
 * - DNS is resolved once; every address must be public; the socket then connects to the
 *   validated IP (custom `lookup`), so DNS rebinding cannot swap the target.
 * - Redirects are never followed; timeout and response size are capped.
 * - Results carry only an error category — never a URL, header or body.
 */

export interface SafeHttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export type SafeHttpErrorCode = 'timeout' | 'blocked_host' | 'too_large' | 'bad_status' | 'network';

export type SafeHttpResult =
  | { ok: true; status: number; json: unknown }
  | { ok: false; errorCode: SafeHttpErrorCode; status?: number };

export interface SafeHttpTransportRequest {
  url: URL;
  /** Validated IP to connect to; `url.hostname` stays the TLS servername / Host header. */
  address: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  maxBytes: number;
  signal: AbortSignal;
}

export type SafeHttpTransport = (
  req: SafeHttpTransportRequest,
) => Promise<{ status: number; body: string }>;

export class SafeHttpTransportError extends Error {
  constructor(
    /** `connect`: failed before any byte was sent, so another address may be tried safely. */
    readonly code: 'timeout' | 'too_large' | 'network' | 'connect',
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'SafeHttpTransportError';
  }
}

export interface SafeHttpDeps {
  resolve?: (host: string) => Promise<string[]>;
  transport?: SafeHttpTransport;
  /** Hosts that may be called over plain http and skip the public-IP check (dev/QA only). */
  allowHttpHosts?: string[];
  timeoutMs?: number;
  maxBytes?: number;
}

export const SAFE_HTTP_TIMEOUT_MS = 8_000;
export const SAFE_HTTP_MAX_BYTES = 256 * 1024;

const defaultResolve = async (host: string): Promise<string[]> =>
  (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** Default transport: node:http(s) connecting to the pre-validated IP, streaming with a size cap. */
export const nodeTransport: SafeHttpTransport = (r) =>
  new Promise((resolve, reject) => {
    const isHttps = r.url.protocol === 'https:';
    const family = isIP(r.address) === 6 ? 6 : 4;
    const send = isHttps ? httpsRequest : httpRequest;
    const headers = { ...r.headers };
    if (r.body !== undefined) headers['Content-Length'] = String(Buffer.byteLength(r.body));
    let done = false;
    const finish = (fn: () => void): void => {
      if (done) return;
      done = true;
      fn();
    };

    const req = send({
      protocol: r.url.protocol,
      // Hostname stays the original so Host header and TLS SNI/cert validation use it.
      hostname: r.url.hostname.replace(/^\[|\]$/g, ''),
      port: r.url.port || undefined,
      path: `${r.url.pathname}${r.url.search}`,
      method: r.method,
      headers,
      agent: false,
      signal: r.signal,
      // Pin the connection to the validated address; ignore whatever DNS says now.
      lookup: (_host, options, cb) => {
        const wantsAll =
          typeof options === 'object' && options !== null && 'all' in options && options.all;
        if (wantsAll) {
          (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [
            { address: r.address, family },
          ]);
        } else cb(null, r.address, family);
      },
    });

    req.on('response', (res) => {
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > r.maxBytes) {
        finish(() => reject(new SafeHttpTransportError('too_large')));
        res.destroy();
        req.destroy();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > r.maxBytes) {
          finish(() => reject(new SafeHttpTransportError('too_large')));
          res.destroy();
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () =>
        finish(() =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        ),
      );
      res.on('error', () => finish(() => reject(new SafeHttpTransportError('network'))));
      res.on('aborted', () => finish(() => reject(new SafeHttpTransportError('network'))));
    });
    let connected = false;
    req.on('socket', (socket) => {
      socket.once('connect', () => {
        connected = true;
      });
    });
    req.on('error', () =>
      finish(() =>
        reject(
          new SafeHttpTransportError(
            r.signal.aborted ? 'timeout' : connected ? 'network' : 'connect',
          ),
        ),
      ),
    );
    if (r.body !== undefined) req.write(r.body);
    req.end();
  });

function hostKey(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

export function createSafeHttp(
  deps: SafeHttpDeps = {},
): (req: SafeHttpRequest) => Promise<SafeHttpResult> {
  const resolve = deps.resolve ?? defaultResolve;
  const transport = deps.transport ?? nodeTransport;
  const allowHttp = new Set((deps.allowHttpHosts ?? []).map((h) => h.toLowerCase()));
  const timeoutMs = deps.timeoutMs ?? SAFE_HTTP_TIMEOUT_MS;
  const maxBytes = deps.maxBytes ?? SAFE_HTTP_MAX_BYTES;

  return async (input) => {
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      return { ok: false, errorCode: 'blocked_host' };
    }
    const host = hostKey(url);
    const allowlisted = allowHttp.has(host);
    const schemeOk = url.protocol === 'https:' || (url.protocol === 'http:' && allowlisted);
    if (!schemeOk || url.username !== '' || url.password !== '' || host === '') {
      return { ok: false, errorCode: 'blocked_host' };
    }

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_res, rej) => {
      timer = setTimeout(() => {
        // Reject first so a transport failing on abort cannot win the race as 'network'.
        rej(new SafeHttpTransportError('timeout'));
        controller.abort();
      }, timeoutMs);
    });
    // The DNS lookup and every connection attempt share the one timeout.
    const attempt = async (): Promise<SafeHttpResult> => {
      // WHATWG URL already normalises decimal/hex/octal/short IPv4 hosts to dotted form,
      // so an IP literal here is checked directly and never sent to the resolver.
      let addresses: string[];
      if (isIP(host) !== 0) {
        addresses = [host];
      } else {
        try {
          addresses = await resolve(host);
        } catch {
          return { ok: false, errorCode: 'network' };
        }
        if (addresses.length === 0) return { ok: false, errorCode: 'network' };
      }
      if (!allowlisted && !addresses.every(isPublicAddress)) {
        return { ok: false, errorCode: 'blocked_host' };
      }
      // IPv4 first (stable): many shops publish an AAAA record the server cannot reach.
      const ordered = [
        ...addresses.filter((a) => isIP(a) !== 6),
        ...addresses.filter((a) => isIP(a) === 6),
      ];
      for (const [i, address] of ordered.entries()) {
        try {
          const response = await transport({
            url,
            address,
            method: input.method,
            headers: input.headers,
            ...(input.body !== undefined ? { body: input.body } : {}),
            maxBytes,
            signal: controller.signal,
          });
          return interpret(response, maxBytes);
        } catch (err) {
          const code = err instanceof SafeHttpTransportError ? err.code : 'network';
          // Only a connect-level failure (nothing sent yet) moves on; every address was validated.
          if (code === 'connect' && i < ordered.length - 1) continue;
          return { ok: false, errorCode: code === 'connect' ? 'network' : code };
        }
      }
      return { ok: false, errorCode: 'network' };
    };
    try {
      return await Promise.race([attempt(), timeout]);
    } catch (err) {
      return {
        ok: false,
        errorCode:
          err instanceof SafeHttpTransportError && err.code !== 'connect' ? err.code : 'network',
      };
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}

function interpret(response: { status: number; body: string }, maxBytes: number): SafeHttpResult {
  const { status, body } = response;
  if (status >= 300 && status < 400) return { ok: false, errorCode: 'bad_status', status };
  if (Buffer.byteLength(body) > maxBytes) return { ok: false, errorCode: 'too_large' };
  if (body.trim() === '') return { ok: true, status, json: null };
  try {
    return { ok: true, status, json: JSON.parse(body) as unknown };
  } catch {
    return { ok: false, errorCode: 'bad_status', status };
  }
}
