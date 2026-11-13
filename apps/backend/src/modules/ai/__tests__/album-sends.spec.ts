import type { ProductDto } from '@agent-sales/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { MessageSink, OutgoingMessage } from '../api/reply-options.js';
import {
  ImageAllowlist,
  newOutputState,
  outputTools,
  SEND_MESSAGE_TOOL,
} from '../application/output-tools.js';

const WS = '0192f0a0-0000-7000-8000-000000000001';
const BASE = 'https://rapiz.test/media';
const CLIP = `/media/lodging/${WS}/0192f0a0-0000-7000-8000-0000000000cc.mp4`;
/** Twelve stored bedroom photos (Rapiz paths), sent on the current public host. */
const bedrooms = Array.from(
  { length: 12 },
  (_, i) =>
    `/media/products/${WS}/0192f0a0-0000-7000-8000-0000000001${String(i).padStart(2, '0')}.jpg`,
);
const abs = (path: string) => `https://rapiz.test${path}`;
const villa = {
  id: 'villa-1',
  name: 'A17 – Villa',
  imageUrls: [],
  accommodation: {
    gallery: [],
    albums: [
      {
        id: 'rooms',
        name: 'Phòng ngủ',
        items: bedrooms.map((url) => ({ kind: 'image', url, caption: '' })),
      },
      {
        id: 'clips',
        name: 'Video',
        items: [
          { kind: 'video', url: CLIP, caption: 'Giới thiệu' },
          { kind: 'link', url: 'https://youtu.be/flycam', caption: 'Flycam' },
        ],
      },
    ],
  },
} as unknown as ProductDto;

function setup(sentMediaUrls: string[] = []) {
  const sent: OutgoingMessage[] = [];
  const sink: MessageSink = {
    send: vi.fn(async (m: OutgoingMessage) => {
      sent.push(m);
      return { delivered: 1 };
    }),
  };
  const allowlist = new ImageAllowlist([], BASE);
  allowlist.addProducts([villa]);
  const state = newOutputState();
  const tool = outputTools({
    sink,
    allowlist,
    state,
    sendMessage: true,
    sentMediaUrls,
  }).runnable.find((t) => t.name === SEND_MESSAGE_TOOL);
  if (!tool) throw new Error('send_message missing');
  const send = async (input: object) =>
    JSON.parse((await tool.run(input)).content) as Record<string, unknown>;
  return { sent, state, send, tool };
}

describe('send_message albums', () => {
  it('sends the first 8 photos of a folder and says how many remain', async () => {
    const { sent, state, send } = setup();
    const res = await send({ text: 'Dạ ảnh phòng ngủ ạ', albumId: 'a:villa-1:0' });
    expect(res).toEqual({ status: 'sent', delivered: 1, album: { sent: 8, remaining: 4 } });
    expect(sent[0]?.text).toBe('Dạ ảnh phòng ngủ ạ');
    expect(sent[0]?.images.map((i) => i.url)).toEqual(bedrooms.slice(0, 8).map(abs));
    expect(sent[0]?.images[0]?.id).toBe('a:villa-1:0:0');
    expect(state.sent[0]?.images).toHaveLength(8);
  });

  it('sends the next page in the same turn, then starts again from the first photo', async () => {
    const { sent, send } = setup();
    await send({ albumId: 'a:villa-1:0' });
    expect(await send({ albumId: 'a:villa-1:0' })).toMatchObject({
      album: { sent: 4, remaining: 0 },
    });
    expect(sent[1]?.images.map((i) => i.url)).toEqual(bedrooms.slice(8).map(abs));
    expect(await send({ albumId: 'a:villa-1:0' })).toMatchObject({
      album: { sent: 8, remaining: 0, restarted: true },
    });
    expect(sent[2]?.images.map((i) => i.url)).toEqual(bedrooms.slice(0, 8).map(abs));
    // A fourth call pages on from the restart instead of resending the first 8.
    expect(await send({ albumId: 'a:villa-1:0' })).toEqual({
      status: 'sent',
      delivered: 1,
      album: { sent: 4, remaining: 0 },
    });
    expect(sent[3]?.images.map((i) => i.url)).toEqual(bedrooms.slice(8).map(abs));
  });

  it('restarts a folder the conversation fully received, promising nothing more, then pages on', async () => {
    const { sent, send } = setup(bedrooms.map(abs));
    expect(await send({ albumId: 'a:villa-1:0' })).toEqual({
      status: 'sent',
      delivered: 1,
      album: { sent: 8, remaining: 0, restarted: true },
    });
    expect(sent[0]?.images.map((i) => i.url)).toEqual(bedrooms.slice(0, 8).map(abs));
    expect(await send({ albumId: 'a:villa-1:0' })).toEqual({
      status: 'sent',
      delivered: 1,
      album: { sent: 4, remaining: 0 },
    });
    expect(sent[1]?.images.map((i) => i.url)).toEqual(bedrooms.slice(8).map(abs));
  });

  it('skips the photos the conversation already received, on whatever host they went out', async () => {
    const { sent, send } = setup(
      bedrooms.slice(0, 8).map((p) => `https://old.trycloudflare.com${p}`),
    );
    expect(await send({ albumId: 'a:villa-1:0' })).toMatchObject({
      album: { sent: 4, remaining: 0 },
    });
    expect(sent[0]?.images.map((i) => i.url)).toEqual(bedrooms.slice(8).map(abs));
  });

  it('refuses albumId together with imageIds and drops an unknown album', async () => {
    const { tool, send } = setup();
    expect(
      tool.schema.safeParse({ albumId: 'a:villa-1:0', imageIds: ['p:villa-1:0'] }).success,
    ).toBe(false);
    expect(await send({ text: 'Dạ', albumId: 'a:other:0' })).toEqual({
      status: 'sent',
      delivered: 1,
      droppedImageIds: ['a:other:0'],
    });
  });
});

describe('send_message videos', () => {
  it('sends an uploaded video as a video on the current public base', async () => {
    const { sent, send } = setup();
    expect(await send({ text: 'Dạ video ạ', videoId: 'v:villa-1:1:0' })).toEqual({
      status: 'sent',
      delivered: 1,
      video: 'video',
    });
    expect(sent[0]?.videos).toEqual([
      { id: 'v:villa-1:1:0', url: abs(CLIP), label: 'A17 – Villa – Video – video: Giới thiệu' },
    ]);
  });

  it('appends a video link to the text', async () => {
    const { sent, send } = setup();
    expect(await send({ videoId: 'v:villa-1:1:1' })).toMatchObject({ video: 'link' });
    expect(sent[0]?.text).toBe('Flycam: https://youtu.be/flycam');
    expect(sent[0]?.videos).toBeUndefined();
  });

  it('drops an unknown video id', async () => {
    const { send } = setup();
    expect(await send({ text: 'Dạ', videoId: 'v:other:0:0' })).toEqual({
      status: 'sent',
      delivered: 1,
      droppedImageIds: ['v:other:0:0'],
    });
  });

  it('sends a folder page and a video in one message', async () => {
    const { sent, send } = setup();
    expect(await send({ albumId: 'a:villa-1:0', videoId: 'v:villa-1:1:0' })).toEqual({
      status: 'sent',
      delivered: 1,
      album: { sent: 8, remaining: 4 },
      video: 'video',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.images).toHaveLength(8);
    expect(sent[0]?.videos?.map((v) => v.id)).toEqual(['v:villa-1:1:0']);
  });

  it('reports a send that did not fully go out, e.g. a video Meta rejected', async () => {
    const allowlist = new ImageAllowlist([], BASE);
    allowlist.addProducts([villa]);
    const sink: MessageSink = { send: async () => ({ delivered: 1, complete: false }) };
    const tool = outputTools({
      sink,
      allowlist,
      state: newOutputState(),
      sendMessage: true,
    }).runnable.find((t) => t.name === SEND_MESSAGE_TOOL);
    const res = JSON.parse(
      (await tool!.run({ text: 'Dạ video ạ', videoId: 'v:villa-1:1:0' })).content,
    );
    expect(res).toEqual({ status: 'sent', delivered: 1, video: 'video', incomplete: true });
  });
});

describe('send_message: one product per message (EV-5)', () => {
  const toy = (id: string, n: number) =>
    ({
      id,
      name: id,
      imageUrls: Array.from({ length: n }, (_, i) => `https://cdn.example.com/${id}-${i}.jpg`),
      accommodation: null,
    }) as unknown as ProductDto;

  it('refuses pictures of two products in one call and sends nothing', async () => {
    const sent: OutgoingMessage[] = [];
    const sink: MessageSink = {
      send: vi.fn(async (m: OutgoingMessage) => {
        sent.push(m);
        return { delivered: 1 };
      }),
    };
    const allowlist = new ImageAllowlist([], BASE);
    allowlist.addProducts([toy('thu-go', 3), toy('xuong-rong', 2)]);
    const state = newOutputState();
    const tool = outputTools({ sink, allowlist, state, sendMessage: true }).runnable.find(
      (t) => t.name === SEND_MESSAGE_TOOL,
    )!;
    const mixed = await tool.run({
      text: 'Dạ ảnh hai mẫu ạ',
      imageIds: ['p:thu-go:0', 'p:thu-go:1', 'p:xuong-rong:0'],
    });
    expect(mixed.ok).toBe(false);
    expect(JSON.parse(mixed.content)).toMatchObject({ error: 'one_product_per_message' });
    expect(sent).toHaveLength(0);
    expect(state.sent).toHaveLength(0);

    for (const ids of [['p:thu-go:0', 'p:thu-go:1'], ['p:xuong-rong:0']])
      expect(JSON.parse((await tool.run({ text: 'Mẫu', imageIds: ids })).content)).toMatchObject({
        status: 'sent',
      });
    expect(sent.map((m) => m.images.length)).toEqual([2, 1]);
  });
});

describe('send_message: pictures already received (MS2-5, LM2-4)', () => {
  it('drops a picture the conversation received and refuses a call left with none', async () => {
    const product = {
      id: 'thu-go',
      name: 'Thú gỗ',
      imageUrls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
      accommodation: null,
    } as unknown as ProductDto;
    const sent: OutgoingMessage[] = [];
    const sink: MessageSink = {
      send: vi.fn(async (m: OutgoingMessage) => {
        sent.push(m);
        return { delivered: 1 };
      }),
    };
    const allowlist = new ImageAllowlist([], BASE);
    allowlist.addProducts([product]);
    const tool = outputTools({
      sink,
      allowlist,
      state: newOutputState(),
      sendMessage: true,
      sentMediaUrls: ['https://cdn.example.com/a.jpg'],
    }).runnable.find((t) => t.name === SEND_MESSAGE_TOOL)!;
    const again = await tool.run({ text: 'Thú gỗ', imageIds: ['p:thu-go:0'] });
    expect(JSON.parse(again.content)).toMatchObject({ error: 'pictures_already_sent' });
    expect(sent).toHaveLength(0);
    await tool.run({ text: 'Thú gỗ', imageIds: ['p:thu-go:0', 'p:thu-go:1'] });
    expect(sent[0]?.images.map((i) => i.url)).toEqual(['https://cdn.example.com/b.jpg']);
    // LM3-3: the customer asked to see them again.
    await tool.run({ text: 'Thú gỗ', imageIds: ['p:thu-go:0'], resend: true });
    expect(sent[1]?.images.map((i) => i.url)).toEqual(['https://cdn.example.com/a.jpg']);
  });
});
