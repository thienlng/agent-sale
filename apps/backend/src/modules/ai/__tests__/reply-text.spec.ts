import { describe, expect, it } from 'vitest';

import { normalizeReplyText, quotedSources, withoutSentLines } from '../domain/reply-text.js';

describe('normalizeReplyText: literal "\\n" in the customer reply (T-135)', () => {
  it('turns every stand-alone literal \\n into a line break, wherever the model put it', () => {
    expect(normalizeReplyText('Dạ shop còn mẫu này ạ.\\nAnh/chị đi size bao nhiêu ạ?')).toBe(
      'Dạ shop còn mẫu này ạ.\nAnh/chị đi size bao nhiêu ạ?',
    );
    // Vietnamese replies often end a line with "ạ", an emoji or a lowercase start.
    expect(normalizeReplyText('Dạ còn ạ\\nanh/chị cần size nào ạ')).toBe(
      'Dạ còn ạ\nanh/chị cần size nào ạ',
    );
    expect(normalizeReplyText('Dạ em chào anh 😊\\n\\nShop có ạ')).toBe(
      'Dạ em chào anh 😊\n\nShop có ạ',
    );
    expect(normalizeReplyText('Dạ\\r\\nVâng ạ')).toBe('Dạ\nVâng ạ');
  });

  it('still converts when the reply quotes a product name', () => {
    expect(normalizeReplyText('Dạ mẫu "Áo thun basic" còn ạ.\\nAnh/chị lấy màu gì ạ?')).toBe(
      'Dạ mẫu "Áo thun basic" còn ạ.\nAnh/chị lấy màu gì ạ?',
    );
  });

  it('keeps real line breaks and an escaped backslash before n, and trims the ends', () => {
    expect(normalizeReplyText('  Dòng một\nDòng hai \n')).toBe('Dòng một\nDòng hai');
    expect(normalizeReplyText(String.raw`Ký hiệu \\n giữ nguyên`)).toBe(
      String.raw`Ký hiệu \\n giữ nguyên`,
    );
  });

  it('converts after a one-letter label and inside backticks too: a sales reply has no code', () => {
    expect(normalizeReplyText('Mẫu A:\\n- giá 100k\\nMẫu B:\\n- giá 200k')).toBe(
      'Mẫu A:\n- giá 100k\nMẫu B:\n- giá 200k',
    );
    expect(normalizeReplyText('Mã `SP01` còn ạ\\nAnh lấy mấy cái ạ?')).toBe(
      'Mã `SP01` còn ạ\nAnh lấy mấy cái ạ?',
    );
  });

  it('stays linear on long input', () => {
    const reply = `${'\\n'.repeat(5_000)}x`;
    const started = performance.now();
    expect(normalizeReplyText(reply)).toBe('x');
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe('quotedSources', () => {
  const sources = [
    { key: 'kb:1', answer: 'Dạ áo thun giá 350.000đ, hotline 0901234567' },
    { key: 'kb:2', answer: 'Giao hàng toàn quốc trong 2 đến 4 ngày làm việc ạ' },
    { key: 'kb:3', answer: 'Bảo hành 6 tháng' },
  ];

  it('marks an entry the reply quotes, ignoring accents and punctuation', () => {
    expect(quotedSources('Dạ ao thun gia 350.000đ, hotline 0901234567 ạ', sources)).toEqual(
      new Set(['kb:1']),
    );
  });

  it('accepts a run of six words of a long answer, or the whole of a short one', () => {
    const used = quotedSources(
      'Bên em giao hàng toàn quốc trong 2 đến 4 ngày; bảo hành 6 tháng ạ',
      sources,
    );
    expect(used).toEqual(new Set(['kb:2', 'kb:3']));
  });

  it('marks nothing for an unrelated reply', () => {
    expect(quotedSources('Dạ em chào anh ạ', sources).size).toBe(0);
  });
});

describe('normalizeReplyText: a repeated line is sent once (TM-22)', () => {
  it('drops a line equal to an earlier one, ignoring case and spacing', () => {
    expect(
      normalizeReplyText(
        'Dạ có ạ, TinyMind có bộ thực phẩm gỗ.\nGiá 450.000đ ạ.\ndạ có ạ,  TinyMind có bộ thực phẩm gỗ.',
      ),
    ).toBe('Dạ có ạ, TinyMind có bộ thực phẩm gỗ.\nGiá 450.000đ ạ.');
    expect(normalizeReplyText('A\n\nB\n\nC')).toBe('A\n\nB\n\nC');
  });
});

describe('withoutSentLines (VL-B8)', () => {
  it('drops the answer lines a send_message already said, a "Dạ" lead ignored', () => {
    const sent = 'E27 có gói nhỏ nhất là Combo 4 phòng, tiêu chuẩn 10 người lớn ạ.';
    expect(
      withoutSentLines(
        `Dạ E27 có gói nhỏ nhất là Combo 4 phòng, tiêu chuẩn 10 người lớn ạ.\nGiá Combo 4 phòng là 8.000.000đ ạ.`,
        [sent],
      ),
    ).toBe('Giá Combo 4 phòng là 8.000.000đ ạ.');
    expect(withoutSentLines('EVANI – EVANI 7PN', ['EVANI – EVANI 7PN'])).toBe('');
    expect(withoutSentLines('Dạ còn ạ.', [])).toBe('Dạ còn ạ.');
  });
});

describe('normalizeReplyText: stray scripts and meta lines (TM-22, TM3-8)', () => {
  it('drops characters of scripts a Vietnamese chat never uses', () => {
    expect(normalizeReplyText('Dạ giá 340.000đ ạ જો.')).toBe('Dạ giá 340.000đ ạ.');
    expect(normalizeReplyText('Dạ em gửi સố điện thoại ạ.')).toBe('Dạ em gửi ố điện thoại ạ.');
  });

  it('drops a line about the message instead of to the customer', () => {
    expect(
      normalizeReplyText(
        'Dạ em đây ạ 😊\nTin nhắn này là câu chào nên có thể trả lời tự nhiên, không cần tra cứu.',
      ),
    ).toBe('Dạ em đây ạ 😊');
    expect(normalizeReplyText('Dạ khách hàng thân thiết được giảm 5% ạ.')).toBe(
      'Dạ khách hàng thân thiết được giảm 5% ạ.',
    );
  });
});

describe('reworded repeats (LM3-1)', () => {
  const said = 'Lớp nhóm có sĩ số 8–10 học viên, học phí liên hệ ạ.';
  const reworded = 'Dạ lớp nhóm sĩ số 8–10 học viên, học phí là liên hệ.';

  it('drops a final line that rewords a message already sent this turn', () => {
    expect(withoutSentLines(`${reworded}\nLớp 1-1 học theo lịch riêng ạ.`, [said])).toBe(
      'Lớp 1-1 học theo lịch riêng ạ.',
    );
  });

  it('inside one answer drops only an exact repeat (review 2026-11-13)', () => {
    expect(normalizeReplyText(`${said}\n${reworded}`)).toBe(`${said}\n${reworded}`);
    expect(normalizeReplyText(`${said}\nDạ ${said.toLowerCase()}`)).toBe(said);
    expect(normalizeReplyText('Dạ có ạ.\nDạ có size 41 ạ.')).toBe('Dạ có ạ.\nDạ có size 41 ạ.');
  });
});

describe('lines that differ in one word are never dropped (review 2026-11-13)', () => {
  it('keeps list items, villas and rooms that differ in a size, name or view', () => {
    for (const text of [
      '- Áo thun trắng size M: 150.000đ\n- Áo thun trắng size L: 150.000đ',
      '- Villa A: 2.500.000đ/đêm\n- Villa B: 2.500.000đ/đêm',
      '- Áo polo đen size M x1\n- Áo polo đen size L x1\nTổng: 300.000đ',
      'Phòng Deluxe hướng biển còn trống tối thứ Bảy ạ.\nPhòng Deluxe hướng vườn còn trống tối thứ Bảy ạ.',
    ])
      expect(normalizeReplyText(text), text).toBe(text);
  });

  it('never suppresses a final answer that differs from a sent message in a content word', () => {
    expect(
      withoutSentLines('Dạ phòng Deluxe hướng vườn còn trống ạ.', [
        'Dạ phòng Deluxe hướng biển còn trống ạ.',
      ]),
    ).toBe('Dạ phòng Deluxe hướng vườn còn trống ạ.');
    expect(
      withoutSentLines('Dạ phòng Deluxe hướng biển không còn trống ạ.', [
        'Dạ phòng Deluxe hướng biển còn trống ạ.',
      ]),
    ).toBe('Dạ phòng Deluxe hướng biển không còn trống ạ.');
    // A list item already sent is dropped only when it is the same item.
    expect(withoutSentLines('- Áo thun trắng size L', ['- Áo thun trắng size M size L'])).toBe(
      '- Áo thun trắng size L',
    );
    expect(withoutSentLines('- Áo thun trắng size L', ['- Áo thun trắng size L'])).toBe('');
  });
});

describe('meta lines (TM3-8, review 2026-11-13)', () => {
  it('drops only clear reasoning about the message, never an answer about customers', () => {
    expect(normalizeReplyText('Dạ em đây ạ.\nKhách hỏi: "shop mở cửa mấy giờ".')).toBe(
      'Dạ em đây ạ.',
    );
    expect(normalizeReplyText('Dạ em đây ạ.\nNgười dùng đang chào hỏi.')).toBe('Dạ em đây ạ.');
    expect(normalizeReplyText('Dạ em đây ạ.\nThe customer is greeting.')).toBe('Dạ em đây ạ.');
    for (const answer of [
      'Khách muốn đổi size thì nhắn shop trong 7 ngày ạ.',
      'Khách đang dùng thuốc nên hỏi bác sĩ trước khi làm liệu trình ạ.',
      'Người dùng được tạo tối đa 5 tài khoản ạ.',
    ])
      expect(normalizeReplyText(answer), answer).toBe(answer);
  });

  it('checks stray scripts the same way on every call (no regex state)', () => {
    expect(normalizeReplyText('Dạ giá 340.000đ ạ જો.')).toBe('Dạ giá 340.000đ ạ.');
    expect(normalizeReplyText('Dạ giá 340.000đ ạ જો.')).toBe('Dạ giá 340.000đ ạ.');
  });
});

describe('repeats are dropped sentence by sentence, figures never (R5-4, R5-6)', () => {
  it('keeps a later line that adds a figure, even when it restates an earlier one', () => {
    const text =
      'Dạ EVANI tiêu chuẩn 24 người lớn và 9 trẻ em dưới 10 tuổi ạ.\nEVANI tiêu chuẩn 24 người lớn và 9 trẻ em dưới 10 tuổi, tối đa 35 khách ạ.';
    expect(normalizeReplyText(text)).toBe(text);
    const total =
      'Dạ D14 còn trống từ 18/12 đến 20/12/2026 ạ.\nD14 còn trống từ 18/12 đến 20/12/2026, tổng 33.000.000đ ạ.';
    expect(normalizeReplyText(total)).toBe(total);
  });

  it('drops the sentences of the answer that a sent message already said or reworded', () => {
    const sent =
      'Dạ trường hợp đang mang thai cần được bác sĩ thăm khám trực tiếp, em không thể tư vấn chị có phun môi được hay không ạ. Chị cho em xin họ tên và số điện thoại để nhân viên hỗ trợ chuyển bác sĩ tư vấn nhé.';
    expect(
      withoutSentLines(
        'Dạ đang mang thai cần được bác sĩ thăm khám trực tiếp, em không thể tư vấn chị có phun môi được hay không ạ.\nChị cho em xin họ tên và số điện thoại để nhân viên hỗ trợ chuyển bác sĩ tư vấn nhé.',
        [sent],
      ),
    ).toBe('');
    expect(
      withoutSentLines(
        'Dạ đang mang thai cần được bác sĩ thăm khám trực tiếp, em không thể tư vấn chị có phun môi được hay không ạ. Bên em mở cửa đến 21h ạ.',
        [sent],
      ),
    ).toBe('Bên em mở cửa đến 21h ạ.');
  });

  it('drops a sentence repeated inside the same answer, keeps short different ones', () => {
    expect(
      normalizeReplyText(
        'Dạ bộ thú gỗ phù hợp bé từ 1 tuổi trở lên ạ. Giá 340.000đ ạ.\nBộ thú gỗ phù hợp bé từ 1 tuổi trở lên ạ.',
      ),
    ).toBe('Dạ bộ thú gỗ phù hợp bé từ 1 tuổi trở lên ạ. Giá 340.000đ ạ.');
    expect(normalizeReplyText('Dạ còn ạ.\nDạ còn hàng ạ.')).toBe('Dạ còn ạ.\nDạ còn hàng ạ.');
  });
});
