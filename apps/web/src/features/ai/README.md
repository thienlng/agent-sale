# features/ai

Mirrors the backend `ai` module. `api/` = TanStack Query hooks calling `@/lib/api-client` with types from `@agent-sales/contracts`; `components/` = feature UI; `hooks/` = feature logic. Never import another feature; compose in `routes/`.

## Quick replies in the test chat (bot orders)

When a playground reply message carries `quickReplies` (the order summary's "✅ Đặt hàng" / "✏️ Sửa thông tin"), the test chat renders them as buttons under the last bubble of the newest bot message only. A tap sends the button title as the next customer message (the payload is not sent, and the typed draft and queued images are kept); any newer customer message retires the buttons.
