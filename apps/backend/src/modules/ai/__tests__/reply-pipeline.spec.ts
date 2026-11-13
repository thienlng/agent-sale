import { describe, expect, it } from 'vitest';
import type { AgentLoopResult } from '@agent-sales/ai-core';

import type { BotView } from '../../bot/api/index.js';
import { newOutputState } from '../application/output-tools.js';
import {
  decideReply,
  ENGLISH_HANDOFF,
  joinedImages,
  phoneAsk,
  phoneReadBack,
  withCustomerPronoun,
  withoutStaleReadBack,
  writesEnglish,
} from '../application/reply-pipeline.js';

describe('joinedImages', () => {
  it('keeps each picture once and stays within the 30-picture contract', () => {
    const images = Array.from({ length: 40 }, (_, i) => ({
      url: `https://media.example/products/ws/${i}.jpg`,
      label: `p${i}`,
    }));
    const joined = joinedImages([images[0]!, ...images]);
    expect(joined).toHaveLength(30);
    expect(joined[0]).toEqual({ url: images[0]!.url, label: 'p0' });
    expect(new Set(joined.map((i) => i.url)).size).toBe(30);
  });
});

describe('decideReply', () => {
  const bot = { id: 'b1', name: 'TinyMind', language: 'vi' } as unknown as BotView;
  const loop = (text: string) =>
    ({
      res: { text, toolCalls: [], stopReason: 'end' },
      outcome: 'final',
      steps: [],
    }) as unknown as AgentLoopResult;

  it('drops a final answer that repeats a message sent this turn (EV-5)', () => {
    const output = newOutputState();
    output.sent.push({
      text: 'Dạ bộ thú gỗ phù hợp bé từ 1 tuổi ạ.',
      images: [],
      via: 'send_message',
    });
    const repeat = decideReply({
      loop: loop('Dạ bộ thú gỗ  phù hợp bé từ 1 tuổi ạ.\n'),
      output,
      bot,
      actionFallback: null,
    });
    expect(repeat).toEqual({ outcome: 'answered', guardrail: null, final: null });
    const other = decideReply({
      loop: loop('Bé thích mẫu nào hơn ạ?'),
      output,
      bot,
      actionFallback: null,
    });
    expect(other.final).toBe('Bé thích mẫu nào hơn ạ?');
  });
});

describe('phoneReadBack (VL-B9, LM-14)', () => {
  const bot = { id: 'b1', name: 'TinyMind', language: 'vi' } as unknown as BotView;
  const loop = (text: string) =>
    ({
      res: { text, toolCalls: [], stopReason: 'tool_use' },
      outcome: 'final',
      steps: [],
    }) as unknown as AgentLoopResult;

  it('reads back a phone the customer just gave unless the turn already repeated it', () => {
    const last = 'sđt tôi 0909 888 777, tên Hoàng Mai. Gọi lại cho tôi trong hôm nay';
    expect(phoneReadBack([last], [''])).toBe('Dạ em đã ghi nhận số 0909 888 777 ạ.');
    expect(phoneReadBack([last], ['Dạ em đã ghi nhận số 0909888777 ạ.'])).toBe('');
    expect(phoneReadBack(['gặp người thật đi'], [''])).toBe('');
    expect(phoneReadBack([], [''])).toBe('');
    // TM2-1: once only, when newly given in the newest message.
    expect(phoneReadBack(['số 0912 000 111', 'Số tài khoản bên em là gì?'], [''])).toBe('');
    expect(phoneReadBack(['số 0912 000 111', 'gọi chị số 0912000111 nhé'], [''])).toBe('');
    expect(phoneReadBack(['số 0912 000 111', 'à đổi sang số 0987 654 321'], [''])).toBe(
      'Dạ em đã ghi nhận số 0987 654 321 ạ.',
    );
    // An order recipient's phone, sent with the address, is not read back.
    expect(
      phoneReadBack(['Tên Hà, sđt 0912 345 001, địa chỉ số 12 ngõ 45 Trần Duy Hưng'], ['']),
    ).toBe('');
  });

  it('puts the read-back between the lead and the hand-over message', () => {
    const output = newOutputState();
    output.handoff = 'call back';
    const decision = decideReply({
      loop: loop(''),
      output,
      bot: { ...bot, handoffMessage: 'Dạ em chuyển nhân viên ạ.' } as BotView,
      actionFallback: null,
      customerTexts: ['số chị 0977 123 456, gọi chị nhé'],
    });
    expect(decision).toMatchObject({
      outcome: 'handoff',
      final: 'Dạ em đã ghi nhận số 0977 123 456 ạ.\nDạ em chuyển nhân viên ạ.',
    });
  });
});

describe('handoff say line (TM2-7, TM-16)', () => {
  it('leads the hand-over message when the model wrote no text', () => {
    const output = newOutputState();
    output.handoff = 'customer wants to cancel order DH000006';
    output.handoffSay = 'Dạ em ghi nhận chị muốn huỷ đơn DH000006, em xin lỗi vì giao chậm ạ.';
    const decision = decideReply({
      loop: {
        res: { text: '', toolCalls: [], stopReason: 'tool_use' },
        outcome: 'final',
        steps: [],
      } as unknown as AgentLoopResult,
      output,
      bot: { language: 'vi', handoffMessage: 'Dạ em chuyển nhân viên ạ.' } as unknown as BotView,
      actionFallback: null,
      phoneKnown: true,
    });
    expect(decision.final).toBe(
      'Dạ em ghi nhận chị muốn huỷ đơn DH000006, em xin lỗi vì giao chậm ạ.\nDạ em chuyển nhân viên ạ.',
    );
  });
});

describe('English customers at a hand-off (MS2-2)', () => {
  it('reads the phone back and hands over in English', () => {
    expect(writesEnglish('I want to complain, call me on 0977 123 456 please')).toBe(true);
    expect(writesEnglish('em muốn gặp nhân viên')).toBe(false);
    expect(writesEnglish('ok')).toBe(false);
    const output = newOutputState();
    output.handoff = 'complaint';
    const decision = decideReply({
      loop: {
        res: { text: 'I am sorry about this.', toolCalls: [], stopReason: 'tool_use' },
        outcome: 'final',
        steps: [],
      } as unknown as AgentLoopResult,
      output,
      bot: { language: 'vi', handoffMessage: 'Dạ em chuyển nhân viên ạ.' } as unknown as BotView,
      actionFallback: null,
      customerTexts: ['I want to complain, call me on 0977 123 456 please'],
    });
    expect(decision.final).toBe(
      `I am sorry about this.\nNoted, your number is 0977 123 456.\n${ENGLISH_HANDOFF}`,
    );
  });
});

describe('withCustomerPronoun (EV-4)', () => {
  it('addresses a customer who called themselves "chị" when the answer never did', () => {
    const said = ['Chị muốn mua bộ Thú gỗ xếp thăng bằng cho con, giá bao nhiêu em'];
    expect(withCustomerPronoun('Dạ bộ này giá 340.000đ ạ.', said)).toBe(
      'Dạ bộ này giá 340.000đ chị ạ.',
    );
    expect(withCustomerPronoun('Dạ chị ơi, bộ này giá 340.000đ ạ.', said)).toBe(
      'Dạ chị ơi, bộ này giá 340.000đ ạ.',
    );
    expect(withCustomerPronoun('Dạ bộ này giá 340.000đ ạ.', ['bộ này bao nhiêu'])).toBe(
      'Dạ bộ này giá 340.000đ ạ.',
    );
    expect(withCustomerPronoun('Dạ giá 180.000đ ạ.', ['em muốn hỏi giá'])).toBe(
      'Dạ giá 180.000đ ạ.',
    );
  });
});

describe('phoneAsk (MS2-1)', () => {
  it('asks for a phone only when the conversation has none and the lead-in does not ask', () => {
    const health = ['da em đang uống kháng sinh thì làm liệu trình được không ạ'];
    expect(phoneAsk(health, [''], false)).toBe(
      'Anh/chị để lại số điện thoại để nhân viên gọi tư vấn ạ.',
    );
    expect(phoneAsk(['Chị muốn hỏi về liệu trình'], [''], false)).toBe(
      'Chị để lại số điện thoại để nhân viên gọi tư vấn ạ.',
    );
    expect(phoneAsk(['Can I do this treatment while pregnant?'], [''], false, true)).toBe(
      'Could you leave your phone number so our staff can call you back?',
    );
    expect(phoneAsk(health, [''], true)).toBe('');
    expect(phoneAsk(['số em 0912 345 678'], [''], false)).toBe('');
    expect(phoneAsk(health, ['Chị cho em xin số điện thoại nhé.'], false)).toBe('');
  });
});

describe('withoutStaleReadBack (TM2-1)', () => {
  it('drops a lead-in line reading back a phone given before the newest message', () => {
    const texts = ['số chị 0977 123 456, gọi chị tư vấn nhé', 'Số tài khoản bên em là gì?'];
    expect(withoutStaleReadBack('Dạ em đã ghi nhận số 0977 123 456 ạ.', texts)).toBe('');
    expect(
      withoutStaleReadBack(
        'Dạ em chưa có số tài khoản ạ.\nDạ em đã ghi nhận số 0977123456 ạ.',
        texts,
      ),
    ).toBe('Dạ em chưa có số tài khoản ạ.');
    expect(
      withoutStaleReadBack('Dạ em đã ghi nhận số 0977 123 456 ạ.', ['gọi chị số 0977 123 456']),
    ).toBe('Dạ em đã ghi nhận số 0977 123 456 ạ.');
  });
});

describe('phoneAsk pronouns (TM3-7, MS3-4)', () => {
  it('follows the lead-in pronoun and never calls an "em" customer "em"', () => {
    expect(phoneAsk(['alo shop, hôm qua chị có đặt đơn'], ['Dạ em xin lỗi chị ạ.'], false)).toBe(
      'Chị để lại số điện thoại để nhân viên gọi tư vấn ạ.',
    );
    expect(phoneAsk(['e muốn hỏi liệu trình'], [''], false)).toBe(
      'Cho em xin số điện thoại để nhân viên gọi tư vấn ạ.',
    );
    expect(phoneAsk(['shop ơi'], ['Dạ anh/chị chờ em ạ.'], false)).toBe(
      'Anh/chị để lại số điện thoại để nhân viên gọi tư vấn ạ.',
    );
  });
});

describe('withCustomerPronoun for an "em" customer (MS3-4)', () => {
  it('thanks and greets her as "bạn", never "em"', () => {
    expect(
      withCustomerPronoun('Dạ giá 180.000đ ạ.\nCảm ơn em đã hỏi Lotus Spa ạ.', [
        'em muốn hỏi giá ạ',
      ]),
    ).toBe('Dạ giá 180.000đ ạ.\nCảm ơn bạn đã hỏi Lotus Spa ạ.');
    expect(withCustomerPronoun('Dạ cho em xin số điện thoại ạ.', ['em muốn hỏi giá'])).toBe(
      'Dạ cho em xin số điện thoại ạ.',
    );
  });
});

describe('final sign-off fixes (EV-2, MS3-4)', () => {
  it('reads back the earlier phone when the customer asks which number they gave', () => {
    const texts = [
      'Chào shop, số của mình là 0987 654 321, có gì gọi mình',
      'nãy giờ nói nhiều quá, đầu buổi mình có để lại số điện thoại rồi đúng không, số nào ấy nhỉ? shop đọc lại giúp mình',
    ];
    expect(phoneReadBack(texts, [''])).toBe('Dạ số anh/chị để lại là 0987 654 321 ạ.');
    expect(phoneReadBack(texts, ['Dạ số chị để lại là 0987654321 ạ.'])).toBe('');
    expect(phoneReadBack([texts[0]!, 'Số tài khoản bên em là gì?'], [''])).toBe('');
  });

  it('never addresses an "em" customer as "em"', () => {
    expect(
      withCustomerPronoun('Em cảm ơn lời chào và lời cảm ơn của em ạ.', ['em chào spa, em cảm ơn']),
    ).toBe('Em cảm ơn lời chào và lời cảm ơn của bạn ạ.');
    expect(withCustomerPronoun('Dạ còn hàng rồi em ạ.', ['em muốn hỏi'])).toBe(
      'Dạ còn hàng rồi ạ.',
    );
    expect(withCustomerPronoun('Dạ cho em xin số ạ.', ['em muốn hỏi'])).toBe('Dạ cho em xin số ạ.');
  });
});
