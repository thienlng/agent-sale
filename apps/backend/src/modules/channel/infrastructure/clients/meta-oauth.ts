import { Logger } from '@nestjs/common';
import { z } from 'zod';
import type { MetaProvider } from '@agent-sales/contracts';
import { getEnv, type Env } from '../../../../common/config.js';
import type { GrantedAccount } from '../../application/ports/channel-store.js';
import type { MetaGateway } from '../../application/ports/meta-gateway.js';
import { ChannelError } from '../../domain/channel.errors.js';
const log = new Logger('MetaOAuth');
const Json = z.record(z.string(), z.unknown());
const Account = z.object({
  externalId: z.string().min(1),
  name: z.string().min(1),
  token: z.string().min(1),
  expiresAt: z.string().nullable(),
});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const rec = (v: unknown): Record<string, unknown> => Json.parse(v);
/** `host/path` of a URL, without the query that may hold secrets. */
const endpoint = (url: string): string => {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return 'unknown';
  }
};
const first = (v: Record<string, unknown>): Record<string, unknown> =>
  Array.isArray(v.data) ? rec(v.data[0]) : v;
/** What messaging needs: list Pages, send messages, subscribe the Page to webhooks. */
const scopes = {
  facebook: ['pages_show_list', 'pages_messaging', 'pages_manage_metadata'],
  instagram: ['instagram_business_basic', 'instagram_business_manage_messages'],
};
export class LiveMetaGateway implements MetaGateway {
  constructor(
    private readonly env: Env = getEnv(),
    private readonly transport: typeof fetch = fetch,
  ) {}
  configured(p: MetaProvider): boolean {
    const e = this.env;
    return Boolean(
      e.META_APP_ORIGIN?.startsWith('https://') &&
      e.SECRETS_ENCRYPTION_KEY &&
      Buffer.from(e.SECRETS_ENCRYPTION_KEY, 'base64').length === 32 &&
      (p === 'facebook'
        ? e.META_APP_ID && e.META_APP_SECRET
        : e.INSTAGRAM_APP_ID && e.INSTAGRAM_APP_SECRET),
    );
  }
  private ready(p: MetaProvider) {
    if (!this.configured(p))
      throw new ChannelError(
        'UNAVAILABLE',
        'Configure HTTPS origin, encryption key and Meta application credentials',
      );
  }
  private callback(p: MetaProvider): string {
    const template = this.env.META_OAUTH_REDIRECT_URI;
    return template
      ? template.replaceAll('{provider}', p)
      : `${this.env.META_APP_ORIGIN}/api/v1/channels/oauth/${p}/callback`;
  }
  authorize(p: MetaProvider, state: string): string {
    this.ready(p);
    const e = this.env;
    const url = new URL(
      p === 'instagram'
        ? 'https://www.instagram.com/oauth/authorize'
        : `https://www.facebook.com/${e.META_GRAPH_VERSION}/dialog/oauth`,
    );
    url.search = new URLSearchParams({
      client_id: (p === 'instagram' ? e.INSTAGRAM_APP_ID : e.META_APP_ID) ?? '',
      redirect_uri: this.callback(p),
      response_type: 'code',
      state,
      ...(p === 'instagram' || !e.META_LOGIN_CONFIG_ID ? { scope: scopes[p].join(',') } : {}),
      ...(p === 'instagram'
        ? { enable_fb_login: 'false', force_reauth: 'true' }
        : {
            display: 'popup',
            // A Facebook Login for Business configuration owns its permissions: sending `scope`
            // as well makes Meta reject the dialog with "Invalid Scopes".
            ...(e.META_LOGIN_CONFIG_ID
              ? { config_id: e.META_LOGIN_CONFIG_ID, override_default_response_type: 'true' }
              : {}),
          }),
    }).toString();
    return url.toString();
  }
  private async request(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.transport(url, {
        ...init,
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      });
    } catch (cause) {
      log.warn(`Meta request to ${endpoint(url)} failed: ${(cause as Error).message}`);
      throw new ChannelError('UNAVAILABLE', 'Meta did not respond; reconnect and try again');
    }
    const body = Json.safeParse(await response.json().catch(() => null));
    if (!response.ok || !body.success || body.data.error) {
      // Only Meta's error fields and the path: URLs carry client secrets and codes in the query.
      const err = body.success ? Json.safeParse(body.data.error) : null;
      const f = err?.success ? err.data : {};
      log.warn(
        `Meta rejected ${endpoint(url)} (HTTP ${response.status}): code=${str(f.code)} subcode=${str(f.error_subcode)} message=${str(f.message)} trace=${str(f.fbtrace_id)}`,
      );
      throw new ChannelError(
        'UNAVAILABLE',
        'Meta rejected the request; check granted messaging permissions and application configuration',
      );
    }
    return body.data;
  }
  async exchange(p: MetaProvider, code: string): Promise<GrantedAccount[]> {
    this.ready(p);
    const e = this.env;
    if (p === 'instagram') {
      const short = first(
        await this.request('https://api.instagram.com/oauth/access_token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: e.INSTAGRAM_APP_ID ?? '',
            client_secret: e.INSTAGRAM_APP_SECRET ?? '',
            grant_type: 'authorization_code',
            redirect_uri: this.callback(p),
            code,
          }),
        }),
      );
      const permissions = Array.isArray(short.permissions)
        ? short.permissions
        : String(short.permissions ?? '').split(/[,\s]+/);
      if (short.permissions !== undefined && scopes.instagram.some((s) => !permissions.includes(s)))
        throw new ChannelError(
          'VALIDATION_FAILED',
          'Instagram messaging permission was not granted',
        );
      const long = await this.request(
        `https://graph.instagram.com/access_token?${new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: e.INSTAGRAM_APP_SECRET ?? '', access_token: str(short.access_token) })}`,
      );
      const profile = first(
        await this.request(
          `https://graph.instagram.com/${e.META_GRAPH_VERSION}/me?fields=id,user_id,username`,
          { headers: { Authorization: `Bearer ${str(long.access_token)}` } },
        ),
      );
      return [
        Account.parse({
          externalId: str(profile.user_id) || str(profile.id),
          name: str(profile.username),
          token: str(long.access_token),
          expiresAt:
            typeof long.expires_in === 'number' && long.expires_in > 0
              ? new Date(Date.now() + long.expires_in * 1000).toISOString()
              : null,
        }),
      ];
    }
    const base = `https://graph.facebook.com/${e.META_GRAPH_VERSION}`;
    const token = await this.request(
      `${base}/oauth/access_token?${new URLSearchParams({ client_id: e.META_APP_ID ?? '', client_secret: e.META_APP_SECRET ?? '', redirect_uri: this.callback(p), code })}`,
    );
    // Page tokens inherit the user token's lifetime; a long-lived one keeps them from expiring in ~1 hour.
    const userToken = await this.request(
      `${base}/oauth/access_token?${new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: e.META_APP_ID ?? '', client_secret: e.META_APP_SECRET ?? '', fb_exchange_token: str(token.access_token) })}`,
    )
      .then((r) => str(r.access_token) || str(token.access_token))
      .catch(() => str(token.access_token));
    const granted = await this.request(`${base}/me/permissions`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    const allowed = Array.isArray(granted.data)
      ? granted.data
          .map(rec)
          .filter((r) => r.status === 'granted')
          .map((r) => r.permission)
      : [];
    const missing = scopes.facebook.filter((s) => !allowed.includes(s));
    if (missing.length)
      throw new ChannelError(
        'VALIDATION_FAILED',
        `Facebook permissions not granted: ${missing.join(', ')}; enable them in the Facebook Login for Business configuration`,
      );
    const accounts: GrantedAccount[] = [];
    let after = '';
    for (let page = 0; page < 20; page++) {
      const data = await this.request(
        `${base}/me/accounts?${new URLSearchParams({ fields: 'id,name,access_token', limit: '100', ...(after ? { after } : {}) })}`,
        { headers: { Authorization: `Bearer ${userToken}` } },
      );
      for (const value of Array.isArray(data.data) ? data.data : []) {
        const a = rec(value);
        if (!str(a.access_token)) continue;
        // One page whose token cannot be inspected must not discard the others.
        const debug = await this.request(
          `${base}/debug_token?${new URLSearchParams({ input_token: str(a.access_token) })}`,
          { headers: { Authorization: `Bearer ${e.META_APP_ID}|${e.META_APP_SECRET}` } },
        ).catch(() => null);
        if (!debug) continue;
        const d = rec(debug.data);
        if (d.is_valid !== true) continue;
        const deadlines = [d.expires_at, d.data_access_expires_at].filter(
          (n): n is number => typeof n === 'number' && n > 0,
        );
        accounts.push(
          Account.parse({
            externalId: str(a.id),
            name: str(a.name),
            token: str(a.access_token),
            expiresAt: deadlines.length
              ? new Date(Math.min(...deadlines) * 1000).toISOString()
              : null,
          }),
        );
      }
      if (!data.paging) break;
      const paging = rec(data.paging);
      if (!paging.next) break;
      after = str(rec(paging.cursors).after);
      if (!after) break;
    }
    return accounts;
  }
  async subscribe(p: MetaProvider, a: GrantedAccount): Promise<void> {
    const host = p === 'instagram' ? 'graph.instagram.com' : 'graph.facebook.com';
    await this.request(
      `https://${host}/${this.env.META_GRAPH_VERSION}/${encodeURIComponent(a.externalId)}/subscribed_apps`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${a.token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          subscribed_fields:
            p === 'instagram' ? 'messages' : 'messages,messaging_postbacks,message_echoes',
        }),
      },
    );
  }
}
