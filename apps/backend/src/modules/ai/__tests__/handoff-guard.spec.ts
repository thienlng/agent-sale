import type { RunnableTool } from '@agent-sales/ai-core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { guardHandoff, latestCustomerBlock } from '../application/handoff-guard.js';

const handoffRun = vi.fn(async () => ({ content: '{"status":"handed_over"}' }));
const tools = (): RunnableTool[] => [
  {
    name: 'product_details',
    readOnly: true,
    schema: z.object({}),
    run: async () => ({ content: '{"policies":"Đặt cọc 50% khi giữ căn"}' }),
  },
  { name: 'handoff', readOnly: false, schema: z.object({ reason: z.string() }), run: handoffRun },
];
const OFFERED = ['product_details', 'handoff', 'check_availability', 'prepare_hold'];

describe('guardHandoff (VL2-1)', () => {
  it('refuses a handoff the tools serve once, with the tool to use, then lets the next one through', async () => {
    handoffRun.mockClear();
    const wrapped = guardHandoff(tools(), {
      customerText: 'co phu thu cho dua 8 tuoi ko',
      offeredTools: OFFERED,
      shopText: '',
    });
    const handoff = wrapped.find((t) => t.name === 'handoff')!;
    const first = await handoff.run({ reason: 'cần chủ căn xác nhận phụ thu' });
    expect(first.ok).toBe(false);
    expect(JSON.parse(first.content)).toMatchObject({
      errorCode: 'handoff_refused',
      topic: 'availability',
      useTool: 'check_availability',
    });
    expect(handoffRun).not.toHaveBeenCalled();
    const second = await handoff.run({ reason: 'khách vẫn cần nhân viên' });
    expect(second.ok).not.toBe(false);
    expect(handoffRun).toHaveBeenCalledTimes(1);
  });

  it('reads a policy from a tool result of the same turn', async () => {
    const wrapped = guardHandoff(tools(), {
      customerText: 'cọc bao nhiêu em',
      offeredTools: OFFERED,
      shopText: '',
    });
    await wrapped.find((t) => t.name === 'product_details')!.run({});
    const out = await wrapped.find((t) => t.name === 'handoff')!.run({ reason: 'deposit' });
    expect(JSON.parse(out.content)).toMatchObject({ topic: 'deposit' });
  });

  it('passes an explicit request for a person straight through', async () => {
    handoffRun.mockClear();
    const wrapped = guardHandoff(tools(), {
      customerText: 'cho chị gặp nhân viên',
      offeredTools: OFFERED,
      shopText: '',
    });
    await wrapped.find((t) => t.name === 'handoff')!.run({ reason: 'asked for staff' });
    expect(handoffRun).toHaveBeenCalledTimes(1);
  });

  it('reads the customer messages after the shop’s last reply', () => {
    expect(
      latestCustomerBlock([
        { role: 'customer', content: 'a' },
        { role: 'bot', content: 'b' },
        { role: 'customer', content: 'c' },
        { role: 'customer', content: 'd' },
      ]),
    ).toBe('c\nd');
  });
});
