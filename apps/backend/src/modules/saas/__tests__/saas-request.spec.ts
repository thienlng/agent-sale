import type { SaasLeadDetails, WorkspaceDto } from '@agent-sales/contracts';
import { workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import type { CrmFacade } from '../../crm/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import type { SaasStore, SaasTx, StoredRequest } from '../application/ports/saas-store.js';
import { SaasRequestService, botRequestKey } from '../application/saas-request.service.js';
import { assertRequestTransition, mergeLeadDetails } from '../domain/saas-request.js';

const WS = workspaceId('00000000-0000-4000-8000-0000000000a1');
const CONV = '00000000-0000-4000-8000-0000000000c9';

function memoryStore() {
  const rows = new Map<string, StoredRequest>();
  const audits: string[] = [];
  const tx: Partial<SaasTx> = {
    lockKey: async () => undefined,
    findRequest: async (id) => rows.get(id) ?? null,
    findRequestByKey: async (key) =>
      [...rows.values()].find((r) => r.clientRequestId === key) ?? null,
    insertRequest: async (r) => void rows.set(r.id, { ...r }),
    updateRequest: async (r) => void rows.set(r.id, { ...r }),
    audit: async (_a, action) => void audits.push(action),
  };
  const store: SaasStore = { run: (_ws, fn) => fn(tx as SaasTx) };
  return { rows, audits, store };
}

function service(industry = 'saas', contactByPhone: string | null = null) {
  const mem = memoryStore();
  const workspaces = {
    getById: vi.fn(async () => ({ industry, timezone: 'Asia/Ho_Chi_Minh' }) as WorkspaceDto),
  } as unknown as WorkspaceFacade;
  const crm = {
    findContactIdByPhone: vi.fn(async () => contactByPhone),
    getContact: vi.fn(async (_ws: unknown, id: string) => ({ id, name: 'Lan' })),
  } as unknown as CrmFacade;
  return { ...mem, crm, svc: new SaasRequestService(mem.store, workspaces, crm) };
}

const lead = { name: 'Chị Lan', phone: '0983456721', company: 'Shop Lan', teamSize: '5' };
const bot = (details: unknown, kind: 'demo' | 'trial' = 'demo', preview = false) => ({
  conversationId: CONV,
  contactId: null,
  kind,
  details,
  preview,
});

describe('saas request rules', () => {
  it('moves forward only; converted and closed are final', () => {
    expect(() => assertRequestTransition('new', 'scheduled')).not.toThrow();
    expect(() => assertRequestTransition('scheduled', 'contacted')).not.toThrow();
    expect(() => assertRequestTransition('converted', 'contacted')).toThrow(/cannot move/);
    expect(() => assertRequestTransition('closed', 'new')).toThrow(/cannot move/);
  });

  it('a repeat fills in details and never erases what the customer said', () => {
    const stored: SaasLeadDetails = {
      name: 'Lan',
      phone: '0983456721',
      email: null,
      company: 'Shop Lan',
      teamSize: '',
      need: 'Quản lý đơn',
      preferredTime: '',
      planInterest: '',
    };
    const merged = mergeLeadDetails(stored, {
      ...stored,
      phone: null,
      company: '',
      teamSize: '10',
      email: 'lan@example.test',
    });
    expect(merged).toMatchObject({
      phone: '0983456721',
      company: 'Shop Lan',
      teamSize: '10',
      email: 'lan@example.test',
    });
  });

  it('derives one stable UUID-shaped key per conversation and kind', () => {
    const k = botRequestKey(CONV, 'demo');
    expect(k).toBe(botRequestKey(CONV, 'demo'));
    expect(k).not.toBe(botRequestKey(CONV, 'trial'));
    expect(k).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('SaasRequestService.recordFromBot', () => {
  it('creates one request per conversation and kind, then fills it in', async () => {
    const { svc, rows, audits } = service('saas', '00000000-0000-4000-8000-0000000000d1');
    const first = await svc.recordFromBot(WS, bot(lead));
    expect(first.outcome).toBe('created');
    expect(first.request).toMatchObject({
      source: 'bot',
      status: 'new',
      kind: 'demo',
      conversationId: CONV,
      contactId: '00000000-0000-4000-8000-0000000000d1',
    });
    expect((await svc.recordFromBot(WS, bot(lead))).outcome).toBe('unchanged');
    const filled = await svc.recordFromBot(WS, bot({ ...lead, preferredTime: 'Chiều thứ 5' }));
    expect(filled.outcome).toBe('updated');
    expect(filled.request?.preferredTime).toBe('Chiều thứ 5');
    expect(filled.request?.version).toBe(2);
    expect((await svc.recordFromBot(WS, bot(lead, 'trial'))).outcome).toBe('created');
    expect(rows.size).toBe(2);
    expect(audits).toEqual([
      'saas.request.created',
      'saas.request.updated',
      'saas.request.created',
    ]);
  });

  it('leaves a request staff already work on untouched', async () => {
    const { svc, rows } = service();
    const first = await svc.recordFromBot(WS, bot(lead));
    rows.get(first.request!.id)!.status = 'contacted';
    const again = await svc.recordFromBot(WS, bot({ ...lead, need: 'Khác' }));
    expect(again.outcome).toBe('in_progress');
    expect(again.request?.need).toBe('');
  });

  it('opens a new request after the previous one was converted or closed', async () => {
    const { svc, rows } = service();
    const first = await svc.recordFromBot(WS, bot(lead));
    rows.get(first.request!.id)!.status = 'closed';
    const second = await svc.recordFromBot(WS, bot(lead));
    expect(second.outcome).toBe('created');
    expect(second.request!.id).not.toBe(first.request!.id);
    expect((await svc.recordFromBot(WS, bot({ ...lead, need: 'CRM' }))).outcome).toBe('updated');
    rows.get(second.request!.id)!.status = 'converted';
    const third = await svc.recordFromBot(WS, bot(lead));
    expect(third.outcome).toBe('created');
    expect(new Set([...rows.values()].map((r) => r.clientRequestId)).size).toBe(3);
    expect(rows.get(first.request!.id)!.need).toBe('');
  });

  it('reports invalid arguments instead of throwing, and previews without writing', async () => {
    const { svc, rows } = service();
    const invalid = await svc.recordFromBot(WS, bot({ name: 'Lan' }));
    expect(invalid).toMatchObject({
      outcome: 'invalid',
      problems: ['give a phone number or an email'],
    });
    expect((await svc.recordFromBot(WS, bot(lead, 'demo', true))).outcome).toBe('preview');
    expect(rows.size).toBe(0);
  });

  it('is not available to businesses of another industry', async () => {
    const { svc } = service('fashion');
    await expect(svc.recordFromBot(WS, bot(lead))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
