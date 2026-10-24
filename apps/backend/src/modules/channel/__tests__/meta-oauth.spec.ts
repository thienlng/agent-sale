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

describe('LiveMetaGateway permissions', () => {
  it('requests scopes explicitly without a login configuration', () => {
    const url = new URL(new LiveMetaGateway(env).authorize('facebook', 'state'));
    expect(url.searchParams.get('scope')).toContain('pages_messaging');
    expect(url.searchParams.has('config_id')).toBe(false);
  });
  it('leaves permissions to the login configuration, or Meta rejects the scopes', () => {
    const gateway = new LiveMetaGateway({ ...env, META_LOGIN_CONFIG_ID: '99' });
    const url = new URL(gateway.authorize('facebook', 'state'));
    expect(url.searchParams.get('config_id')).toBe('99');
    expect(url.searchParams.has('scope')).toBe(false);
  });
  it('still requests Instagram scopes next to the shared configuration id', () => {
    const gateway = new LiveMetaGateway({
      ...env,
      INSTAGRAM_APP_ID: '2',
      INSTAGRAM_APP_SECRET: 's',
      META_LOGIN_CONFIG_ID: '99',
    });
    expect(new URL(gateway.authorize('instagram', 'state')).searchParams.get('scope')).toContain(
      'instagram',
    );
  });
});
