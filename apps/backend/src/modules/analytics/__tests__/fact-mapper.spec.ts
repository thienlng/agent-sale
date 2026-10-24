import { describe, expect, it } from 'vitest';

import { mapOutboxEvent } from '../application/fact-mapper.js';
import type { OutboxRow } from '../domain/fact.js';

const WS = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d01';
const CONTACT = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d02';
const USER = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d03';
const TAG = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d04';
const ASSIGNMENT = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d05';
const CONVERSATION = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d06';
const CHANNEL = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d07';
const AT = '2026-10-20T03:00:00.000Z';
const SEEN = new Date('2026-10-24T08:00:00.000Z');

const row = (type: string, payload: object, aggregateId = CONTACT, id = 1): OutboxRow => ({
  id,
  workspaceId: WS,
  type,
  aggregateId,
  payload,
  createdAt: SEEN,
});
const crm = (extra: object, actor: string | null = USER) => ({
  workspaceId: WS,
  contactId: CONTACT,
  actorUserId: actor,
  occurredAt: AT,
  ...extra,
});

describe('mapOutboxEvent — customers', () => {
  it('a created customer is one fact placed at the event time, manual unless told otherwise', () => {
    const [created, ...rest] = mapOutboxEvent(
      row('crm.contact.created.v1', crm({ sourceId: null })),
    );
    expect(rest).toEqual([]);
    expect(created).toMatchObject({
      kind: 'customer.created',
      origin: 'manual',
      contactId: CONTACT,
      occurredAt: new Date(AT),
      receivedAt: SEEN,
      outboxId: 1,
    });
  });

  it('a customer created with a phone also captures it; the origin travels', () => {
    const facts = mapOutboxEvent(
      row(
        'crm.contact.created.v1',
        crm({ sourceId: null, origin: 'channel', phoneCaptured: true }),
      ),
    );
    expect(facts.map((f) => [f.kind, f.origin])).toEqual([
      ['customer.created', 'channel'],
      ['phone.captured', 'channel'],
    ]);
  });

  it('the status a customer starts with is its own kind, so it is not a change', () => {
    const facts = mapOutboxEvent(
      row('crm.contact.created.v1', crm({ sourceId: null, statusId: TAG })),
    );
    expect(facts.map((f) => f.kind)).toEqual(['customer.created', 'status.initial']);
    expect(facts[1]).toMatchObject({ subjectId: TAG, fromSubjectId: null });
  });

  it('an edit only matters when it stored a first phone number', () => {
    expect(mapOutboxEvent(row('crm.contact.updated.v1', crm({ fields: ['name'] })))).toEqual([]);
    const [f] = mapOutboxEvent(
      row('crm.contact.updated.v1', crm({ fields: ['phone'], phoneCaptured: true })),
    );
    expect(f?.kind).toBe('phone.captured');
  });
});

describe('mapOutboxEvent — tags, statuses, owners', () => {
  it('maps a tag add and remove to the same assignment, by a person or a rule', () => {
    const [add] = mapOutboxEvent(
      row('crm.tag.assigned.v1', crm({ assignmentId: ASSIGNMENT, tagId: TAG, scope: 'contact' })),
    );
    const [remove] = mapOutboxEvent(
      row(
        'crm.tag.removed.v1',
        crm({ assignmentId: ASSIGNMENT, tagId: TAG, scope: 'contact' }, null),
        CONTACT,
        2,
      ),
    );
    expect(add).toMatchObject({ kind: 'tag.assigned', refId: ASSIGNMENT, subjectId: TAG });
    expect(add?.origin).toBe('manual');
    expect(remove).toMatchObject({ kind: 'tag.removed', refId: ASSIGNMENT, origin: 'rule' });
  });

  it('maps status changes and ownership changes with both sides', () => {
    const [s] = mapOutboxEvent(
      row('crm.contact.status_changed.v1', crm({ fromStatusId: null, toStatusId: TAG })),
    );
    expect(s).toMatchObject({ kind: 'status.changed', subjectId: TAG, fromSubjectId: null });
    const [a] = mapOutboxEvent(
      row('crm.contact.assigned.v1', crm({ role: 'sales', fromUserId: null, toUserId: USER })),
    );
    expect(a).toMatchObject({ kind: 'assignment.changed', role: 'sales', subjectId: USER });
  });
});

describe('mapOutboxEvent — conversations', () => {
  it('a first customer message opens the conversation and is one inbound message', () => {
    const facts = mapOutboxEvent(
      row(
        'conversation.message.received.v1',
        {
          messageId: 'm1',
          type: 'message',
          channelId: CHANNEL,
          occurredAt: AT,
          firstMessage: true,
        },
        CONVERSATION,
      ),
    );
    expect(facts.map((f) => f.kind)).toEqual(['message.inbound', 'conversation.opened']);
    expect(facts[0]).toMatchObject({
      conversationId: CONVERSATION,
      channelId: CHANNEL,
      origin: 'channel',
      occurredAt: new Date(AT),
    });
  });

  it('a later message does not open it; an echo is staff outbound and never opens', () => {
    expect(
      mapOutboxEvent(
        row('conversation.message.received.v1', { messageId: 'm2', type: 'message' }, CONVERSATION),
      ).map((f) => f.kind),
    ).toEqual(['message.inbound']);
    expect(
      mapOutboxEvent(
        row(
          'conversation.message.received.v1',
          { messageId: 'm3', type: 'echo', firstMessage: true },
          CONVERSATION,
        ),
      ).map((f) => f.kind),
    ).toEqual(['message.outbound']);
  });

  it('events written before the new fields exist fall back to the outbox time', () => {
    const [f] = mapOutboxEvent(
      row('conversation.message.received.v1', { messageId: 'old', type: 'message' }, CONVERSATION),
    );
    expect(f).toMatchObject({ occurredAt: SEEN, channelId: null });
  });

  it('counts a reply only once the provider accepted it', () => {
    const done = (status: string) =>
      mapOutboxEvent(
        row(
          'conversation.reply.completed.v1',
          { messageId: 'r', status, sender: 'bot' },
          CONVERSATION,
        ),
      );
    expect(done('sent').map((f) => f.kind)).toEqual(['message.outbound']);
    expect(done('failed')).toEqual([]);
    expect(done('unknown')).toEqual([]);
  });
});

describe('mapOutboxEvent — everything else', () => {
  it('ignores events it does not care about, and rows without a workspace', () => {
    expect(mapOutboxEvent(row('workspace.workspace.created.v1', {}))).toEqual([]);
    expect(mapOutboxEvent(row('crm.something.new.v9', {}))).toEqual([]);
    expect(mapOutboxEvent({ ...row('crm.contact.created.v1', {}), workspaceId: null })).toEqual([]);
  });

  it('throws on a known event with a broken payload, so the projector can dead-letter it', () => {
    expect(() => mapOutboxEvent(row('crm.tag.assigned.v1', { contactId: 'not-a-uuid' }))).toThrow();
    expect(() => mapOutboxEvent(row('conversation.reply.completed.v1', { nope: 1 }))).toThrow();
  });
});
