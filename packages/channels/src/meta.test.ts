import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { MetaAdapter, MetaRequestError } from './meta.js';
function payload(echo = false, timestamp = 1700000000000) {
  return {
    object: 'page',
    entry: [
      {
        id: 'page',
        messaging: [
          {
            sender: { id: echo ? 'page' : 'customer' },
            recipient: { id: echo ? 'customer' : 'page' },
            timestamp,
            message: { mid: 'mid1', text: 'Hello', ...(echo ? { is_echo: true } : {}) },
          },
        ],
      },
    ],
  };
}
describe('Meta signed messaging adapter', () => {
  it('verifies exactly the raw body with a configured secret and rejects malformed signatures', () => {
    const a = new MetaAdapter('facebook');
    const raw = JSON.stringify(payload());
    const signature = `sha256=${createHmac('sha256', 'secret').update(raw).digest('hex')}`;
    expect(a.verifyWebhook({ 'x-hub-signature-256': signature }, raw, 'secret')).toBe(true);
    expect(a.verifyWebhook({ 'x-hub-signature-256': signature }, raw + ' ', 'secret')).toBe(false);
    expect(a.verifyWebhook({ 'x-hub-signature-256': 'sha256=a' }, raw, 'secret')).toBe(false);
    expect(a.verifyWebhook({ 'x-hub-signature-256': signature }, raw, '')).toBe(false);
  });
  it('normalizes echo customer peers and drops unsupported objects and invalid dates', () => {
    const a = new MetaAdapter('facebook');
    expect(a.parseWebhook(payload())[0]).toMatchObject({
      type: 'message',
      senderExternalId: 'customer',
      assetExternalId: 'page',
    });
    expect(a.parseWebhook(payload(true))[0]).toMatchObject({
      type: 'echo',
      senderExternalId: 'customer',
    });
    expect(a.parseWebhook(payload(false, 1e99))).toEqual([]);
    expect(a.parseWebhook({ ...payload(), object: 'instagram' })).toEqual([]);
    expect(a.parseWebhook({ entry: [null] })).toEqual([]);
  });
  it('uses the direct Instagram messaging host and never retries an ambiguous POST', async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error('socket closed'));
    const a = new MetaAdapter('instagram', 'v24.0', transport);
    await expect(
      a.send(
        { externalId: 'ig', token: 'secret' },
        'customer',
        { text: 'Hello' },
        { idempotencyKey: 'key' },
      ),
    ).rejects.toMatchObject({ uncertain: true, code: 'delivery_unknown' });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[0]).toBe('https://graph.instagram.com/v24.0/ig/messages');
  });
  it('separates explicit rejection from uncertain provider failures', async () => {
    const rejected = new MetaAdapter(
      'facebook',
      'v24.0',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ error: { code: 190 } }, { status: 400 })),
    );
    await expect(
      rejected.send(
        { externalId: 'page', token: 't' },
        'u',
        { text: 'Hi' },
        { idempotencyKey: 'k' },
      ),
    ).rejects.toMatchObject({ uncertain: false, code: 'auth_expired' });
    const server = new MetaAdapter(
      'facebook',
      'v24.0',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ error: { code: 2 } }, { status: 500 })),
    );
    await expect(
      server.send({ externalId: 'page', token: 't' }, 'u', { text: 'Hi' }, { idempotencyKey: 'k' }),
    ).rejects.toBeInstanceOf(MetaRequestError);
  });
  it('keeps HTTPS media attachments and sends one attachment by URL', async () => {
    const a = new MetaAdapter('facebook');
    const body = payload();
    Object.assign(body.entry[0]!.messaging[0]!.message, {
      text: undefined,
      attachments: [
        { type: 'image', payload: { url: 'https://cdn.example/a.jpg' } },
        { type: 'image', payload: { url: 'https://cdn.example/s.png', sticker_id: 369 } },
        { type: 'file', payload: { url: 'http://insecure.example/x.pdf' } },
        { type: 'fallback', payload: { url: 'https://example.com' } },
      ],
    });
    expect(a.parseWebhook(body)[0]).toMatchObject({
      text: '',
      attachments: [
        { type: 'image', url: 'https://cdn.example/a.jpg' },
        { type: 'sticker', url: 'https://cdn.example/s.png' },
      ],
    });
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message_id: 'm.1' }));
    await new MetaAdapter('facebook', 'v24.0', transport).send(
      { externalId: 'page', token: 't' },
      'u',
      { attachments: [{ type: 'image', url: 'https://cdn.example/a.jpg' }] },
      { idempotencyKey: 'k' },
    );
    expect(JSON.parse(String(transport.mock.calls[0]?.[1]?.body)).message).toEqual({
      attachment: {
        type: 'image',
        payload: { url: 'https://cdn.example/a.jpg', is_reusable: true },
      },
    });
  });
});

describe('MetaAdapter.fetchProfile', () => {
  it('reads a Messenger profile with the page token in a header, not the URL', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        first_name: 'Hà',
        last_name: 'Nguyễn',
        profile_pic: 'https://cdn.example/p.jpg',
      }),
    );
    const profile = await new MetaAdapter('facebook', 'v24.0', transport).fetchProfile(
      { token: 'secret-token' },
      '123',
    );
    expect(profile).toEqual({ name: 'Hà Nguyễn', avatarUrl: 'https://cdn.example/p.jpg' });
    const [url, init] = transport.mock.calls[0] ?? [];
    expect(url).toBe(
      'https://graph.facebook.com/v24.0/123?fields=first_name,last_name,profile_pic',
    );
    expect(String(url)).not.toContain('secret-token');
    expect(init?.headers).toEqual({ Authorization: 'Bearer secret-token' });
  });

  it('reads an Instagram profile and falls back from name to username', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ name: 'Lan Shop', username: 'lan' }))
      .mockResolvedValueOnce(
        Response.json({ username: 'lan_shop', profile_pic: 'http://insecure/p.jpg' }),
      );
    const a = new MetaAdapter('instagram', 'v24.0', transport);
    expect(await a.fetchProfile({ token: 't' }, 'ig1')).toEqual({
      name: 'Lan Shop',
      avatarUrl: null,
    });
    expect(await a.fetchProfile({ token: 't' }, 'ig2')).toEqual({
      name: 'lan_shop',
      avatarUrl: null,
    });
    expect(transport.mock.calls[0]?.[0]).toBe(
      'https://graph.instagram.com/v24.0/ig1?fields=name,username,profile_pic',
    );
  });

  it('throws a typed error when Meta refuses or is unreachable', async () => {
    const refused = new MetaAdapter(
      'facebook',
      'v24.0',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ error: { code: 190 } }, { status: 400 })),
    );
    await expect(refused.fetchProfile({ token: 't' }, '1')).rejects.toMatchObject({
      code: 'auth_expired',
    });
    const down = new MetaAdapter(
      'facebook',
      'v24.0',
      vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')),
    );
    await expect(down.fetchProfile({ token: 't' }, '1')).rejects.toMatchObject({
      code: 'profile_unavailable',
    });
  });
});
