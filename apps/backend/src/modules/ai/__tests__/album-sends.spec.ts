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
      album: { sent: 8, remaining: 4, restarted: true },
    });
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
