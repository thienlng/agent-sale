---
id: T-128
title: Normalize escaped line separators in generated sales replies
status: in-progress
type: bug
priority: P1
owner: '@agent:codex'
feature_ids: []
created: 2026-10-29
updated: 2026-10-29
branch: fix/T-126-web-acceptance
pr:
parent: T-126
---

## Context

An owner-to-TinyMind live acceptance run found a generated Messenger reply containing the literal characters `\\n` between two Vietnamese sentences. The same thread's human-authored multiline message was stored and rendered with a real line break, so the defect is at or before generated-reply parsing, not the inbox composer. The provider's raw output is unavailable, so the exact source of over-escaping (model versus retrieved text) is unknown.

## Goal

Generated natural-language replies turn clearly sentence-separating literal `\\n` tokens into real line breaks before delivery, without rewriting other backslash sequences or customer-supplied text.

## Scope

- In scope: normalize only the generated `reply` field after structured-output JSON parsing; cover the observed escaped-newline pattern and preservation of unrelated escapes.
- In scope: keep behavior shared by AI reply consumers, including Messenger and comment reply generation, where both use the same parsed model output.

## Out of scope

- Out of scope: changing historic messages/outbox records, editing customer input or retrieved knowledge, changing prompts/model configuration, or broad recursive unescaping.
- Out of scope: converting arbitrary `\\t`, `\\r`, Unicode escapes, paths, code samples, or all backslash sequences.

## Acceptance criteria

- [ ] A structured AI reply containing a literal `\\n` sentence separator is parsed to a reply containing a real line break before it reaches the decision/delivery path.
- [ ] Replies with quoted, inline/fenced code, Windows drive paths, any consecutive double backslashes (covering UNC paths), common slash-starting regex/POSIX path forms, or recognized code syntax are left entirely unchanged, including sentence-like escapes; actual newline characters remain intact.
- [ ] Literal backslash sequences that are not safe sentence separators (including a Windows path, `\\t`, and a quoted literal `\\n`) remain unchanged.
- [ ] Regression tests fail before the implementation and pass after it; relevant AI unit tests and lint/type checks pass.
- [ ] Root owner runs final `pnpm check` for the T-126 milestone; no migration or i18n change is required.

## Plan

Written before implementation.

1. Add a failing parser regression using structured JSON whose parsed reply contains a literal backslash-n between two sentence-like clauses, plus preservation cases for paths, `\\t`, and inline literal `\\n`.
2. Implement a conservative generated-reply-only normalizer at the model-output parsing boundary. Convert only a literal `\\n` preceded by a sentence terminator and followed by an uppercase sentence start, and only when the whole reply has no quote/backtick markers, Windows drive path, any consecutive double backslashes, slash beginning after the start or a non-alphanumeric character, or recognized code keywords/operators. Preserve all other backslashes and actual newlines. This is a bounded heuristic, not a general technical-text detector. Do not touch customer messages or knowledge inputs.
3. Add/adjust a decision-path test to prove the normalized reply is what downstream code receives, then run the focused AI tests, lint, and typecheck. Record exact results for root's aggregate QA.
4. No schema, migration, or i18n changes. Update the AI module docs only if parser-boundary behavior needs operator-facing explanation.

Risk: a literal backslash-n in technical text could resemble a sentence boundary. Normalization is skipped for the whole reply when quote/backtick markers, Windows drive paths, any consecutive double backslashes, a slash beginning after start/non-alphanumeric, or common code syntax appears; regression tests cover quoted, inline/fenced, regex, POSIX and Windows paths, UNC with and without preceding whitespace, and mixed prose/code examples. Unmarked technical text may still look like ordinary prose; this bounded set of patterns does not claim to recognize every technical context. Context guards use simple bounded checks without nested ambiguous repetition.

## Log

- 2026-10-29 — allocated under the T-126 acceptance milestone. Plan written before implementation. Live evidence establishes literal backslash-n in a generated reply but does not include raw provider output; normalization will therefore be limited to clear natural-language sentence separators.
- 2026-10-29 — QA caught that punctuation + uppercase alone would mutate a quoted JS string. Added regressions for quoted/inline/fenced code, mixed prose and code, and path-like `C:\\temp.\\nNew`; implementation now skips normalization for the entire ambiguous reply.
- 2026-10-29 — QA found regex-literal and POSIX-path cases that still matched. Added red/green preservation coverage for `/Hello.\\nWorld/` and `/tmp/config.\\nNew`, and bounded the documented guard to recognized context patterns only.
- 2026-10-29 — QA identified pathological backtracking in the slash recognizer and added `Regex:/.../`, `/config...`, UNC, and long unclosed escape regressions. Replaced complex slash parsing with linear boundary checks.
- 2026-10-29 — QA found a no-whitespace UNC path case. Added `Path:\\server\share.\nNew` and made any consecutive double backslashes skip normalization, independent of surrounding whitespace.

## Links

- Docs: `apps/backend/src/modules/ai/domain/model-reply.ts`; `packages/ai-core/prompts/sales-agent@8.md`.
- Related tasks: T-126 web acceptance; `docs/qa/web-acceptance/02-inbox.md` (BOT cases).
