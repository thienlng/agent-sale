# TinyMind prefill verification — 2026-10-29

TinyMind's existing retail bot now uses the owner's JuniSprouts toy catalog and business information. The import used authenticated application APIs, followed by verification in the owner's already-open Chrome profile **Tùng**. No application code or database schema changed.

## Saved data

| Area | Verified result |
| --- | --- |
| Active products | 59, with Vietnamese search names and original English names |
| Variants | 63 unique source SKUs and direct storefront VND prices |
| Product images | Five source HTTPS images per product; image replies tested |
| Old shoe products | Nine newly archived; historical variants and inventory retained |
| FAQ | 12 source-linked entries |
| Situations | Eight, including one after-order rule |
| Quick replies | Four: `/tuoi-be`, `/chon-bo`, `/tra-don`, `/ho-tro` |
| Bot profile | Display name, mailing address, hours, payment evidence, shipping, returns, warranty limitations, promotions and source notes |
| Business profile | Name remains TinyMind; company set to KT Novelty LLC d/b/a JuniSprouts |

All catalog names, SKUs, prices, images, categories and product guidance matched API readback. Ten description differences were trailing whitespace removed by request validation, with no factual difference. Source availability is recorded separately from unknown inventory counts. Old shoe mission, greeting, placeholders, size-chart media and policy media were removed from bot use; deleted training items have restore history and a private pre-change snapshot exists outside the repository.

## Browser checks

Native Chrome profile Tùng displayed the updated profile, product table, personality/greeting, quick replies and the connected TinyMind Facebook page. The profile form correctly showed **8/10**, with hotline and Google Maps empty. A direct playground message in that Chrome session returned the JS-039 price **960,000 VND** and correctly explained why it is not recommended for a two-year-old.

The initial API import used descriptive quick-reply text as shortcuts. Browser verification revealed that this did not match the UI's abbreviation field. All four were corrected to short keys without spaces and read back through the API.

Ten distinct API playground scenarios were exercised: catalog introduction; JS-039 price and age suitability; the five JS-027 variant prices; Vietnam shipping and COD; the conflicting return windows; product photos; human handoff intent; removal of Oxford shoe offerings; unknown stock; and purchase intent with delivery to Texas. Replies matched the imported facts, the photo response returned three source images, and a direct staff request returned `handoff`. Purchase intent did not claim an order had already been created. The initial catalog introduction is recorded in session evidence; the remaining nine responses are in [the verification data](tinymind-junisprouts-verification.json).

Four API attempts returned `503 AI_UNAVAILABLE` while the native UI playground was generating. All four passed when retried sequentially after that generation completed. The configured Hermes runtime is documented as single-flight. This is an observed concurrency limit, not evidence of multi-customer load readiness.

## Missing inputs and limits

- **Facebook:** the existing connection returns `reauth_required`, and the native UI displays **Hết hạn**. Reauthentication is required before Messenger delivery and actual inbox takeover can be verified. No permissions or channel tokens were changed.
- **Inventory:** the public website exposes availability, not warehouse quantities. No inventory adjustments were made; the application therefore has zero operational inventory for the imported products. The bot's instructions distinguish website availability from unverified stock. Demo inventory was proposed to the owner and has not been approved.
- **Hotline / Maps:** neither was verified from the source, so the previous fictitious phone was cleared and these fields remain empty.
- **Logo:** the referenced public PNG is 600 × 300. The application's logo endpoint requires a square PNG/JPEG, so no logo was uploaded.
- **Costs and weights:** no independently verified cost prices or shipping weights were imported. Existing API defaults are zero; these must not be used to claim accurate profit or carrier quotes.
- **Warehouse:** the pre-existing shoe demo warehouse remains unchanged. It is not evidence of a real JuniSprouts warehouse or pickup address.
- **Payment:** the source footer displays Visa, Mastercard, American Express, Discover, Diners Club, JCB, Maestro, UnionPay and PayPal. Availability for a particular order must be checked at checkout. No COD, bank transfer or MoMo promise was imported.
- **Currency and shipping:** the direct storefront session and cart reported VND, while source shipping policy still states USD and US-only delivery. No manual currency conversion or Vietnamese delivery policy was invented.
- **Conflicting policies:** the dedicated return policy says 60 days, whereas product accordions say 90; the imported profile uses the dedicated policy and records the discrepancy. Detailed product age recommendations take precedence over inconsistent product-card ages.

No real customer messages, purchases, live orders, tracking numbers or refunds were created. Live Messenger delivery, actual staff takeover, reservations, checkout and shipping remain unverified.

## Sources

Checked 2026-10-29: [catalog](https://junisprouts.com/collections/all), [FAQ](https://junisprouts.com/pages/faq), [contact](https://junisprouts.com/pages/contact), [shipping](https://junisprouts.com/pages/shipping-policy), [returns](https://junisprouts.com/pages/refund-policy), [store](https://junisprouts.com/pages/our-store). Each product in [the data snapshot](tinymind-junisprouts-prefill.json) carries its own source URL.
