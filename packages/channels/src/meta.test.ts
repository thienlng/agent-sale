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
  it('keeps Meta error code, subcode and type but never the message text', async () => {
    const adapter = new MetaAdapter(
      'facebook',
      'v24.0',
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: {
              code: 100,
              error_subcode: 2018047,
              type: 'OAuthException',
              message: 'echo: chị Lan 0912',
            },
          },
          { status: 400 },
        ),
      ),
    );
    const failure = await adapter
      .send({ externalId: 'page', token: 't' }, 'u', { text: 'Hi' }, { idempotencyKey: 'k' })
      .catch((e: unknown) => e);
    expect(failure).toMatchObject({
      code: 'provider_rejected',
      meta: { code: 100, subcode: 2018047, type: 'OAuthException' },
    });
    expect(JSON.stringify((failure as MetaRequestError).meta)).not.toContain('0912');
  });
  it('retries an album once when Meta could not fetch one of its pictures', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ error: { code: 100, error_subcode: 2018047 } }, { status: 400 }),
      )
      .mockResolvedValueOnce(Response.json({ message_id: 'm1' }));
    const adapter = new MetaAdapter('facebook', 'v24.0', transport, 0);
    const album = {
      attachments: [
        { type: 'image' as const, url: 'https://cdn.example.com/a.jpg' },
        { type: 'image' as const, url: 'https://cdn.example.com/b.jpg' },
      ],
    };
    await expect(
      adapter.send({ externalId: 'page', token: 't' }, 'u', album, { idempotencyKey: 'k' }),
    ).resolves.toEqual({ externalMessageId: 'm1' });
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('does not retry other rejections or a single picture', async () => {
    const reject = () =>
      Response.json({ error: { code: 100, error_subcode: 2018047 } }, { status: 400 });
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => reject());
    const adapter = new MetaAdapter('facebook', 'v24.0', transport, 0);
    await expect(
      adapter.send(
        { externalId: 'page', token: 't' },
        'u',
        { attachments: [{ type: 'image', url: 'https://cdn.example.com/a.jpg' }] },
        { idempotencyKey: 'k' },
      ),
    ).rejects.toMatchObject({ code: 'provider_rejected' });
    expect(transport).toHaveBeenCalledTimes(1);
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
  it('sends quick replies on a text message in the Graph shape (Messenger and Instagram)', async () => {
    for (const kind of ['facebook', 'instagram'] as const) {
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ message_id: 'm.q' }));
      await new MetaAdapter(kind, 'v24.0', transport).send(
        { externalId: 'page', token: 't' },
        'u',
        {
          text: 'Tóm tắt đơn',
          quickReplies: [
            { title: '✅ Đặt hàng', payload: 'ORDER_CONFIRM' },
            { title: '✏️ Sửa thông tin', payload: 'ORDER_EDIT' },
          ],
        },
        { idempotencyKey: 'k' },
      );
      const body = JSON.parse(String(transport.mock.calls[0]?.[1]?.body));
      expect(body.recipient).toEqual({ id: 'u' });
      expect(body.message).toEqual({
        text: 'Tóm tắt đơn',
        quick_replies: [
          { content_type: 'text', title: '✅ Đặt hàng', payload: 'ORDER_CONFIRM' },
          { content_type: 'text', title: '✏️ Sửa thông tin', payload: 'ORDER_EDIT' },
        ],
      });
    }
  });
  it('sends no quick_replies key for plain text and keeps at most 3 buttons', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(Response.json({ message_id: 'm' })));
    const a = new MetaAdapter('facebook', 'v24.0', transport);
    await a.send({ externalId: 'p', token: 't' }, 'u', { text: 'Hi' }, { idempotencyKey: 'k' });
    await a.send(
      { externalId: 'p', token: 't' },
      'u',
      { text: 'Hi', quickReplies: [] },
      { idempotencyKey: 'k2' },
    );
    const four = ['a', 'b', 'c', 'd'].map((x) => ({ title: x, payload: x.toUpperCase() }));
    await a.send(
      { externalId: 'p', token: 't' },
      'u',
      { text: 'Hi', quickReplies: four },
      { idempotencyKey: 'k3' },
    );
    const sent = transport.mock.calls.map((c) => JSON.parse(String(c[1]?.body)).message);
    expect(sent[0]).toEqual({ text: 'Hi' });
    expect(sent[1]).toEqual({ text: 'Hi' });
    expect(sent[2].quick_replies).toHaveLength(3);
  });
  it('keeps the button title as the text and the quick reply payload on the event', () => {
    const body = payload();
    Object.assign(body.entry[0]!.messaging[0]!.message, {
      text: '✅ Đặt hàng',
      quick_reply: { payload: 'ORDER_CONFIRM' },
    });
    const [event] = new MetaAdapter('facebook').parseWebhook(body);
    expect(event).toMatchObject({ text: '✅ Đặt hàng', quickReplyPayload: 'ORDER_CONFIRM' });
    expect(new MetaAdapter('facebook').parseWebhook(payload())[0]).not.toHaveProperty(
      'quickReplyPayload',
    );
    const ig = { ...body, object: 'instagram' };
    expect(new MetaAdapter('instagram').parseWebhook(ig)[0]?.quickReplyPayload).toBe(
      'ORDER_CONFIRM',
    );
  });
  it('declares quick reply support', () => {
    expect(new MetaAdapter('facebook').capabilities().quickReplies).toBe(true);
    expect(new MetaAdapter('instagram').capabilities().quickReplies).toBe(true);
  });
  it('sends several images as one album message', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message_id: 'm.2' }));
    await new MetaAdapter('facebook', 'v24.0', transport).send(
      { externalId: 'page', token: 't' },
      'u',
      {
        attachments: [
          { type: 'image', url: 'https://cdn.example/1.jpg' },
          { type: 'image', url: 'https://cdn.example/2.jpg' },
        ],
      },
      { idempotencyKey: 'k' },
    );
    expect(transport).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(transport.mock.calls[0]?.[1]?.body)).message).toEqual({
      attachments: [
        { type: 'image', payload: { url: 'https://cdn.example/1.jpg', is_reusable: true } },
        { type: 'image', payload: { url: 'https://cdn.example/2.jpg', is_reusable: true } },
      ],
    });
  });
  it('sends seen and typing actions and swallows failures', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ recipient_id: 'u' }));
    const adapter = new MetaAdapter('facebook', 'v24.0', transport);
    expect(await adapter.sendAction({ externalId: 'page', token: 't' }, 'u', 'typing_on')).toBe(
      true,
    );
    expect(JSON.parse(String(transport.mock.calls[0]?.[1]?.body))).toEqual({
      recipient: { id: 'u' },
      sender_action: 'typing_on',
    });
    const down = new MetaAdapter('facebook', 'v24.0', vi.fn<typeof fetch>().mockRejectedValue(1));
    expect(await down.sendAction({ externalId: 'page', token: 't' }, 'u', 'mark_seen')).toBe(false);
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
      'https://graph.facebook.com/v24.0/123?fields=first_name,last_name,profile_pic,name',
    );
    expect(String(url)).not.toContain('secret-token');
    expect(init?.headers).toEqual({ Authorization: 'Bearer secret-token' });
  });

  it('preserves the Facebook full display name instead of reconstructing its order or middle names', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        name: '  Nguyễn Thị Minh Lan  ',
        first_name: 'Lan',
        last_name: 'Nguyễn',
        profile_pic: 'https://cdn.example/full-profile.jpg',
      }),
    );
    const profile = await new MetaAdapter('facebook', 'v24.0', transport).fetchProfile(
      { token: 'secret-token' },
      'synthetic-profile',
    );

    expect(profile).toEqual({
      name: 'Nguyễn Thị Minh Lan',
      avatarUrl: 'https://cdn.example/full-profile.jpg',
    });
    const [url, init] = transport.mock.calls[0] ?? [];
    expect(url).toBe(
      'https://graph.facebook.com/v24.0/synthetic-profile?fields=first_name,last_name,profile_pic,name',
    );
    expect(String(url)).not.toContain('secret-token');
    expect(init?.headers).toEqual({ Authorization: 'Bearer secret-token' });
  });

  it('preserves internal full-name spacing and rejects an unsafe avatar independently', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        name: '  Nguyễn  Thu Hà  ',
        first_name: 'Hà',
        last_name: 'Nguyễn',
        profile_pic: 'http://insecure.example/profile.jpg',
      }),
    );

    expect(
      await new MetaAdapter('facebook', 'v24.0', transport).fetchProfile({ token: 't' }, '1'),
    ).toEqual({ name: 'Nguyễn  Thu Hà', avatarUrl: null });
  });

  it('keeps the legacy Facebook fallback when the provider full name is absent or blank', async () => {
    const transport = vi.fn<typeof fetch>();
    for (const fullName of [undefined, null, 42, ' \t\n ']) {
      transport.mockResolvedValueOnce(
        Response.json({ name: fullName, first_name: '  Hà ', last_name: ' Nguyễn  ' }),
      );
      expect(
        await new MetaAdapter('facebook', 'v24.0', transport).fetchProfile({ token: 't' }, '1'),
      ).toEqual({ name: 'Hà Nguyễn', avatarUrl: null });
    }
    transport.mockResolvedValueOnce(Response.json({ name: '  ', first_name: '', last_name: '' }));
    expect(
      await new MetaAdapter('facebook', 'v24.0', transport).fetchProfile({ token: 't' }, '1'),
    ).toEqual({ name: null, avatarUrl: null });
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
