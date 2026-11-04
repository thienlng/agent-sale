import { assistant } from '@agent-sales/i18n/assistant';
import { describe, expect, it } from 'vitest';

import { PROPOSAL_LABEL_KEYS, proposalLabelKey } from './proposal-labels';

const { vi, en } = assistant;

describe('proposalLabelKey', () => {
  it('names a known route by its action, never by its path', () => {
    expect(proposalLabelKey('POST /bots/{botId}/faqs')).toBe('proposals.actions.faqCreate');
    expect(vi.proposals.actions.faqCreate).toBe('Thêm câu hỏi thường gặp');
    expect(proposalLabelKey('  DELETE   /warehouses/{warehouseId} ')).toBe(
      'proposals.actions.warehouseDelete',
    );
  });

  it('falls back to a generic label by method for a route it does not know', () => {
    expect(proposalLabelKey('POST /new-thing')).toBe('proposals.fallback.post');
    expect(proposalLabelKey('DELETE /new-thing/{id}')).toBe('proposals.fallback.delete');
    expect(proposalLabelKey('GARBAGE')).toBe('proposals.fallback.other');
  });

  it('has a Vietnamese and an English label for every mapped action', () => {
    for (const key of PROPOSAL_LABEL_KEYS) {
      expect(vi.proposals.actions).toHaveProperty(key);
      expect(en.proposals.actions).toHaveProperty(key);
    }
    for (const verb of ['post', 'patch', 'put', 'delete', 'other'])
      expect(vi.proposals.fallback).toHaveProperty(verb);
  });
});
