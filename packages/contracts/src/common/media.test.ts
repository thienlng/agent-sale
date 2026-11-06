import { describe, expect, it } from 'vitest';

import {
  isLodgingVideoPath,
  isMediaPath,
  LodgingVideoPath,
  PublicHttpsUrl,
  PublicImageUrl,
} from './media.js';

const WS = '0192f0a0-0000-7000-8000-000000000001';
const F = '0192f0a0-0000-7000-8000-0000000000aa';
const B = '0192f0a0-0000-7000-8000-0000000000bb';

describe('isMediaPath', () => {
  it('accepts the key shapes Rapiz generates', () => {
    expect(isMediaPath(`/media/products/${WS}/${F}.jpg`)).toBe(true);
    expect(isMediaPath(`/media/products/${WS}/${F}.png`)).toBe(true);
    expect(isMediaPath(`/media/workspaces/${WS}/bots/${B}/${F}.webp`)).toBe(true);
    expect(isMediaPath(`/media/webchat/${WS}/${B}/${F}.gif`)).toBe(true);
  });
  it('rejects look-alike paths that are not Rapiz keys (external CDNs)', () => {
    for (const bad of [
      '/media/products/villa-1.jpg',
      `/media/products/${WS}/abc.jpg`,
      `/media/products/shop/${F}.jpg`,
      `/media/products/${WS}/${F}.webp`,
      `/media/workspaces/${WS}/${F}.png`,
      `/media/webchat/${WS}/${F}.png`,
    ])
      expect(isMediaPath(bad), bad).toBe(false);
  });
  it('rejects traversal, empty segments, queries, encodings and other roots', () => {
    for (const bad of [
      `/media/products/${WS}/../x.jpg`,
      `/media//products/x.jpg`,
      `/media/products/${WS}/a.jpg?x=1`,
      `/media/products/${WS}/%2e%2e/a.jpg`,
      '//evil.example/media/a.jpg',
      '/api/v1/x.jpg',
      'media/products/a.jpg',
      '/media/products/a',
    ])
      expect(isMediaPath(bad), bad).toBe(false);
  });
});

describe('PublicImageUrl', () => {
  it('accepts an https link or a stored media path', () => {
    expect(PublicImageUrl.safeParse('https://cdn.example.com/a.jpg').success).toBe(true);
    expect(PublicImageUrl.safeParse(`/media/products/${WS}/${F}.jpg`).success).toBe(true);
  });
  it('rejects http, javascript, data and unsafe paths', () => {
    for (const bad of [
      'http://x.com/a.jpg',
      'javascript:alert(1)',
      'data:image/png;base64,AA',
      '/media/../a.jpg',
    ])
      expect(PublicImageUrl.safeParse(bad).success, bad).toBe(false);
  });
});

describe('lodging video paths', () => {
  const video = `/media/lodging/${WS}/${F}.mp4`;
  it('accepts the lodging mp4 key shape as Rapiz media', () => {
    expect(isMediaPath(video)).toBe(true);
    expect(isLodgingVideoPath(video)).toBe(true);
    expect(LodgingVideoPath.safeParse(video).success).toBe(true);
  });
  it('rejects look-alike video paths', () => {
    for (const bad of [
      `/media/lodging/${WS}/${F}.mov`,
      `/media/lodging/${WS}/clip.mp4`,
      `/media/lodging/shop/${F}.mp4`,
      `/media/products/${WS}/${F}.mp4`,
      `/media/lodging/${WS}/${F}.mp4?x=1`,
      `/media/lodging/${WS}/../${F}.mp4`,
      `https://cdn.example.com/media/lodging/${WS}/${F}.mp4`,
    ])
      expect(isLodgingVideoPath(bad), bad).toBe(false);
    expect(LodgingVideoPath.safeParse('https://youtu.be/abc').success).toBe(false);
  });
  it('keeps videos out of PublicImageUrl', () => {
    expect(PublicImageUrl.safeParse(video).success).toBe(false);
  });
  it('PublicHttpsUrl accepts https only', () => {
    expect(PublicHttpsUrl.safeParse('https://youtu.be/abc').success).toBe(true);
    for (const bad of [
      'http://youtu.be/abc',
      'javascript:alert(1)',
      'data:text/html,x',
      '/media/x',
    ])
      expect(PublicHttpsUrl.safeParse(bad).success, bad).toBe(false);
    expect(PublicHttpsUrl.safeParse(`https://x.vn/${'a'.repeat(2000)}`).success).toBe(false);
  });
});
