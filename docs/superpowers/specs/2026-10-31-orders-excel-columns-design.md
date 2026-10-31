# Orders list: Excel-style column menus

Status: approved by the owner on 2026-10-31. This builds on the bot orders spec (`2026-10-31-bot-orders-and-calculator-design.md`) and ships in PR #100.

## Why

The orders toolbar takes two rows: search, the "Bot · chờ duyệt" quick filter, status, source, date range, "Lọc thêm", sort, columns and export. The owner says the quick filter looks out of place and the header is too thick. They want the table to behave like Excel: every column can be sorted and filtered from its own header, and text can be searched either in the global box or in any column's menu.

## Layout

```
[🔍 Tìm mã đơn, tên, SĐT…]  [Trạng thái: Mới ✕] [Người tạo: Bot · chờ duyệt ✕]  Xoá lọc     [Cột] [Xuất Excel]
┌──────────┬───────────┬────────────┬──────────────┬─────────┬──────────────┬─────────────┬─────────────┐
│ Mã đơn ⌄ │ Khách  ⌄  │ Sản phẩm ⌄ │ Tiền thu ⌄   │ Nguồn ⌄ │ Người tạo ⌄• │ Tạo lúc ⌄   │ Trạng thái ⌄│
```

- **The toolbar is a single row.** It holds the global search, one removable chip per active column filter (this includes filters on hidden columns), "Xoá lọc" when any filter is on, then "Cột" and "Xuất Excel". The page header keeps "Thêm đơn hàng".
  - These controls are removed: the "Bot · chờ duyệt" quick filter, the status/source selects, the date range button, "Lọc thêm" and the sort select. All of them now live in the column menus.
- **Every filterable or sortable header is a menu trigger.** It shows the label and a small chevron.
  - The trigger turns primary-coloured with a dot when the column is filtered.
  - An ↑/↓ icon appears when the list is sorted by that column.
  - The trigger is keyboard accessible: it is a button with `aria-haspopup`, and its `aria-label` states the filtered and sorted state.
- **Menu content (a popover):**
  - The top has "Sắp xếp tăng dần" and "Sắp xếp giảm dần", for sortable columns only, and the active one is checked. Choosing the active one again clears it.
  - The body holds the column's own filter.
  - The footer has "Xoá lọc cột" and "Áp dụng". Text filters also apply on Enter.

| Column | Sort | Filter |
|---|---|---|
| Mã đơn (`code`) | ✓ | text contains |
| Mã vận đơn (`tracking`) | — | text contains |
| Khách hàng (`customer`) | ✓ (name) | text contains (customer or recipient name) |
| SĐT (`phone`) | — | text contains (digits; `0…` and `+84…` match each other) |
| Địa chỉ (`address`) | — | text contains |
| Sản phẩm (`products`) | — | text contains (any line's product or variant name) |
| Vận chuyển (`carrier`) | ✓ | checklist with counts, plus a search box in the list |
| Tạm tính / Phí ship / Tổng / Đã trả / Tiền cần thu / Còn thu (COD) | ✓ | from–to money range |
| Ghi chú (`note`) | — | text contains |
| Nguồn (`source`) | ✓ | checklist with counts |
| Người tạo (`creator`) | ✓ | checklist: "Bot · chờ duyệt", "Bot · đã duyệt", then the staff, with counts and a search box |
| Tạo lúc (`placedAt`) | ✓ | quick presets (Hôm nay, 7 ngày, 30 ngày, Tháng này) plus a date range |
| Trạng thái (`status`) | ✓ | checklist with counts plus "Loại trừ các mục đã chọn" (exclude mode) |

- **Checklists** have "Chọn tất cả" / "Bỏ chọn" and show counts from `facets.counts`: the orders matching every other filter, Excel-style. Status uses the existing `counts`.
- **Pending bot orders stay visible.** The "Người tạo" header shows a primary-coloured dot while any bot order is pending review: `facets.counts.creator.bot_pending > 0` in the unfiltered sense. The dot carries a tooltip, "n đơn bot chờ duyệt", and clicking it opens the menu.
- **All state lives in the URL** (`OrdersSearch`), so sharing a link or reloading keeps it. Old URLs (`review=pending`, `createdBy=<id>`, a single `source`) still work: they are mapped to the new parameters when read.
- **Below `md`** the cards have no headers. The toolbar shows a "Lọc & sắp xếp" button that opens a sheet listing the same column editors.

## API (contract in `packages/contracts/src/commerce/commerce.schema.ts`)

`GET /orders` adds these parameters. Every one is optional, and the old ones keep working.

- `source`, `carrier` and `creator` are comma lists.
  - `creator` takes staff user ids, `bot_pending` and `bot_approved`.
  - Values within one list are OR-ed. Different columns are AND-ed.
- These parameters do an accent- and case-insensitive "contains" search: `code`, `tracking`, `customer`, `phone`, `address`, `product`, `note`.
- These pairs are inclusive VND ranges: `totalMin/Max`, `codMin/Max`, `subtotalMin/Max`, `shippingMin/Max`, `grossMin/Max`, `paidMin/Max`.
- `sort` is `<column>_<asc|desc>` over `OrderSortColumn`. Ties fall back to placed time descending, then code.
- The response adds `facets.counts.{source, creator, carrier}`. Each map counts the orders matching every filter except that column's own.
- `createdBy` and `review=pending` are deprecated aliases of `creator`.
