import { describe, expect, it } from 'vitest';
import { freshLeads, hasNewLead, leadKey } from './lead-alerts';

const lead = (capturedAt: string, seenAt: string | null = null) => ({
  contactId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d99',
  phone: '+84912345679',
  capturedAt,
  seenAt,
});
const conv = (id: string, l: ReturnType<typeof lead> | null) => ({ id, lead: l });

describe('lead alerts', () => {
  it('flags only leads staff have not seen', () => {
    expect(hasNewLead(conv('a', lead('2026-10-27T10:00:00.000Z')))).toBe(true);
    expect(
      hasNewLead(conv('a', lead('2026-10-27T10:00:00.000Z', '2026-10-27T10:05:00.000Z'))),
    ).toBe(false);
    expect(hasNewLead(conv('a', null))).toBe(false);
    expect(leadKey(conv('a', null))).toBeNull();
  });

  it('does not announce what the first load already shows', () => {
    const known = new Set<string>();
    const items = [conv('a', lead('2026-10-27T10:00:00.000Z'))];
    expect(freshLeads(items, known, false)).toEqual([]);
    expect(freshLeads(items, known, true)).toEqual([]);
  });

  it('announces a new lead once, and again when the number is replaced', () => {
    const known = new Set<string>();
    freshLeads([conv('a', null)], known, false);
    const first = [conv('a', lead('2026-10-27T10:00:00.000Z'))];
    expect(freshLeads(first, known, true)).toHaveLength(1);
    expect(freshLeads(first, known, true)).toEqual([]);
    const replaced = [conv('a', lead('2026-10-27T11:00:00.000Z'))];
    expect(freshLeads(replaced, known, true)).toHaveLength(1);
  });

  it('ignores a lead that was seen', () => {
    const seen = [conv('a', lead('2026-10-27T10:00:00.000Z', '2026-10-27T10:01:00.000Z'))];
    expect(freshLeads(seen, new Set(), true)).toEqual([]);
  });
});
