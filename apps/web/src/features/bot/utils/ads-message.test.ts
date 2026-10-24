import { describe, expect, it } from 'vitest';

import { adsMessageProblems, buildAdsMessage, emptyAdsDraft } from './ads-message';

describe('buildAdsMessage', () => {
  it('builds a plain text message', () => {
    const draft = { ...emptyAdsDraft('text'), text: '  Chào bạn!  ' };
    expect(buildAdsMessage(draft)).toEqual({ message: { text: 'Chào bạn!' } });
    expect(adsMessageProblems(draft)).toEqual([]);
  });

  it('adds text quick replies, defaulting the payload to the title', () => {
    const draft = {
      ...emptyAdsDraft('quick_replies'),
      text: 'Bạn cần gì?',
      quickReplies: [
        { title: 'Xem giá', payload: 'PRICE' },
        { title: 'Tư vấn', payload: '' },
      ],
    };
    expect(buildAdsMessage(draft)).toEqual({
      message: {
        text: 'Bạn cần gì?',
        quick_replies: [
          { content_type: 'text', title: 'Xem giá', payload: 'PRICE' },
          { content_type: 'text', title: 'Tư vấn', payload: 'Tư vấn' },
        ],
      },
    });
  });

  it('builds a generic template with postback and URL buttons', () => {
    const draft = {
      ...emptyAdsDraft('image_buttons'),
      title: 'Áo thun mùa hè',
      imageUrl: 'https://cdn.example.com/a.jpg',
      buttons: [
        { kind: 'postback' as const, title: 'Mua ngay', value: 'BUY' },
        { kind: 'web_url' as const, title: 'Xem web', value: 'https://shop.example.com' },
      ],
    };
    expect(adsMessageProblems(draft)).toEqual([]);
    expect(buildAdsMessage(draft)).toEqual({
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'generic',
            elements: [
              {
                title: 'Áo thun mùa hè',
                image_url: 'https://cdn.example.com/a.jpg',
                buttons: [
                  { type: 'postback', title: 'Mua ngay', payload: 'BUY' },
                  { type: 'web_url', title: 'Xem web', url: 'https://shop.example.com' },
                ],
              },
            ],
          },
        },
      },
    });
  });
});

describe('adsMessageProblems', () => {
  it('enforces Messenger limits', () => {
    const tooMany = {
      ...emptyAdsDraft('quick_replies'),
      text: 'Hi',
      quickReplies: Array.from({ length: 14 }, () => ({ title: 'x'.repeat(21), payload: '' })),
    };
    expect(adsMessageProblems(tooMany)).toEqual(['quickReplies', 'quickReplyTitle']);

    const insecure = {
      ...emptyAdsDraft('image_buttons'),
      title: 'A',
      imageUrl: 'http://cdn.example.com/a.jpg',
      buttons: [{ kind: 'web_url' as const, title: 'Go', value: 'ftp://x' }],
    };
    expect(adsMessageProblems(insecure)).toEqual(['imageUrl', 'buttonValue']);
    expect(adsMessageProblems(emptyAdsDraft('text'))).toEqual(['text']);
  });
});
