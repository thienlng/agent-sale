# TinyMind sample data

[tinymind-junisprouts-prefill.json](tinymind-junisprouts-prefill.json) is the owner-approved sample fixture for buyer/owner role-play and order testing. It contains 59 products, 63 variants, five source images per product, a bot profile/personality update, 12 FAQ, eight situations and four quick replies. The owner designated it as sample data on 2026-10-29.

## Inventory fixture

Every product starts with **10 available**, for **590 total**. Each single-variant product starts with 10. Product `JS-027` has five variants, each starting with 2. `sampleInventory` records the initial on-hand, reserved and available quantities per SKU. These numbers are synthetic and intentionally apply even to the two products marked unavailable in the original source snapshot.

`sourceAvailable` and the source descriptions preserve website evidence. They do not override the sample inventory. Actual reservations and completed orders change the current application quantities; bot stock guidance uses those current quantities. Resetting the sample stock is an explicit operator action and must account for existing reservations.

## Reusing the fixture

Use an authorized test workspace and the existing application APIs. This file is reference data, not an automatic startup seed. Authentication credentials, access tokens and deployment-specific workspace/product/variant/warehouse IDs are not part of the fixture.

1. Confirm membership of the intended workspace, its retail bot and a test warehouse. Save a private backup before replacing existing data.
2. Apply `profileUpdate` with `PATCH /api/v1/bots/{botId}`. Empty profile keys and placeholder values clear stale facts when replacing a previous demo. Preserve unrelated channel assignments and technical settings.
3. Upsert products by `code`. Use `sampleProduct.name` and `sampleProduct.description` for the imported display/search text, plus the source `category`, `imageUrls` and sample `botInstructions`. Map each variant's `priceVnd` to the product API's integer `price`. Use existing variant IDs when updating matched SKUs. Do not create duplicates or archive unrelated products in a different workspace.
4. Apply `faqs`, `scenarios` and `quickReplies` through the existing bot APIs, matching questions/titles/shortcuts when updating existing records. Keep the FAQ source URL with its answer. Source metadata such as `sourceUrl` is not itself a request DTO field.
5. Resolve created variant IDs by SKU and the chosen warehouse ID, then use `POST /api/v1/products/{productId}/stock`. `onHand` is a counted quantity, not the available quantity. For an existing variant, the selected warehouse count needed to target availability is `targetAvailable + reservedInSelectedWarehouse - availableInOtherWarehouses`; reject a negative result and investigate rather than overwriting unrelated stock. An isolated fresh warehouse has no reservations or other inventory, so use the fixture's `sampleInventory.onHand`.
6. Read back all 59 products and verify 63 unique SKUs, expected prices/images and total availability 10 per product before creating test orders. The multi-variant product must total 10, rather than 50. Reapplying a fixture must not reset reservations or live inventory without an explicit operator decision.

Business name remains TinyMind, while the source business is JuniSprouts / KT Novelty LLC. Source storefront prices were directly verified as VND; source shipping fees remain USD and the shipping policy remains US-only. Source URLs and the checked date are preserved in the data.

## Known prerequisites

Hotline, Maps, a square logo, actual supplier inventory, costs and shipping weights remain unverified. The existing TinyMind Facebook connection needs reauthentication before live Messenger delivery and staff takeover can be tested. No real order, purchase, payment or customer message was created to prepare this fixture.

Verification evidence and source policy discrepancies are in [the prefill report](tinymind-prefill-report.md). The saved playground responses predate the approved demo inventory; the stock-unknown response is historical evidence, not the expected response after initialization.
