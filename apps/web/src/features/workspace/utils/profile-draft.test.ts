import { describe, expect, it } from 'vitest';

import { rebaseDraft } from './profile-draft';

const base = { name: 'Shop', companyName: 'Cty A', productDescription: '' };

describe('rebaseDraft', () => {
  it('keeps unsaved edits when the profile refreshes for another reason (logo upload)', () => {
    const draft = { ...base, productDescription: 'Áo thun cotton' };
    expect(rebaseDraft(draft, base, { ...base })).toEqual(draft);
  });

  it('takes server changes for the fields the user did not touch', () => {
    const draft = { ...base, name: 'Shop mới' };
    const server = { ...base, companyName: 'Cty B' };
    expect(rebaseDraft(draft, base, server)).toEqual({ ...server, name: 'Shop mới' });
  });

  it('after a save the draft equals the saved profile', () => {
    const draft = { ...base, name: 'Shop mới' };
    expect(rebaseDraft(draft, base, draft)).toEqual(draft);
  });
});
