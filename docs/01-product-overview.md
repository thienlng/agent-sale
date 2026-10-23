# 01 — Product overview & strategy

## 1. Summary

Build an **AI Sales Agent platform for Vietnamese small and medium-sized businesses**, functionally equivalent to Preny (preny.ai) while improving on the weaknesses identified in our research. The product turns messages from Facebook, Instagram, Zalo, TikTok and websites into **measurable leads, orders and revenue**, through the chain: *AI consultation → staff takeover → CRM → orders & shipping → re-engagement*.

Analysis sources: `preny/preny-research/` (142 public URLs, 75 real dashboard screens, 18 test cases, pricing table, credits). This document is not based on Preny's source code or internal documents.

## 2. What Preny is (summary from the research dossier)

| Aspect | Observation |
|---|---|
| Positioning | AI sales chatbot → expanded into a conversational sales toolkit for SMEs |
| Modules | Bot training · Omnichannel chat · AI Mini CRM · Remarketing (ZBS, FMM, Email) · Automation Workflow · Orders (catalog, warehouse, shipping carriers, Google Sheet, ad optimization) · Analytics · Usage limits · AI/ZBS credit wallets · Affiliate · Ticket |
| Channels | Facebook, Instagram, Zalo OA, TikTok Business, Lazada, Website widget; Gmail; SMS/ZNS "coming soon" |
| Shipping | Viettel Post, SPX, J&T |
| AI | Smart/Pro/Neo labels (commercial); publicly states it is built on ChatGPT; Neo "coordinates multiple models, controls facts" |
| Pricing | Free; Smart 785,000 VND, Pro 974,000 VND, Neo 1,624,000 VND/month (12-month term); AI wallet 60–195 VND/response |
| Visible technology | Next.js App Router, next-intl, its own API `api.preny.ai/api/v1`, MongoDB (per its policy) |
| GTM | Free tier, industry-specific SEO content, demo/consultation, affiliate 20%/300,000 VND, scripting team for higher plans |

## 3. Our vision & positioning

> *"A 24/7 AI sales rep for Vietnamese online shops — answers with the shop's own correct data, knows when to call in a human, and proves the revenue."*

**Product principles:**
1. **Correct first, clever second** — never fabricate prices/stock/policies; show the shop owner the source of each answer.
2. **One source of truth** — catalog, prices and stock are shared between the bot and orders.
3. **Handoff is a complete flow** — assignee, reason, summary, and transparent bot status.
4. **Measurable** — from ad source → conversation → phone number → order → successful delivery.
5. **Cost transparency** — plans, quotas and credits explained consistently; no hidden fees.

## 4. Target customers (ICP)

| ICP | Description | Core value | Suitable plan |
|---|---|---|---|
| A — Shops running messaging ads | Fashion, cosmetics, household goods; many repetitive price inquiries | Instant replies, collect phone numbers, create orders, CAPI ad optimization | Smart/Pro |
| B — Services needing leads + appointments | Spa, aesthetics, dental, education, study abroad, real estate | Capture needs and preferred schedule, route to a consultant | Smart/Pro |
| C — Businesses with an existing customer base | Long-established sellers, data in Excel/many inboxes | CRM, segmentation, ZBS/email remarketing, workflows | Pro/Neo |
| D — Agencies/partners *(new)* | Advertising agencies managing many shops | Multi-workspace, affiliate/reseller | Neo/Enterprise |

## 5. "Clone + surpass" strategy

**Clone (parity):** the entire module structure and flows in [02](02-functional-requirements.md) & [03](03-screens-and-routes.md).

**Surpass (deliberate differentiation), based on weaknesses observed in Preny:**

| Preny weakness (observed) | Our approach |
|---|---|
| Bot products and the order catalog are separate | One catalog; the bot picks products from the catalog |
| Test chats are written to the inbox like real conversations, a zero wallet still replies, quota unchanged | `is_test` flag, clear sandbox billing rules |
| Bot edit history is empty | Real configuration + knowledge audit, with diff and rollback (P2) |
| Answer sources are not visible | "This answer used FAQ #12, product AO-01" for the person configuring the bot |
| Workflows are hard to observe | Run log: why it entered, why it stopped, which order was attributed |
| E2EE messaging is inconsistent with server-side AI | Honest security communication; clean legal documents |
| EN FAQ has mismatched questions/answers, VI metadata on EN pages, zoom blocked | Proper bilingual website, accessibility |
| Carriers: Viettel/SPX/J&T | Add GHN, GHTK (popular with online shops) |
| Generic channel errors | Errors with remediation actions, per-connector status page |

**No copying:** of Preny's source code, graphical interface, brand, marketing content/copy, images or documentation. We only learn from the feature structure and business flows.

## 6. Business model

- **Subscription** (Free → Smart → Pro → Neo → Enterprise) by channels, staff, CRM contacts, storage, model tier.
- **Usage-based**: AI message wallet by tier; ZBS/email/SMS wallets.
- **Services**: setup & script optimization, training.
- **Distribution channels**: self-serve free tier, industry-specific SEO, demo/consultation, affiliates & agencies.
- TCO and ROI formulas for customers: see `preny-research/01-business-model/04-chi-phi-va-unit-economics.md` — used as a sales tool (ROI calculator on the website).

## 7. Success metrics

| Group | Metric | Year-1 target (proposed, PO to confirm) |
|---|---|---|
| Activation | % of workspaces reaching "first value" within 7 days (bot replies to ≥ 20 real customers) | ≥ 35% |
| Conversion | Free → paid within 30 days | ≥ 5% |
| Retention | Paid logo retention at month 3 | ≥ 80% |
| AI quality | % of conversations the bot handles on its own without a human (by industry) | Track, increase every quarter |
| Critical errors | Wrong price/policy/incorrect order creation per 1,000 conversations | < 1 |
| Economics | Gross margin | ≥ 70% |
| Operations | Support hours/customer/month | Decreasing by cohort |
