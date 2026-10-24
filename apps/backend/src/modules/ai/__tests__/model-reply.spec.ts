import { describe, expect, it } from 'vitest';

import { parseModelReply } from '../domain/model-reply.js';

const valid = { outcome: 'answer', reply: 'Dạ ạ', sources: ['kb:1'], imageIds: [] };

describe('parseModelReply', () => {
  it('parses a plain JSON object', () => {
    expect(parseModelReply(JSON.stringify(valid))).toEqual({ ok: true, value: valid });
  });
  it('defaults imageIds to an empty list and keeps the ones given', () => {
    const { imageIds: _omitted, ...bare } = valid;
    expect(parseModelReply(JSON.stringify(bare))).toEqual({ ok: true, value: valid });
    const withIds = { ...valid, imageIds: ['p:a:0'] };
    expect(parseModelReply(JSON.stringify(withIds))).toEqual({ ok: true, value: withIds });
  });
  it('tolerates a code fence and prose around the object', () => {
    const json = JSON.stringify(valid);
    expect(parseModelReply('```json\n' + json + '\n```')).toEqual({ ok: true, value: valid });
    expect(parseModelReply('Đây là câu trả lời: ' + json + ' hết')).toEqual({
      ok: true,
      value: valid,
    });
  });
  it('names the rejection category without echoing the text', () => {
    expect(parseModelReply('  ')).toEqual({ ok: false, reason: 'empty' });
    expect(parseModelReply('not json')).toEqual({ ok: false, reason: 'not_json' });
    expect(parseModelReply('{"outcome":"answer","reply":"x"}')).toEqual({
      ok: false,
      reason: 'schema',
    });
    expect(parseModelReply('{"outcome":"maybe","reply":"x","sources":[]}')).toEqual({
      ok: false,
      reason: 'schema',
    });
  });
});
