import { describe, expect, it } from 'vitest';
import type { Env } from '../../../common/config.js';
import { LiveMetaGateway } from '../infrastructure/clients/meta-oauth.js';

const env = {
  META_APP_ORIGIN: 'https://app.example',
  META_APP_ID: '1',
  META_APP_SECRET: 's',
  META_GRAPH_VERSION: 'v24.0',
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
} as Env;

describe('LiveMetaGateway redirect URI', () => {
  it('defaults to the versioned API callback', () => {
    const url = new URL(new LiveMetaGateway(env).authorize('facebook', 'state'));
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.example/api/v1/channels/oauth/facebook/callback',
    );
  });
  it('uses the exact redirect registered on the Meta app when configured', () => {
    const gateway = new LiveMetaGateway({
      ...env,
      META_OAUTH_REDIRECT_URI:
        'https://tunnel.example/api/channels/oauth/{provider}/callback?popup=1',
    });
    const url = new URL(gateway.authorize('facebook', 'state'));
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://tunnel.example/api/channels/oauth/facebook/callback?popup=1',
    );
  });
});
