import type { WorkspaceDto } from '@agent-sales/contracts';
import { workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import type { CrmFacade } from '../../crm/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import { BOT_AUTHOR, SaasLeadService } from '../application/saas-lead.service.js';
import { leadNote } from '../domain/saas-lead.js';

const WS = workspaceId('00000000-0000-4000-8000-0000000000a1');
const CONTACT = '00000000-0000-4000-8000-0000000000d1';

function service(industry = 'saas') {
  const workspaces = {
    getById: vi.fn(async () => ({ industry }) as WorkspaceDto),
  } as unknown as WorkspaceFacade;
  const crm = {
    upsertLeadByPhone: vi.fn(async () => ({ contactId: CONTACT, created: true })),
    moveContactStatus: vi.fn(async () => true),
    addContactNote: vi.fn(async () => true),
  };
  return { crm, svc: new SaasLeadService(workspaces, crm as unknown as CrmFacade) };
}

const lead = { name: 'Chị Lan', phone: '0983 456 721', company: 'Shop Lan', teamSize: '5' };

describe('SaasLeadService.recordFromBot', () => {
  it('captures the customer by phone, moves it forward and leaves a note', async () => {
    const { svc, crm } = service();
    const res = await svc.recordFromBot(WS, { kind: 'demo', details: lead, preview: false });
    expect(res).toEqual({ outcome: 'recorded', contactId: CONTACT, created: true });
    expect(crm.upsertLeadByPhone).toHaveBeenCalledWith(WS, {
      phoneE164: '+84983456721',
      sourceKey: 'bot',
      displayName: 'Chị Lan',
      firstUrl: null,
    });
    expect(crm.moveContactStatus).toHaveBeenCalledWith(WS, CONTACT, 'requested', {
      forwardOnly: true,
    });
    expect(crm.addContactNote).toHaveBeenCalledWith(
      WS,
      CONTACT,
      'Xin demo (bot ghi nhận)\nCông ty: Shop Lan\nQuy mô: 5',
      BOT_AUTHOR,
    );
  });

  it('reports invalid arguments instead of throwing, and previews without writing', async () => {
    const { svc, crm } = service();
    const noPhone = await svc.recordFromBot(WS, {
      kind: 'demo',
      details: { name: 'Lan' },
      preview: false,
    });
    expect(noPhone).toMatchObject({ outcome: 'invalid' });
    const badPhone = await svc.recordFromBot(WS, {
      kind: 'demo',
      details: { ...lead, phone: '12' },
      preview: false,
    });
    expect(badPhone).toEqual({ outcome: 'invalid', problems: ['phone: not a phone number'] });
    expect(await svc.recordFromBot(WS, { kind: 'trial', details: lead, preview: true })).toEqual({
      outcome: 'preview',
    });
    expect(crm.upsertLeadByPhone).not.toHaveBeenCalled();
  });

  it('is not available to businesses of another industry', async () => {
    const { svc } = service('fashion');
    await expect(
      svc.recordFromBot(WS, { kind: 'demo', details: lead, preview: false }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('writes only the details the customer gave', () => {
    expect(
      leadNote('consultation', {
        name: 'Lan',
        phone: '0983456721',
        email: 'lan@example.test',
        company: '',
        teamSize: '',
        need: 'Quản lý đơn',
        preferredTime: '',
        planInterest: 'Pro',
      }),
    ).toBe(
      'Xin tư vấn (bot ghi nhận)\nNhu cầu: Quản lý đơn\nGói quan tâm: Pro\nEmail: lan@example.test',
    );
  });
});
