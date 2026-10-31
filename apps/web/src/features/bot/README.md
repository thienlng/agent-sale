# features/bot

Mirrors the backend `bot` module. `api/` = TanStack Query hooks calling `@/lib/api-client` with types from `@agent-sales/contracts`; `components/` = feature UI; `hooks/` = feature logic. Never import another feature; compose in `routes/`.

## Business industry (T-093)

The bots route composes the current-workspace query into this feature through props. New bot creation shows the selected business industry as read-only and submits its exact supported Industry value; it never defaults an unread or unsupported business to retail. Loading, error/retry and unsupported legacy industry states block creation. Existing bots with a different historical industry are labelled without changing their training or hiding their existing controls. Business settings show the current business name/industry and explain that industry changes are unsupported. Account-level billing and shop models are separate pending work.

## "Chốt đơn" settings (bot orders, ADR-016)

`bot-settings-orders.tsx` sits in the "Cài đặt nâng cao" tab between "Cách bot trò chuyện" and the handover section. The "Bot chốt đơn" switch is `orderTaking`: the bot gathers the products, phone number and address, sends a summary for the customer to confirm and creates the order, which waits for staff review (docs/06 §3.5). "Phí ship mặc định" is `orderShippingFeeVnd`: a nullable VND input (digits only, shown with vi-VN grouping, capped at 100 000 000); empty saves `null` and the summary then says "Phí ship: shop báo sau", while `0` means free shipping. The input stays editable when the switch is off. Both fields go into the settings PATCH only when they change. New retail, fashion and cosmetics bots start with the switch on; other bots start with it off.
