---
id: T-135
title: Normalize escaped line breaks in generated sales replies
status: in-progress
type: bug
priority: P1
owner: '@agent:claude'
feature_ids: []
created: 2026-10-29
updated: 2026-10-29
branch: fix/T-134-codex-fixes
pr:
parent:
---

## Context

Live acceptance on the owner's TinyMind test thread (2026-10-29) showed a bot reply on Messenger with the literal characters `\n` between two sentences; staff multi-line messages render correctly, so the defect is in the generated reply. Codex first fixed it on its acceptance branch as local T-128 (snapshot 8bdcc26, branch `fix/T-126-web-acceptance`), with a narrow heuristic: convert only after `.`/`!`/`?` before an uppercase letter, and skip the whole reply on quotes, slashes, code keywords and similar markers.

## Goal

A customer never sees a literal `\n` in a bot reply.

## Scope

- Normalize the parsed `reply` of the model output only (`apps/backend/src/modules/ai/domain/model-reply.ts`).

## Out of scope

- Rewriting sent messages, customer text or retrieved knowledge; prompt changes.

## Acceptance criteria

- [x] Every stand-alone literal `\n` / `\r\n` in a reply becomes a line break, including after "ạ", emoji, lowercase starts and in replies that quote a product name.
- [x] `\\n` (escaped backslash) and real line breaks are unchanged; one-letter labels (`Mẫu A:\n`), backticks and salvaged prose replies are converted too.
- [x] Linear on long input; playground returns the normalized reply.
- [ ] `pnpm check` green; independent QA review.

## Plan

1. Tests first in `model-reply.spec.ts` (new cases) and the ported playground case.
2. Replace the narrow heuristic with one regex pass (no content guards after QA; see log).
3. Update the ai `MODULE.md`.

## Log

- 2026-10-29 — Ported to main by @agent:claude. Review of the Codex heuristic found real misses: Vietnamese lines usually end in "ạ" without a full stop, often with emoji or a lowercase start, and any quoted product name (`mẫu "Áo thun"`) disabled the conversion for the whole reply. Most guards (regex literals, POSIX paths, SQL keywords) protected content a sales bot does not produce. Replaced with: every stand-alone `\n`/`\r\n` → line break, skip only backtick code and drive paths. Red: 4 failing cases on main; green: 46/46 (`model-reply.spec.ts`, `playground.spec.ts`).

- 2026-10-29 — QA review: the drive-path guard `[A-Za-z]:\\` also matched ordinary labels such as `Mẫu A:\n` / `Size M:\n`, leaving the literal text; the backtick guard did the same for a backticked SKU, and `salvageProse` bypassed the normalization. Removed both guards (a sales reply has no code or paths) and applied the same function to salvaged prose. Red 2 → green; `src/modules/ai` 124/124.

## Links

- apps/backend/src/modules/ai/domain/model-reply.ts, apps/backend/src/modules/ai/MODULE.md
