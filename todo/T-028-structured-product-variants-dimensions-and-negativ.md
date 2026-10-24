---
id: T-028
title: Structured product variants, dimensions and negative-stock policy
status: backlog
type: feature
priority: P2
owner: 
feature_ids: [ORD-01]
created: 2026-10-24
updated: 2026-10-24
branch: 
pr:
parent:
---

## Context

GitHub issue #20 (RZ-ORD-005): the product form has flat variant names; the reference product has attribute/option editors, dimensions, material/unit groups, supplier links and a per-product negative-stock setting. Accepted as a gap, deferred: it changes the catalog schema and the stock rule, so it gets its own PR.

## Goal

Structured variants and an explicit inventory policy without breaking order snapshots.

## Scope

- Attributes and options per product (e.g. Màu × Size); variant combinations unique; SKU stable when an option is renamed.
- Dimensions (length/width/height with explicit units) next to weight, for shipping quotes.
- Per-product "allow selling beyond stock" policy, default off (today overselling is always allowed with a warning — owner decision needed on the default for existing shops).
- Internal notes / supplier link fields.

## Out of scope

- Product knowledge visibility for the bot (intentional Rapiz difference, not a bug).

## Acceptance criteria

- [ ] Attribute combinations unique; SKU stable after option renaming.
- [ ] Dimension units explicit in contracts and UI.
- [ ] Negative stock is an explicit product policy; orders refuse beyond-stock lines when it is off.
- [ ] Order snapshots survive catalog edits (already true; keep a test).
- [ ] Tests added/updated and `pnpm check` green
- [ ] Docs updated

## Log

- 2026-10-24 — created from #20.
