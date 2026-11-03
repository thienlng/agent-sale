import { describe, expect, it } from 'vitest';

import { starterRulesFor } from '../domain/starter-rules.js';

describe('starter rules of the request businesses', () => {
  it.each([
    ['education', 'Mặc cả học phí'],
    ['spa', 'Mặc cả giá'],
  ])('%s: a bargain first gets the promotions, a hand-off only on insisting', (industry, title) => {
    const rule = starterRulesFor(industry).find((r) => r.title === title);
    expect(rule?.content).toMatch(/Trước tiên nêu các ưu đãi đang có/);
    expect(rule?.content).toMatch(/Chỉ chuyển nhân viên khi khách vẫn muốn một mức giá riêng/);
    expect(rule?.content).not.toMatch(/nói sẽ chuyển nhân viên/);
  });
});
