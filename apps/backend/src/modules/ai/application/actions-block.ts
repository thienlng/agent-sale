import { type BotActionView, type PendingAction } from '../../action/api/index.js';

import { safeJson } from './action-loop.js';

/** The `<actions>` list (never a URL, header or secret) and the call awaiting confirmation. */
export function actionsBlock(
  actions: readonly BotActionView[],
  pending: PendingAction | null,
): string {
  const list = actions.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    confirm: a.requiresConfirm ? 'yes' : 'no',
    params: a.params.map((p) => ({
      name: p.name,
      type: p.type,
      required: p.required,
      description: p.description,
    })),
    responseFields: a.responseFields.map((f) => ({
      name: f.name,
      type: f.type,
      description: f.description,
    })),
  }));
  const blocks = [`<actions>\n${JSON.stringify(list)}\n</actions>`];
  const waiting = pending ? actions.find((a) => a.id === pending.actionId) : undefined;
  if (pending && waiting) {
    blocks.push(
      `<pending_action>\n${safeJson({
        actionId: waiting.id,
        name: waiting.name,
        args: pending.args,
        askedMinutesAgo: Math.max(0, Math.floor((Date.now() - pending.askedAt.getTime()) / 60_000)),
      })}\n</pending_action>`,
    );
  }
  return blocks.join('\n\n');
}
