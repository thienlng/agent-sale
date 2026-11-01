# features/integration

Mirrors the backend `integration` module. `api/` = TanStack Query hooks calling `@/lib/api-client` with types from `@agent-sales/contracts`; `components/` = feature UI; `hooks/` = feature logic. Never import another feature; compose in `routes/`.

- Sync settings (wizard step 3 and the connection page): "Đẩy đơn sang KiotViet" is a real switch saved as `settings.pushOrders` (`SyncToggles` in `wizard-review-step.tsx`); "Đồng bộ khách hàng" stays "Sắp có" (on, locked) until PR 3.
- `useRetryOrderPush()` (`api/integrations.ts`) is "Thử lại" for a failed order push (`POST /integrations/kiotviet/orders/{orderId}/push`); it invalidates the orders queries. The orders routes pass it to the commerce components.
