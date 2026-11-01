import { describe, expect, it } from 'vitest';

import { ContactListResponse } from './contact-query.schema.js';
import { ContactDto } from './contact.schema.js';

const contact = {
  id: '7f8f6d1e-0d1a-4a8c-9a59-0c7bd4b6a001',
  name: 'Chị B',
  phone: '0912000001',
  phoneNormalized: '+84912000001',
  email: null,
  birthday: null,
  gender: null,
  address: null,
  province: null,
  ward: null,
  phoneProvidedAt: null,
  addressProvidedAt: null,
  sourceId: null,
  firstSourceId: null,
  statusId: null,
  salesUserId: null,
  careUserId: null,
  adRef: null,
  profileNote: '',
  tags: [],
  version: 1,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

describe('ContactDto.external (PMS link)', () => {
  it('defaults to null for answers from before the link existed', () => {
    expect(ContactDto.parse(contact).external).toBeNull();
    expect(
      ContactListResponse.parse({ data: [contact], total: 1, page: 1, pageSize: 20 }).data[0]
        ?.external,
    ).toBeNull();
  });

  it('carries the source and the PMS customer id', () => {
    const link = { source: 'kiotviet', id: '9001' };
    expect(ContactDto.parse({ ...contact, external: link }).external).toEqual(link);
    expect(() => ContactDto.parse({ ...contact, external: { source: 'sapo', id: '1' } })).toThrow();
    expect(() =>
      ContactDto.parse({ ...contact, external: { source: 'kiotviet', id: '' } }),
    ).toThrow();
  });
});
