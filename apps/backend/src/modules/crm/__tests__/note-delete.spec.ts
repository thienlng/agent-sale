import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import type { IdentityFacade } from '../../identity/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import { ContactService, emptyContact } from '../application/contact.service.js';
import type { DistributionService } from '../application/distribution.service.js';
import type { CrmStore, CrmTx, HistoryRecord, NoteRecord } from '../application/ports/crm-store.js';
import { NoteDeleteNotAllowedError, NoteNotFoundError } from '../domain/crm.errors.js';

const ws = workspaceId(newId());
const author = newId();
const identity = { displayName: async () => 'Lan' } as unknown as IdentityFacade;

function setup() {
  const contact = { ...emptyContact(null, new Date()), name: 'Khách' };
  const notes = new Map<string, NoteRecord>();
  const note: NoteRecord = {
    id: newId(),
    contactId: contact.id,
    body: 'Khách dị ứng hải sản',
    authorUserId: author,
    authorName: 'Lan',
    version: 1,
    createdAt: new Date(),
    editedAt: null,
  };
  notes.set(note.id, note);
  const history: HistoryRecord[] = [];
  const redacted: string[] = [];
  const tx = {
    contacts: { find: async (id: string) => (id === contact.id ? contact : null) },
    notes: {
      find: async (id: string) => notes.get(id) ?? null,
      delete: async (id: string) => {
        notes.delete(id);
      },
    },
    history: {
      add: async (h: HistoryRecord) => {
        history.push(h);
      },
      redactNote: async (_contactId: string, noteId: string) => {
        redacted.push(noteId);
      },
    },
  } as unknown as CrmTx;
  const store: CrmStore = { run: async (_ws, fn) => fn(tx) };
  const service = new ContactService(
    store,
    identity,
    {} as WorkspaceFacade,
    {} as DistributionService,
  );
  return { service, contact, note, notes, history, redacted };
}

describe('ContactService.deleteNote', () => {
  it('lets the author delete the note and scrubs its body from the history', async () => {
    const { service, contact, note, notes, history, redacted } = setup();
    await service.deleteNote(ws, contact.id, note.id, { userId: author, role: 'sales' });
    expect(notes.has(note.id)).toBe(false);
    expect(redacted).toEqual([note.id]);
    expect(history).toEqual([
      expect.objectContaining({
        type: 'note.deleted',
        actorUserId: author,
        data: { noteId: note.id },
      }),
    ]);
    expect(JSON.stringify(history)).not.toContain('hải sản');
  });

  it("lets an owner or admin delete someone else's note", async () => {
    for (const role of ['owner', 'admin']) {
      const { service, contact, note, notes } = setup();
      await service.deleteNote(ws, contact.id, note.id, { userId: newId(), role });
      expect(notes.has(note.id)).toBe(false);
    }
  });

  it("refuses another sales member's delete with 403 and keeps the note", async () => {
    const { service, contact, note, notes } = setup();
    // An unassigned customer is visible to sales, so this is about the note, not the customer.
    await expect(
      service.deleteNote(ws, contact.id, note.id, { userId: newId(), role: 'sales' }),
    ).rejects.toBeInstanceOf(NoteDeleteNotAllowedError);
    expect(notes.has(note.id)).toBe(true);
  });

  it('answers 404 for a note of another customer, an unknown note or a malformed id', async () => {
    const { service, contact, note } = setup();
    const owner = { userId: newId(), role: 'owner' };
    await expect(service.deleteNote(ws, newId(), note.id, owner)).rejects.toThrow();
    await expect(service.deleteNote(ws, contact.id, newId(), owner)).rejects.toBeInstanceOf(
      NoteNotFoundError,
    );
    await expect(service.deleteNote(ws, contact.id, 'x', owner)).rejects.toBeInstanceOf(
      NoteNotFoundError,
    );
  });
});
