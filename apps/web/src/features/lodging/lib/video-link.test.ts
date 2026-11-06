import { describe, expect, it } from 'vitest';

import { normalizeLinkInput, videoLinkOf } from './video-link';

const ID = 'dQw4w9WgXcQ';
const youtube = {
  provider: 'youtube',
  id: ID,
  thumbnail: `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`,
  embed: `https://www.youtube-nocookie.com/embed/${ID}`,
};
const DRIVE = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const drive = {
  provider: 'drive',
  id: DRIVE,
  embed: `https://drive.google.com/file/d/${DRIVE}/preview`,
};

describe('videoLinkOf', () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/watch?v=${ID}&t=42s&list=PL1`,
    `https://youtube.com/watch?feature=share&v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}?feature=share`,
  ])('reads a YouTube link: %s', (url) => {
    expect(videoLinkOf(url)).toEqual(youtube);
  });

  it.each([
    `https://drive.google.com/file/d/${DRIVE}/view?usp=sharing`,
    `https://drive.google.com/file/d/${DRIVE}`,
    `https://drive.google.com/a/example.com/file/d/${DRIVE}/view`,
    `https://drive.google.com/open?id=${DRIVE}`,
    `https://drive.google.com/uc?id=${DRIVE}&export=download`,
  ])('reads a Google Drive file link: %s', (url) => {
    expect(videoLinkOf(url)).toEqual(drive);
  });

  it.each([
    'https://www.tiktok.com/@villa/video/7300000000000000000',
    'https://www.youtube.com/@villa',
    'https://www.youtube.com/watch?v=short',
    'https://youtu.be/x',
    `https://drive.google.com/drive/folders/${DRIVE}`,
    `https://evil.example.com/file/d/${DRIVE}/view`,
    `https://youtube.com.evil.example/watch?v=${ID}`,
    'not a link',
    `javascript:alert(1)//youtu.be/${ID}`,
  ])('leaves any other link a plain link: %s', (url) => {
    expect(videoLinkOf(url)).toBeNull();
  });
});

describe('normalizeLinkInput', () => {
  it.each([
    [`youtu.be/${ID}`, `https://youtu.be/${ID}`],
    [`www.youtube.com/watch?v=${ID}`, `https://www.youtube.com/watch?v=${ID}`],
    [`drive.google.com/file/d/${DRIVE}/view`, `https://drive.google.com/file/d/${DRIVE}/view`],
    [`http://youtu.be/${ID}`, `https://youtu.be/${ID}`],
    [`HTTP://youtu.be/${ID}`, `https://youtu.be/${ID}`],
    [`  https://youtu.be/${ID}  `, `https://youtu.be/${ID}`],
    [`//youtu.be/${ID}`, `https://youtu.be/${ID}`],
    ['example.com:8443/clip', 'https://example.com:8443/clip'],
  ])('makes %s an https link', (input, expected) => {
    expect(normalizeLinkInput(input)).toBe(expected);
  });

  it.each([
    '',
    '   ',
    'hello',
    'not a link',
    'https://abc',
    'javascript:alert(1)',
    'ftp://x.com/a',
  ])('refuses %j', (input) => {
    expect(normalizeLinkInput(input)).toBeNull();
  });
});
