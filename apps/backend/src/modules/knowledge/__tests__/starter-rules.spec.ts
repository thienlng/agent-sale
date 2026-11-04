import { describe, expect, it } from 'vitest';

import { starterRulesFor } from '../domain/starter-rules.js';

describe('starter rules of the request businesses', () => {
  it.each([
    ['education', 'Mặc cả học phí'],
    ['spa', 'Mặc cả giá'],
  ])('%s: a bargain first gets the promotions, a hand-off only on insisting', (industry, title) => {
    const rule = starterRulesFor(industry).find((r) => r.title === title);
    expect(rule?.content).toMatch(/Trước tiên nêu các ưu đãi đang có/);
    expect(rule?.content).toMatch(/Chỉ chuyển nhân viên khi khách vẫn đòi một mức giá riêng/);
    expect(rule?.content).not.toMatch(/nói sẽ chuyển nhân viên/);
    // "đắt quá" is the usual way in (QA retest I3), not only an explicit discount request.
    expect(rule?.trigger).toMatch(/chê .*đắt/);
  });

  it('spa: offers the "đăng ký nhận ưu đãi" route when the profile has one (QA retest I3)', () => {
    const rule = starterRulesFor('spa').find((r) => r.title === 'Mặc cả giá');
    expect(rule?.content).toMatch(
      /có đăng ký nhận ưu đãi, mời khách để lại họ tên và số điện thoại/,
    );
  });

  it.each(['education', 'spa'])(
    '%s: prices are written in full, never with "k" (QA B9)',
    (industry) => {
      const rule = starterRulesFor(industry).find((r) => r.title === 'Cách nói giá');
      expect(rule?.content).toMatch(/không viết tắt bằng "k" hay "triệu"/);
      expect(rule?.content).not.toMatch(/\d/);
      expect(starterRulesFor('retail').find((r) => r.title === 'Cách nói giá')?.content).toMatch(
        /"k"/,
      );
    },
  );
});
