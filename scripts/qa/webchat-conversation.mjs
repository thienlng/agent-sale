#!/usr/bin/env node
// Plays one scripted customer conversation through a website channel (the public webchat API the
// widget uses), so the thread lands in the shop's inbox ("Tin nhắn đa kênh") like a real visitor's.
// Optional staff steps reply from the inbox as the logged-in owner (staff takeover).
//
// Usage:
//   node scripts/qa/webchat-conversation.mjs --site <siteKey> --script <file.json> --out <transcript.md>
//     [--api http://127.0.0.1:3000/api/v1] [--origin https://demo.rapiz.test]
//     [--login <file with "email: …" and "password: …" lines>] [--workspace <workspaceId>]
//
// Script file:
//   { "title": "…", "path": "san-pham", "pageTitle": "…", "maxWait": 180,
//     "turns": ["customer text", { "wait": 30 }, { "staff": "staff reply" }, { "takeover": true }] }
//
// Procedure and rules: docs/qa/testing-through-the-inbox.md. Never point it at a real customer site.
/* global fetch, console, setTimeout */
import crypto from 'node:crypto';
import fs from 'node:fs';
import process from 'node:process';
import { parseArgs } from 'node:util';

const { values: a } = parseArgs({
  options: {
    site: { type: 'string' },
    script: { type: 'string' },
    out: { type: 'string' },
    api: { type: 'string', default: 'http://127.0.0.1:3000/api/v1' },
    origin: { type: 'string', default: 'https://demo.rapiz.test' },
    login: { type: 'string' },
    workspace: { type: 'string' },
  },
});
if (!a.site || !a.script || !a.out) {
  console.error(
    'usage: --site <siteKey> --script <file.json> --out <transcript.md> (see the header)',
  );
  process.exit(1);
}
const script = JSON.parse(fs.readFileSync(a.script, 'utf8'));
const base = `${a.api}/webchat/v1/sites/${a.site}`;
const page = {
  url: `${a.origin}/${script.path ?? ''}`,
  title: script.pageTitle ?? script.title,
  sections: [],
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = { visitor: null, after: null, conversationId: null, staffToken: null };
// The widget shows staff and bot messages alike (role `agent`): staff texts sent here are skipped.
const staffTexts = new Set();
let log = `# ${script.title}\n`;
const write = () => fs.writeFileSync(a.out, log);

async function poll() {
  const q = state.after ? `?after=${encodeURIComponent(state.after)}` : '';
  const r = await fetch(`${base}/messages${q}`, {
    headers: { origin: a.origin, authorization: `Visitor ${state.visitor}` },
  });
  return r.json();
}

/** Waits for the replies to the last message: done once the bot stops typing for 5 s. */
async function collect(sentAt) {
  const got = [];
  let quietSince = null;
  while (Date.now() - sentAt < (script.maxWait ?? 180) * 1000) {
    await sleep(2500);
    const p = await poll();
    if (!Array.isArray(p.messages)) continue;
    for (const m of p.messages) {
      if (m.role !== 'customer' && !staffTexts.delete(m.text)) {
        got.push(m);
        quietSince = Date.now();
      }
      state.after = m.id;
    }
    if (p.botTyping) quietSince = null;
    if (got.length && quietSince && Date.now() - quietSince > 5000) break;
  }
  return got;
}

async function staffSession() {
  if (state.staffToken) return state.staffToken;
  if (!a.login || !a.workspace) throw new Error('staff steps need --login and --workspace');
  const lines = fs.readFileSync(a.login, 'utf8').split('\n');
  const field = (k) =>
    lines
      .find((l) => l.startsWith(`${k}:`))
      ?.slice(k.length + 1)
      .trim();
  const r = await fetch(`${a.api}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: field('email'), password: field('password') }),
  });
  if (r.status !== 200) throw new Error(`staff login failed: HTTP ${r.status}`);
  state.staffToken = (await r.json()).accessToken;
  return state.staffToken;
}

/**
 * The widget API does not expose the inbox conversation id, so staff steps take the most recently
 * updated website conversation of the shop. Run one script at a time per shop.
 */
async function conversationId(token) {
  if (state.conversationId) return state.conversationId;
  const r = await fetch(`${a.api}/conversations`, {
    headers: { authorization: `Bearer ${token}`, 'x-workspace-id': a.workspace },
  });
  const list = (await r.json()).data ?? [];
  const found = list.find((c) => c.provider === 'website');
  if (!found) throw new Error('no website conversation in the inbox yet');
  state.conversationId = found.id;
  return found.id;
}

async function staff(path, method, body) {
  const token = await staffSession();
  await conversationId(token);
  const r = await fetch(`${a.api}/conversations/${state.conversationId}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-workspace-id': a.workspace,
    },
    body: JSON.stringify(body),
  });
  if (r.status >= 300) throw new Error(`staff ${method} ${path}: HTTP ${r.status}`);
}

for (const turn of script.turns) {
  if (typeof turn === 'object' && turn.wait) {
    log += `\n(pause ${turn.wait}s)\n`;
    await sleep(turn.wait * 1000);
    continue;
  }
  if (typeof turn === 'object' && turn.takeover) {
    await staff('', 'PATCH', { mode: 'human', takeover: 'temporary' });
    log += '\n(staff takes over the conversation)\n';
    continue;
  }
  if (typeof turn === 'object' && turn.staff) {
    staffTexts.add(turn.staff);
    await staff('/messages', 'POST', { text: turn.staff, idempotencyKey: crypto.randomUUID() });
    log += `\nNHÂN VIÊN: ${turn.staff}\n`;
    continue;
  }
  const body = {
    clientMessageId: crypto.randomUUID(),
    text: turn,
    page,
    ...(state.visitor ? {} : { firstUrl: page.url, referrer: 'https://google.com/' }),
  };
  const sentAt = Date.now();
  const r = await fetch(`${base}/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: a.origin,
      ...(state.visitor ? { authorization: `Visitor ${state.visitor}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  log += `\nKHÁCH: ${turn}\n`;
  if (r.status !== 202) {
    log += `!! HTTP ${r.status} ${JSON.stringify(j)}\n`;
    break;
  }
  state.visitor ??= j.visitorToken;
  const replies = await collect(sentAt);
  const secs = ((Date.now() - sentAt) / 1000).toFixed(0);
  if (!replies.length) log += `BOT: (no reply after ${secs}s)\n`;
  for (const m of replies) {
    const who = m.role === 'agent' ? 'BOT' : m.role.toUpperCase();
    log += `${who} [~${secs}s${m.imageUrl ? ', image' : ''}]: ${m.text ?? ''}\n`;
  }
  write();
}
write();
console.log(log);
