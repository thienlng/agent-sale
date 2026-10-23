# Preny Dashboard — Technical Specification for Cloning (extracted from 75 observed pages)

Source: `preny-research/08-dashboard-thuc-te/pages/*.md` (75 files, 87 observations) + `observations.json` (date `2026-10-23`, scope: *"UI authenticated; free account; survey currently available features only; no phone verification or new permissions"*).

Conventions:
- Every route is prefixed with `https://app.preny.ai`. `{botId}` = 24-hex ObjectId (observed example: `6adb52419bcae8b132c76a27`) → the backend is most likely MongoDB (inferred).
- "(inferred)" = not seen directly in the UI.
- The observed account is on the **free plan**; most tables are empty. Most findings are static UI (accessibility snapshots), not executed behavior, except items explicitly marked "tried".
- Frontend: Next.js App Router (chunks `/_next/static/chunks/app/(dashboard)/quan-ly/layout`, `.../quan-ly/bot/layout`, `.../quan-ly/bot/[id]/layout`, `.../quan-ly/bot/[id]/tich-hop-nen-tang/layout`, route group `(dashboard)`). There is a toast region `"Notifications alt+T"` (Sonner-style library, inferred).

---

## 0. App shell

### 0.1 Header (top bar)
- Logo "preny" → `/quan-ly/thong-tin-ca-nhan`.
- Link **"Trang chủ"** (Home) → `https://preny.ai`; **"Hướng dẫn"** (Guide) → `https://preny.ai/huong-dan`; **"Mua gói"** (Buy plan) → `/quan-ly/nang-cap`.
- AI credit balance badge: displays `0` (named "0AI" in `observations.sidebar`, links to `/quan-ly/vi-tin-nhan`).
- Language selector combobox (icon "lang").
- Avatar + account owner name → `/quan-ly/thong-tin-ca-nhan`.
- Site-wide banner on the free plan: **"Bạn đang sử dụng gói miễn phí. [Nâng cấp ngay]"** (You are using the free plan. [Upgrade now]) → `/quan-ly/nang-cap`.

### 0.2 Main sidebar (observed order)
Parent group (collapse button) → child item (route):
| Group | Item | Route | Badge |
|---|---|---|---|
| Đào tạo Bot (Bot Training) (link) | — | `/quan-ly/bot` | |
| Chat đa kênh (Omnichannel Chat) | Tin nhắn đa kênh (Omnichannel Messages) | `/quan-ly/tin-nhan` | "Miễn phí" (Free) |
| | Tích hợp nền tảng (Platform Integrations) | `/quan-ly/tich-hop-nen-tang/tat-ca` | |
| AI Mini CRM | Danh sách Khách hàng (Customer List) | `/quan-ly/khach-hang` | "Miễn phí" (Free) |
| | Tệp Khách hàng (Customer Segments) | `/quan-ly/tep-khach-hang` | |
| Remarketing | Zalo ZBS | `/quan-ly/chien-dich/zbs` | |
| | Facebook (FMM) | `/quan-ly/facebook-marketing-messenger` | |
| | Email | `/quan-ly/chien-dich/email` | |
| Automation Workflow (link) | | `/quan-ly/automation-workflow` | |
| Đơn hàng (Orders) | Tổng quan (Overview) | `/quan-ly/don-hang/thong-ke` | icon "hot" |
| | Danh sách đơn hàng (Order List) | `/quan-ly/don-hang` | |
| | Quản lý sản phẩm (Product Management) | `/quan-ly/quan-ly-san-pham` | |
| | Thiết lập (Setup) | `/quan-ly/thiet-lap` | |
| Thống kê (Statistics) (link) | | `/quan-ly/tong-quan` | |
| Hạn mức sử dụng (Usage Limits) (link) | | `/quan-ly/han-muc-su-dung` | |
| Nâng cấp (Upgrade) (link) | | `/quan-ly/nang-cap` | |
| Bài viết (Posts) (link) | | `/quan-ly/post-facebook` | |
| Cài đặt (Settings) | Thành viên & Quyền truy cập (Members & Access) | `/quan-ly/thanh-vien` | |
| | Thanh toán & Gói (Billing & Plans) | `/quan-ly/lich-su-giao-dich` | |
| | Affiliate | `/quan-ly/affiliate` | |
| | Hỗ trợ yêu cầu ticket (Support Tickets) | `/quan-ly/ticket-ho-tro` | |
| | Cài đặt tag (Tag Settings) | `/quan-ly/cai-dat-tag` | |
| | Cài đặt chung (General Settings) | `/quan-ly/cai-dat-thong-bao` | |
| | Cài đặt bảo mật (Security Settings) | `/quan-ly/cai-dat-bao-mat` | |
- Bottom of sidebar: button **"Đăng xuất"** (Log out); button "Toggle Sidebar" (collapsible).
- The assignment of child items to parent groups is inferred from the order in `observations.sidebar` and the group names in the snapshot (the snapshot only shows the group buttons).

### 0.3 In-bot sidebar (layout `/quan-ly/bot/[id]`)
- Top: button (back, inferred), bot name in **bold** (`NGHIEN-CUU-20261023`), a **switch** to turn the bot on/off (inferred: active/inactive).
- **"Menu chính"** (Main menu): **"Trang chủ"** (Home) `/trang-chu` · **"Sản phẩm"** (Products) `/quan-ly-san-pham` · **"Hướng dẫn"** (Instructions) `/kich-ban` · **"Thông tin"** (Information) `/du-lieu-huan-luyen` · **"Tích hợp"** (Integrations) `/tich-hop-nen-tang` · **"Thư viện ảnh"** (Image Library) `/thu-vien-anh` · **"Cài đặt"** (Settings) (expand) → **"Thiết lập bot"** (Bot Setup) `/tong-quan`, **"Tin nhắn nhanh"** (Quick Messages) `/tin-nhan-nhanh`, **"Lịch sử chỉnh sửa"** (Edit History) `/lich-su-chinh-sua`.
- Group "Development": Tool Ads Facebook `/tool`.
- Every bot sub-page has the **"Đoạn chat thử nghiệm"** (Test Chat) **panel** on the right (see 1.10) and the **onboarding checklist dialog** (see 1.2).

### 0.4 Common patterns
- Empty state: `img "nodata"` + a message.
- Tables: resizable columns (separator), row-selection checkboxes, pagination + page-size combobox.
- Date range picker in the form `dd/mm/yyyy - dd/mm/yyyy`; presets **"Đầu tháng đến nay"** (Month to date), **"30 ngày"** (30 days).
- Plan gating: the page is replaced by *"Bạn không có quyền thực hiện tính năng này. Vui lòng nâng cấp lên gói cao hơn để sử dụng tính năng này."* (You do not have permission to use this feature. Please upgrade to a higher plan to use this feature.) + **"Quay lại"** (Back); or, within integrations: img "No connection" + *"Bạn cần nâng cấp gói để kết nối nền tảng này"* (You need to upgrade your plan to connect this platform) + **"Nâng cấp gói"** (Upgrade plan).
- Image upload (avatar/logo): limit *"720x720 pixel, cao nhất là 1MB"* (720x720 pixels, maximum 1MB).

---

## 1. Bot / AI training module

### 1.1 Bot list & bot creation — `/quan-ly/bot`
- Only behavior notes exist (no snapshot): **created bot** `NGHIEN-CUU-20261023`, selected **industry "Thương mại điện tử"** (E-commerce), **no page selected** → completed successfully. Old bots were not modified → the account has multiple bots.
- The bot creation wizard includes at least: bot name, industry, page selection (optional) (inferred from the notes).
- No information yet about the columns/cards in the bot list.

### 1.2 Bot home — `/quan-ly/bot/{botId}/trang-chu`
- 4-step onboarding checklist: (1) **"Thông tin sản phẩm/dịch vụ"** (Product/service information), (2) **"Hướng dẫn bot xử lý tình huống"** (Instruct the bot how to handle situations), (3) **"Bộ câu hỏi thường gặp"** (FAQ set), (4) **"Tích hợp nền tảng"** (Platform integration) (link **"Tích hợp ngay"** (Integrate now) → `/tich-hop-nen-tang`).
- Progress: a new bot is at **2/4**; after adding 1 product → **3/4** (i.e., a new bot already ships with default Instructions + FAQ by industry — inferred from the scenario list having 3 situations and the FAQ having 6 pre-filled questions).
- The checklist is also shown as a dialog (with a **"Đóng"** (Close) button) on every bot sub-page, heading *"Thực hiện các bước bên dưới để Bot có đủ dữ liệu cần thiết và sẵn sàng hoạt động"* (Complete the steps below so the Bot has the data it needs and is ready to operate), counter `3/4`.
- Has test chat.

### 1.3 Products (bot catalog) — `/quan-ly/bot/{botId}/quan-ly-san-pham`
- Successfully saved a product: name `SAN PHAM THU NGHIEM 20261023`, code `LAB-20261023`, price `125.000 VND` (125,000 VND) **stored as text** (not a number).
- Has **"hướng dẫn riêng theo sản phẩm"** (per-product instructions) (field instructions per product).
- The list shows **"tổng 1"** (total 1).
- The bot uses this data when chatting: answers the price correctly; sends a product card `"SAN PHAM THU NGHIEM 20261023 Mã: LAB-20261023 Giá: 125.000 VND"` (… Code: LAB-20261023 Price: 125,000 VND).
- Distinct from the order catalog `/quan-ly/quan-ly-san-pham` (1 catalog per bot vs. a shared sales catalog — possibly 2 separate data stores; synchronization not confirmed).

### 1.4 Situation-handling instructions (scenarios) — `/quan-ly/bot/{botId}/kich-ban`
- Heading **"Hướng dẫn xử lý tình huống"** (Situation-handling instructions), description **"Quản lý cách Bot xử lý các tình huống phát sinh khi tương tác với khách hàng"** (Manage how the Bot handles situations that arise when interacting with customers).
- Row of special configuration cards (carousel, button **"Cuộn sang phải"** (Scroll right)):
  - Badge **"QUAN TRỌNG"** (IMPORTANT) — **"Nhiệm vụ chính của Bot"** (Bot's main mission): "Mô tả vai trò và việc Bot cần làm khi giao tiếp với khách hàng" (Describe the role and what the Bot must do when communicating with customers) → button **"Chỉnh sửa nhiệm vụ"** (Edit mission) (system prompt/role).
  - **"Chào hỏi khách hàng"** (Greeting customers): "Tin nhắn chào đầu tiên được gửi khi khách hàng bắt đầu nhắn tin" (The first greeting message sent when a customer starts messaging) → **"Thêm"** (Add).
  - **"Khách hàng gửi Reaction"** (Customer sends a Reaction): "Tin nhắn tự động gửi khi khách hàng thả biểu cảm/reaction" (Automatic message sent when a customer drops an emoji/reaction) → **"Thêm"** (Add).
- Toolbar: textbox **"Tìm kiếm theo tình huống"** (Search by situation), button **"Xuất Excel"** (Export Excel), button **"Thêm hướng dẫn"** (Add instruction).
- Table: checkbox column (header: **"Vui lòng chọn dữ liệu cần xóa"** (Please select the data to delete) → bulk delete), **"STT"** (No.) column, **"Tình huống"** (Situation) column.
- Default data (new bot, e-commerce industry): 1 **"Khung giờ hoạt động của cửa hàng"** (Store opening hours); 2 **"Khách hỏi địa chỉ/chi nhánh cửa hàng"** (Customer asks for store address/branch); 3 **"Điều hướng luồng tư vấn mua sắm theo từng bước, không lặp lại"** (Guide the shopping consultation flow step by step, without repetition).
- Footer: **"Tổng số 3 hướng dẫn"** (Total 3 instructions), page size combobox `10`, pagination.
- The detail form for a single instruction was not seen (inferred: situation + handling/reply content).

### 1.5 Information / FAQ (training data) — `/quan-ly/bot/{botId}/du-lieu-huan-luyen`
- Added 1 FAQ (content containing the code `PRENY-LAB-742`); the list grew from **6 → 7 questions** (a new bot ships with 6 default FAQs).
- Actions: **add manually**, **import file**, **export Excel**.
- The bot answered the FAQ correctly immediately after it was added (test chat: "Mã kiểm thử là PRENY-LAB-742…" (The test code is PRENY-LAB-742…)) → no separate "train" step / no significant delay (inferred).
- Limit **"Tài liệu: đã dùng 14 / 500"** (Documents: 14 / 500 used) (see 9.1) — may count FAQs + instructions + products… (inferred; 7 FAQs + 3 instructions + 1 product + … ≠ 14 for certain; counting method unclear).

### 1.6 Image library — `/quan-ly/bot/{botId}/thu-vien-anh`
- Heading **"Thư viện ảnh"** (Image Library); counter **"Hình ảnh 0/10"** (Images 0/10) + progressbar (free-plan image quota = 10).
- Empty: **"Một nơi dành cho tất cả các tệp hình ảnh của bạn"** (One place for all your image files) / **"Nhấn nút 'Tạo thư mục' để tạo thư mục chứa ảnh của bạn"** (Click the 'Create folder' button to create a folder for your images); button **"Tạo thư mục"** (Create folder) (folder = album).
- Tried: created album `LAB-20261023` (0 images). The upload form has **tabs "Hình ảnh" (Images) and "Video"**. Upload not completed (file picker).
- Related to the **"Cách thức gửi ảnh"** (Image sending method) setting (album limited to the first 30 images — see 1.7).

### 1.7 Bot setup (advanced settings) — `/quan-ly/bot/{botId}/tong-quan`
Section **"Cài đặt nâng cao"** (Advanced settings) (default values at observation time):
| Field | Type | Default / notes |
|---|---|---|
| **"Trả lời tin nhắn đầu tiên"** (Reply to first message) — "Bot trả lời khi nhận tin nhắn đầu tiên của người dùng" (Bot replies when it receives the user's first message) | switch | OFF |
| **"Tự động trả lời bình luận"** (Auto-reply to comments) — "Bot tự động phản hồi bình luận của khách hàng trên bài viết" (Bot automatically responds to customer comments on posts) | switch | OFF |
| **"Tự động trả lời qua Messenger khi có bình luận"** (Auto-reply via Messenger on comment) — "Khi khách bình luận trên bài viết, bot có thể chủ động nhắn tin qua Messenger" (When a customer comments on a post, the bot can proactively message them via Messenger) | switch | OFF |
| **"Tốc độ trả lời tin nhắn"** (Message reply speed) | select | **"Phản hồi ngay"** (Respond immediately) (other options not seen) |
| **"Độ sáng tạo của bot"** (Bot creativity) | select | **"Cân bằng (khuyến nghị)"** (Balanced (recommended)) (temperature, inferred) |
| **"Hướng dẫn Bot khi nào phân loại khách hàng"** (Instruct the Bot when to classify customers) | textarea, max **2000** characters | default: "- Khi khách gửi hình ảnh sản phẩm và thể hiện sự quan tâm tới sản phẩm trong ảnh nhưng không xác định được chính xác mã sản phẩm từ hình ảnh." (- When the customer sends a product image and shows interest in the product in the image, but the exact product code cannot be identified from the image.) (141/2000) |
| **"Trả lời khi gặp câu hỏi không xác định"** (Reply to unrecognized questions) — "Bot phản hồi khi chưa hiểu được câu hỏi" (Bot responds when it does not understand the question) | switch + textarea max **1000** | ON; text "Bạn đợi một chút sẽ có nhân viên hỗ trợ mình ngay" (Please wait a moment, a staff member will assist you shortly) (49/1000) |
| **"Xem trước tin nhắn"** (Message preview) | preview | "Dạ **mình** chào **bạn** A" (Hello customer A — rendered using the self/customer pronouns) |
| **"Cài đặt cách xưng/hô"** (Pronoun settings) — "Thiết lập cách xưng hô khi bot trả lời" (Set how the bot addresses itself and the customer when replying) | 2 textboxes **"Xưng"** (Self) / **"Hô"** (Customer) | "mình" (I/me) / "bạn" (you) |
| **"Xưng hô bằng tên khách hàng"** (Address by customer name) — "Bot sẽ gọi kèm tên của khách hàng…" (The bot will address the customer by name…) | switch | ON |
| **"Xưng hô thông minh (Facebook)"** (Smart addressing (Facebook)) — "theo tên, giới tính" (by name, gender) | switch + 3 Self/Customer pairs | ON; **"Nam"** (Male): em/anh; **"Nữ"** (Female): em/chị; **"Giới tính khác"** (Other gender): mình/bạn |
| **"Cách thức gửi ảnh"** (Image sending method) — "album chỉ được lấy tối đa 30 ảnh đầu tiên" (an album only takes up to the first 30 images) | select | **"Bộ sưu tập"** (Collection) |
| **"Tính năng đọc hình ảnh"** (Image reading) — "Bot sẽ phân tích hình ảnh và chuyển thành văn bản khi nhận tin nhắn ảnh" (The bot analyzes images and converts them to text when receiving image messages) | switch | ON (vision) |
| **"Bot ngưng trả lời sau khi thu thập đủ thông tin"** (Bot stops replying after collecting enough information) — "Bot dừng phản hồi khi khách cung cấp thông tin liên hệ" (Bot stops responding once the customer provides contact information) | switch | OFF |
| **"Bot im lặng khi nhận tin từ nền tảng khác"** (Bot stays silent on messages from other platforms) — "im lặng trong **5 phút** khi nhận tin từ nền tảng khác (fanpage, Pancake, Haravan)" (silent for **5 minutes** when receiving a message from another platform (fanpage, Pancake, Haravan)) | switch | ON |
| **"Tự bật lại bot sau khi nhắn tin thủ công"** (Re-enable bot after manual messaging) — "tự bật lại bot sau **5 phút**" (automatically re-enable the bot after **5 minutes**) | switch | ON |
| **"Tin nhắn tự động bám đuổi"** (Automatic follow-up messages) — "tự động gửi tin nhắn cho khách hàng trong vòng **24h**" (automatically message the customer within **24h**) | switch | OFF |
| **"Follow-up khi khách hàng cung cấp số điện thoại"** (Follow-up when the customer provides a phone number) | switch | OFF |
- There is an unlabeled button at the end of the form (inferred: Save). No bot model selection here (the model is tied to the plan — see 14).

### 1.8 Quick messages (quick replies) — `/quan-ly/bot/{botId}/tin-nhan-nhanh`
- Heading **"Quản lý tin nhắn nhanh"** (Quick message management); textbox **"Tìm kiếm theo nội dung..."** (Search by content...); button **"Lọc"** (Filter); button **"Thêm mới"** (Add new).
- Counter: **"Tổng tin nhắn trả lời nhanh: N"** (Total quick replies: N).
- Table: **Từ viết tắt (Shortcut) | Nội dung (Content) | Cập nhật cuối (Last updated) | Hình ảnh (Images) | Thao tác (Actions)**.
- Empty: **"Không có nội dung trả lời nhanh nào"** (No quick replies).
- Tried: saved a template with shortcut `@lab20261023` → total 1. Shortcuts have an `@` prefix (inferred: type `@xxx` in the inbox to insert).

### 1.9 Edit history — `/quan-ly/bot/{botId}/lich-su-chinh-sua`
- Date range (default "01/10/2026 - 23/10/2026"), sort toggle **"Mới nhất"** (Newest) / **"Cũ nhất"** (Oldest), link/filter **"Cài đặt"** (Settings) (inferred: filter by change type).
- Empty: **"Không có lịch sử chỉnh sửa"** (No edit history) (notably: still empty at snapshot time even after adding FAQ/product/quick reply — it may only log "Settings" changes, inferred).

### 1.10 "Đoạn chat thử nghiệm" (Test Chat) panel (playground)
- Description: "Thử chat với Bot như thể bạn là khách hàng. Xem phản hồi và điều chỉnh hướng dẫn…" (Try chatting with the Bot as if you were a customer. See the responses and adjust the instructions…).
- 3 suggested prompts (buttons): **"Cửa hàng ở đâu?"** (Where is the store?), **"Chính sách vận chuyển như thế nào?"** (What is the shipping policy?), **"Cửa hàng làm việc vào khung giờ nào?"** (What are the store's opening hours?).
- Textbox **"Nhập tin nhắn của bạn"** (Enter your message), send button (disabled when empty), another button (inferred: reset/attach), panel toggle button.
- Messages have timestamps (07:27 PM).
- Observed behavior: answers the FAQ correctly; for a non-existent product → refuses to fabricate price/stock ("Mình cần kiểm tra lại thông tin… chưa có dữ liệu về giá và tồn kho" (I need to double-check the information… there is no data on price and stock yet)); for an existing product → returns the price + sends a product card; uses the customer's name ("Bạn Test" (Test, addressed as "you")).
- Test chats from the playground **create a "Website Test User" conversation in the Inbox** (see 2.1) → the playground goes through the Website channel (inferred).
- Unclear whether test chats consume credits.

### 1.11 Tool Ads Facebook — `/quan-ly/bot/{botId}/tool` (Development group)
- Field **"Loại tin nhắn *"** (Message type *) (select, placeholder **"Vui lòng chọn loại tin nhắn"** (Please select a message type)); option seen: **"Thường"** (Standard).
- Enter message content → button **"Tạo ra"** (Generate) → tabs **"Xem trước"** (Preview) / "Code".
- Output: **JSON for Ads Manager** (message template for Click-to-Messenger ads), `message.text` = the entered content. No integration to push directly to Ads Manager — the user copies the code.

---

## 2. Inbox / Omnichannel chat module

### 2.1 Omnichannel messages — `/quan-ly/tin-nhan`
- Snapshot empty (layout could not be determined).
- Behavior tried: saw the conversation **"Website Test User"** (created from the test chat); could view **chat history**, **contact information**, **notes**; toggled **Auto-reply ON → OFF → ON** per conversation and confirmed it restored.
- Related: bot setting **"Tự bật lại bot sau 5 phút khi nhắn tin thủ công"** (Re-enable the bot 5 minutes after manual messaging); CRM rule **"Thêm ghi chú ở tin nhắn khách hàng"** (Add notes on customer messages) (message notes → customer notes); quick replies `@shortcut`; create orders from conversations (tab **"Đơn hàng từ chat"** (Orders from chat), Smart plan: **"Tạo đơn hàng từ hội thoại"** (Create orders from conversations)).
- Statistics mention **"Thẻ hội thoại"** (Conversation tags), **"Trạng thái"** (Status), **"Lọc theo sale"** (Filter by salesperson), **"Lọc theo trang"** (Filter by page) → conversations have tags, a status, an assigned salesperson, and a source page (inferred).

---

## 3. CRM / Customers / Tags module

### 3.1 Customer management — `/quan-ly/khach-hang`
- Heading **"Quản lý khách hàng"** (Customer management); view buttons: **"Trang chính"** (Main page), **"Tự động hoá"** (Automation), an icon button.
- Toolbar: textbox **"Tìm kiếm theo tên hoặc email"** (Search by name or email); **"Lọc"** (Filter); **"Sắp xếp"** (Sort); **"Ẩn/Hiện cột"** (Show/Hide columns) (eye icon); **"Đồng bộ"** (Sync); **"Thao tác"** (Actions) (bulk actions); link **"Cài đặt tag"** (Tag settings) → `/quan-ly/cai-dat-tag`; **"Tùy chỉnh bảng"** (Customize table).
- Tried: created customer `KH NGHIEN CUU 20261023` (no phone number, no email, with a note) → visible in the table after reload → phone number/email are **not required**.
- **Customer detail opens as a dialog** with tabs: **"Tổng quan"** (Overview) / **"Chi tiết"** (Details) / **"Lịch sử"** (History) / **"Files"** (Files → CRM storage in GB).
- Table columns were not listed in the snapshot.

### 3.2 Customer segments — `/quan-ly/tep-khach-hang`
- Heading **"Tệp khách hàng"** (Customer segments); button **"Tạo tệp mới"** (Create new segment); textbox **"Tìm kiếm theo tên tệp..."** (Search by segment name...).
- Table: **STT (No.) | Tên tệp (Segment name) | Số lượng khách hàng (Customer count) | Loại tệp (Segment type) | Ngày tạo (Created date) | Thao tác (Actions)** (rows are links → segment detail).
- By default there is 1 system segment: **"Tất cả khách hàng"** (All customers) · 0 · type **"Tệp CRM"** (CRM segment) · 23/10/2026 · menu **"Hành động cho Tất cả khách hàng"** (Actions for All customers).
- Segments are used as audiences for remarketing campaigns (inferred).

### 3.3 Tag settings — `/quan-ly/cai-dat-tag`
- Query modes: `?tagMode=list` (**"Cài đặt chung"** (General settings)), `?tagMode=tagQuick` (**"Cài đặt tag nhanh"** (Quick tag settings)), `?tagMode=create` (**"Tạo tag mới"** (Create new tag)).
- Filters: textbox **"Tìm kiếm tag theo tên..."** (Search tags by name...), type combobox (**"Tất cả loại"** (All types)), sort combobox (**"Mới nhất"** (Newest)).
- Table: **Tên tag (Tag name) | Màu sắc (Color) | Loại tag (Tag type) | Số trường thuộc tính (Number of attribute fields) | Người tạo (Created by) | Ghi chú (Note) | Thao tác (Actions)**.
- Default system tags:
| Name | Color | Type | Fields | Created by | Note |
|---|---|---|---|---|---|
| Ticket | #F59E0B | Thuộc tính (Attribute) | 7 | Hệ thống (System) | Ghi nhận & phân công vấn đề để xử lý nội bộ (Record & assign issues for internal handling) |
| Nhắc lịch (Reminder) | #3B82F6 | Công việc (Task) | 7 | Hệ thống (System) | Đặt nhắc công việc (call lại, follow-up, gửi hàng,...) (Set task reminders (call back, follow-up, ship goods,...)) |
| VIP | #8B5CF6 | Thuộc tính (Attribute) | 5 | Hệ thống (System) | Gắn nhãn khách có giá trị cao – ưu đãi cao (Label high-value customers – high incentives) |
| Event | #10B981 | Thuộc tính (Attribute) | 6 | Hệ thống (System) | Ghi lại khách tham gia sự kiện, ưu đãi liên quan (Record customers attending events, related offers) |
- → Tags are not just labels: each tag has a **schema of attribute fields** (custom fields attached when the tag is applied). Tag types: **"Thuộc tính"** (Attribute), **"Công việc"** (Task) (there may be other types). The "Công việc" (Task) tag (Nhắc lịch / Reminder) works together with Notification settings (remind 0 minutes/2 hours/24 hours before) (inferred).
- The workflow mentions **"tag đỏ"** (red tag), **"tag im lặng"** (silent tag) (see 5.4) → special tags/flags exist for conversations (possibly the "Tag nhanh" (Quick tags)) (inferred).

### 3.4 Customer sources — `/quan-ly/nguon-khach-hang` (under General Settings)
- Heading **"Tổng nguồn (7)"** (Total sources (7)); textbox **"Tìm kiếm"** (Search); button **"Tạo mới"** (Create new).
- Default sources: Instagram, Lazada, Hotline, Zalo, TikTok, Facebook, Website (each item has an icon + an action button).
- Classification: **"Nguồn mặc định"** (Default sources) vs **"Nguồn tạo mới"** (Newly created sources) (custom).
- Sources are used as **"Chọn nguồn"** (Select source) in Order Setup (default "Hotline") and as **"Nguồn đơn"** (Order source) when creating an order.

### 3.5 Sync — `/quan-ly/dong-bo`
- **"Đồng bộ dữ liệu — Quản lý và đồng bộ dữ liệu khách hàng từ các nền tảng khác nhau"** (Data sync — Manage and sync customer data from different platforms).
- Card **"Đồng bộ khách hàng — từ các cuộc hội thoại cũ trên các nền tảng social media"** (Sync customers — from old conversations on social media platforms) → button **"Đồng bộ khách hàng từ hội thoại cũ"** (Sync customers from old conversations) (backfill job).

### 3.6 CRM automation — `/quan-ly/tu-dong-hoa`
- **"Quản lý các quy tắc tự động hóa cho hệ thống"** (Manage the system's automation rules); textbox **"Tìm kiếm tự động hóa"** (Search automations). A fixed list of rules, each with 1 switch:
| Rule | Description | Default |
|---|---|---|
| Cập nhật KH khi SĐT được thay đổi (Update customer when phone number changes) | when the phone number in the conversation is updated | OFF |
| Cập nhật KH khi địa chỉ được thay đổi (Update customer when address changes) | when the address in the conversation is updated | OFF |
| Thêm ghi chú ở tin nhắn khách hàng (Add notes on customer messages) | notes on messages → the customer's note list (Customer detail) | **ON** |
| Tạo hồ sơ KH đầy đủ từ cuộc hội thoại (Create a full customer profile from the conversation) | create/update when **both** phone number and address are present | OFF |
| Tạo KH mới khi có SĐT (Create a new customer when a phone number is present) | create only, no update | OFF |
| Tạo KH mới khi có địa chỉ (Create a new customer when an address is present) | create only, no update | OFF |
| Tạo KH từ cuộc hội thoại mới (Create customer from a new conversation) | when a new conversation is created | OFF |
| Đồng bộ KH từ hội thoại khi có SĐT (Sync customer from conversation when a phone number is present) | create or update based on conversation data | OFF |
| Đồng bộ thông tin KH từ cuộc hội thoại (Sync customer information from the conversation) | create/update: name, phone number, address, gender, source, sales staff | **ON** |
- → Conversations have extracted fields: phone, address (AI extraction, inferred).

### 3.7 Customer statuses — `/quan-ly/trang-thai`
- Textbox **"Tìm kiếm trạng thái"** (Search statuses); button **"Tạo mới"** (Create new); an ordered list, each item has ~3 buttons (inferred: drag-reorder/edit/delete; the first button may be a drag handle).
- Defaults (in order): **New data, Cuộc gọi (Call), Đúng chăm sóc (Qualified for care), Tham khảo (Browsing), Chăm sóc zalo (Zalo nurturing), Trial, Chốt đơn (Order closed), Đóng (Closed)** (pipeline stages).
- Used in Statistics (**"Trạng thái"** (Status), **"Chưa có dữ liệu trạng thái"** (No status data yet)).

---

## 4. Orders / Products / Shipping module

### 4.1 Order overview — `/quan-ly/don-hang/thong-ke`
- **"Khoảng thời gian"** (Time range): preset **"Đầu tháng đến nay"** (Month to date); **"Cập nhật lúc 19:31:57"** (Updated at 19:31:57); icon button; **"Tải lại"** (Reload); **"Cấu hình"** (Configure).
- Block **"Tổng hàng chốt"** (Total closed goods): **"Tổng tiền"** (Total amount), **"Số lượng sản phẩm"** (Product quantity). **"Tổng hàng hoàn"** (Total returned goods): Total amount, Product quantity. **"Tổng cộng"** (Grand total): **"Doanh thu"** (Revenue), **"Đơn chốt"** (Closed orders).
- KPI cards (clickable to switch the chart): **"Doanh số"** (Sales), **"Doanh thu"** (Revenue), **"Lợi nhuận"** (Profit), **"Đơn chốt"** (Closed orders), **"GTTB/đơn"** (Average value/order), **"SL sản phẩm"** (Product quantity), **"SL SPTB/đơn"** (Average products/order) (0.0), **"LNTB/đơn"** (Average profit/order). Default chart: "Doanh số" (Sales).
- **"Thông tin kinh doanh hôm nay"** (Today's business information): **"Doanh thu hôm nay"** (Today's revenue), **"Đơn chốt hôm nay"** (Today's closed orders), **"Doanh thu theo giờ"** (Revenue by hour) (chart), **"Đơn tạo mới"** (New orders), **"Đơn huỷ"** (Cancelled orders), **"Đơn chốt"** (Closed orders), **"Đơn xoá"** (Deleted orders), **"Hàng bán ra"** (Goods sold), **"Khách hàng mới"** (New customers).
- → Products need a **cost price** to compute Profit (inferred); orders have returned/cancelled/deleted statuses.

### 4.2 Order list — `/quan-ly/don-hang`
- Link **"Thêm đơn hàng"** (Add order) → `/quan-ly/don-hang/tao-moi`.
- Search: **"Mã đơn / Mã vận chuyển / Tên / Địa chỉ / Số điện thoại / Ghi chú"** (Order code / Shipping code / Name / Address / Phone number / Note); **"Chọn khoảng ngày"** (Select date range); **"Bộ lọc"** (Filters); **"Sắp xếp"** (Sort).
- Status tabs (with counts): **"Tất cả"** (All), **"Mới"** (New), **"Chờ xác nhận"** (Awaiting confirmation), **"Đã đặt hàng"** (Ordered), **"Đã xác nhận"** (Confirmed), **"Đang đóng hàng"** (Packing), **"Chờ in"** (Awaiting print), **"Đã in"** (Printed), + an overflow combobox (shows **"Chờ chuyển hàng (0)"** (Awaiting shipment (0)); the remaining statuses are hidden in the dropdown).
- Table columns: [checkbox + menu] | **ID Đơn hàng (Order ID) | Mã vận đơn (Tracking code) | Khách hàng (Customer) | SĐT (Phone number) | Địa chỉ nhận hàng (Delivery address) | Ghi chú (Note) | ĐVVC (Shipping carrier) | Sản phẩm (Products) | Phí VC (Shipping fee) | Phí VC thu khách (Shipping fee charged to customer) | Tiền hàng (Goods amount) | Tổng số tiền (Total amount) | Tiền cần thu (Amount due) | Đã thanh toán (Paid) | Còn lại (Remaining) | Nhân viên tạo đơn (Created by staff) | Nguồn đơn (Order source) | Tạo lúc (Created at) | Trạng thái (Status)**.
- Empty: **"Chưa có đơn hàng nào phù hợp với bộ lọc."** (No orders match the filters.)
- Footer totals: **"SL sản phẩm"** (Product quantity), **"Phí VC thu khách"** (Shipping fee charged to customer), "COD", **"TỔNG TIỀN"** (TOTAL); page size `20`; pagination.

### 4.3 Create order — `/quan-ly/don-hang/tao-moi`
- Heading **"Tạo đơn hàng mới"** (Create new order); **multi-tab orders** (**"Đơn mới (F6)"** (New order (F6)), **"Thêm tab đơn hàng"** (Add order tab), **"Đóng"** (Close) tab); hotkeys **F6** (new order), **F2** (create order).
- **"Sản phẩm"** (Products): warehouse selection (default **"Kho mặc định"** (Default warehouse)); search **"Tìm kiếm sản phẩm bằng tên hoặc mã sản phẩm"** (Search products by name or product code); checkbox **"Còn hàng"** (In stock); empty **"Không có sản phẩm"** (No products).
- **"Thanh toán"** (Payment): checkboxes **"Miễn phí giao hàng"** (Free delivery), **"Chuyển khoản"** (Bank transfer); money inputs (with +/- buttons) **"Phí vận chuyển"** (Shipping fee), **"Giảm giá"** (Discount), **"Tiền chuyển khoản"** (Transferred amount), **"Phụ thu"** (Surcharge); totals: **"Tổng số tiền"** (Total amount), **"Giảm giá"** (Discount), **"Sau giảm giá"** (After discount), **"Tiền cần thu"** (Amount due), **"Đã thanh toán"** (Paid), **"Còn thiếu"** (Outstanding). (Discount has 2 buttons — possibly a đ/% toggle, inferred.)
- **"Ghi chú"** (Notes): **"Nội bộ"** (Internal), **"Để in"** (For printing) (2 textareas).
- **"Thông tin"** (Information): **"Tạo lúc"** (Created at) (datetime picker, defaults to now), **"Nguồn đơn"** (Order source) (select **"Chọn nguồn"** (Select source)).
- **"Khách hàng"** (Customer): **"Giới tính"** (Gender) (select), a button (inferred: search for an existing customer), **"Họ và tên"** (Full name), **"Số điện thoại"** (Phone number), Email, **"Ngày sinh"** (Date of birth).
- **"Nhận hàng"** (Delivery): select a saved address, **"Dự kiến nhận hàng"** (Expected delivery) (datetime), Full name, phone number, **"Địa chỉ"** (Address), **"Chọn địa chỉ"** (Select address) (picker Province/City → Commune/Ward — the 2-level administrative model after the merger).
- **"Vận chuyển"** (Shipping): select shipping carrier, **"Mã vận đơn"** (Tracking code), **"Phí"** (Fee); displays **"Tiền cần thu"** (Amount due), "COD".
- Checkbox **"Lưu mặc định sản phẩm"** (Save products as default); button **"Tạo đơn (F2)"** (Create order (F2)).
- Formulas (inferred): After discount = Goods amount − Discount; Amount due = After discount + Shipping fee charged to customer + Surcharge; Outstanding = Amount due − Paid (Transferred amount); COD = Outstanding.

### 4.4 Product management (sales catalog) — `/quan-ly/quan-ly-san-pham`
- Search **"Tìm kiếm sản phẩm bằng tên hoặc mã sản phẩm"** (Search products by name or product code) + search button; **"Cấu hình sản phẩm"** (Product configuration); **"Nhập sản phẩm"** (Import products); **"Thêm sản phẩm mới"** (Add new product).
- Table: [expand] | **STT (No.) | Mã sản phẩm (Product code) | Tên sản phẩm (Product name) | Ảnh (Image) | Số mẫu mã (Number of variants) | Đơn giá (Unit price)** → Products have **variants** ("Số mẫu mã").
- Empty: **"Không tìm thấy sản phẩm"** (No products found).

### 4.5 Setup (hub) — `/quan-ly/thiet-lap`
- **"Chọn nguồn:"** (Select source:) combobox (default **Hotline**) — order/shipping configuration is **per source**.
- **"Đơn hàng"** (Orders): **"Cài đặt đơn hàng"** (Order settings) `/quan-ly/thiet-lap/cai-dat-don-hang`; **"Tối ưu quảng cáo Facebook"** (Facebook ad optimization) `/quan-ly/thiet-lap/toi-uu-quang-cao`.
- **"Vận chuyển"** (Shipping): **"Kết nối ĐVVC"** (Connect shipping carrier) `/quan-ly/thiet-lap/don-vi-van-chuyen`; **"Cài đặt vận chuyển"** (Shipping settings) `/quan-ly/thiet-lap/cai-dat-van-chuyen`.
- **"Cửa hàng"** (Store): **"Kho hàng"** (Warehouse) `/quan-ly/thiet-lap/kho-hang`.
- Sub-pages have the breadcrumb **"Thiết lập / {nhóm} / {trang}"** (Setup / {group} / {page}) and the same **"Chọn nguồn"** (Select source) combobox.

### 4.6 Order settings — `/quan-ly/thiet-lap/cai-dat-don-hang` (`?tab=` …)
Tabs:
1. **"Trạng thái đơn hàng"** (Order statuses) (default): **"Trạng thái bổ sung"** (Additional statuses) (multi-select chips, currently selected **"Chờ in"** (Awaiting print), **"Đã in"** (Printed) — optional statuses that can be enabled); **"Trạng thái cần nhập ghi chú khi cập nhật"** (Statuses requiring a note when updated) (multi-select **"Chọn hành động trạng thái"** (Select status action)); **"Trạng thái đơn hàng cần xác nhận khi cập nhật"** (Order statuses requiring confirmation when updated) (multi-select). Button **"Cập nhật"** (Update).
2. **"Điều kiện tạo - xác nhận đơn hàng"** (Order creation - confirmation conditions) (`?tab=conditions`): **"Điều kiện tạo đơn"** (Order creation conditions) (button **"Chọn điều kiện tạo đơn"** (Select order creation conditions)), **"Điều kiện xác nhận đơn hàng"** (Order confirmation conditions) (**"Chọn điều kiện xác nhận đơn"** (Select order confirmation conditions)). **"Cập nhật"** (Update). (The list of conditions was not seen.)
3. **"Đồng bộ Google Sheet"** (Google Sheet sync) (`?tab=gsheet`): **"Đồng bộ đơn hàng lên Google Sheet: Tắt"** (Sync orders to Google Sheet: Off) + switch; description: if enabled, when an order is created the system automatically ticks **"Đồng bộ đơn hàng lên Google Sheet"** (Sync orders to Google Sheet) → the order is synced to the Sheet **using the shipping carrier's template** for bulk import into the shipping carrier. **"Chọn tài khoản Google"** (Select Google account) + **"Kết nối mới"** (New connection) (Google OAuth); **"Chọn đơn vị vận chuyển"** (Select shipping carrier) for the order source. **"Cập nhật"** (Update).
4. **"Đơn hàng từ chat"** (Orders from chat) (`?tab=chat-order`): only the **"Cập nhật"** (Update) button was visible (content did not render / could not be observed).

### 4.7 Facebook ad optimization — `/quan-ly/thiet-lap/toi-uu-quang-cao`
- With the Hotline source: message **"Tính năng tối ưu quảng cáo Facebook chỉ áp dụng cho nguồn đơn hàng đến từ trang Facebook. Vui lòng chọn nguồn là một trang Facebook để cấu hình."** (The Facebook ad optimization feature only applies to order sources coming from a Facebook page. Please select a Facebook page as the source to configure.) → a source can be a specific **Facebook page** (inferred: sends Purchase events via the Conversions API; the Instagram page also mentions "CAPI").

### 4.8 Connect shipping carrier — `/quan-ly/thiet-lap/don-vi-van-chuyen`
- **"Danh sách đơn vị vận chuyển — Kết nối ĐVVC để hệ thống có thể gửi đơn hàng sang đơn vị vận chuyển"** (Shipping carrier list — Connect a shipping carrier so the system can send orders to the shipping carrier); button **"Thêm kết nối"** (Add connection); empty **"Chưa có tài khoản kết nối"** (No connected accounts yet).
- List of supported carriers: **not observed** (dialog not opened).

### 4.9 Shipping settings — `/quan-ly/thiet-lap/cai-dat-van-chuyen`
- **"Khác"** (Other): switch **"Miễn phí VC khi đơn hàng đã chuyển khoản 100% số tiền cần thanh toán"** (Free shipping when the order has been 100% paid by bank transfer) (OFF).
- **"Trạng thái vận chuyển"** (Shipping statuses): **"Cấu hình trạng thái khoá gửi đơn sang ĐVVC"** (Configure the status that locks sending orders to the shipping carrier) (status select, with a tooltip button); **"Cấu hình trạng thái đơn hàng khi gửi đơn trực tiếp sang ĐVVC"** (Configure the order status when sending an order directly to the shipping carrier) (select).
- **"Nội thành/Ngoại thành"** (Inner city/Outer city): switch + number **"Số ngày dự kiến giao hàng trong nội thành"** (Expected delivery days within the inner city) (ON, 2); "…ngoại thành" (…outer city) (ON, 2); switch **"Tuỳ chỉnh xã/phường nội thành"** (Customize inner-city communes/wards) (OFF).
- Button **"Lưu"** (Save).

### 4.10 Warehouse — `/quan-ly/thiet-lap/kho-hang`
- Alert: **"Thiết lập các thông tin bên dưới để làm Thông tin gửi hàng khi Gửi đơn hàng sang đơn vị vận chuyển."** (Set up the information below to use as Sender information when sending orders to the shipping carrier.)
- **"Thông tin kho"** (Warehouse information): **"Tên kho *"** (Warehouse name *) (default **"Kho mặc định"** (Default warehouse)), **"Số điện thoại"** (Phone number), **"Địa chỉ"** (Address) (Province/City, Commune/Ward picker), **"Địa chỉ chi tiết"** (Detailed address). Button **"Cập nhật"** (Update).
- This screen shows only 1 warehouse; the order creation form has a warehouse select → possibly multi-warehouse (inferred).

---

## 5. Marketing / Remarketing / Workflow module

### 5.1 Zalo ZBS campaigns — `/quan-ly/chien-dich/zbs`
- Heading **"Chiến dịch"** (Campaigns); nav tabs: **Danh sách chiến dịch (Campaign list) | Thống kê (Statistics) | Template**.
- Search **"Tìm kiếm chiến dịch..."** (Search campaigns...); button **"Tạo chiến dịch mới"** (Create new campaign); filters **"Trạng thái"** (Status), **"Người tạo"** (Creator); date range.
- Table: **Tên chiến dịch (Campaign name) | Kênh gửi (Sending channel) | Trạng thái (Status) | Tổng người nhận (Total recipients) | Gửi thành công (Sent successfully) | Gửi thất bại (Failed) | Ngày tạo (Created date) | Ngày gửi (Sent date) | Người tạo (Creator) | (actions)**. Empty.
- Paid via the **ZBS credit wallet** (see 9).

### 5.2 Email campaigns — `/quan-ly/chien-dich/email`
- UI identical to ZBS (same component, different channel). Sent via the Gmail account connected under **"Kết nối nâng cao → Google (Email)"** (Advanced connections → Google (Email)) (inferred).

### 5.3 Facebook Marketing Messenger (FMM) — `/quan-ly/facebook-marketing-messenger`
- Heading **"Tin nhắn Marketing FMM"** (FMM Marketing Messages) + link **"Hướng dẫn"** (Guide) (YouTube `https://youtu.be/YoHyWBQxQ4M`).
- Card **"Kết nối tài khoản quảng cáo — Liên kết tài khoản quảng cáo và trang Facebook để gửi tin nhắn Marketing trả phí"** (Connect ad account — Link an ad account and Facebook page to send **paid** Marketing messages) + button **"Kết nối tài khoản quảng cáo"** (Connect ad account); loading **"Đang tải thông tin kết nối..."** (Loading connection information...).
- Tabs: **Chiến dịch (Campaigns) | Đối tượng (Audiences)**. Empty **"Chưa kết nối tài khoản"** (No account connected).

### 5.4 Automation Workflow — `/quan-ly/automation-workflow`
- Heading "Automation Workflow"; tabs **Workflow** | **Template Zalo** (Zalo Templates).
- Description: **"Tự động gửi chuỗi tin nhắn bám đuổi khách chưa mua và chăm sóc khách đã mua hàng."** (Automatically send follow-up message sequences to customers who have not purchased and nurture customers who have purchased.)
- Zalo Templates tab: shows **OA not connected**, leading to the Zalo integration.
- The list of workflow templates was not fully enumerated; at least "Soft Follow-up" exists.

### 5.5 Soft Follow-up (workflow form) — `/quan-ly/automation-workflow/soft-follow-up?industry=retail`
- Breadcrumb link "Automation Workflow".
- **"Ngành nghề"** (Industry): combobox (value **"Thương mại điện tử"** (E-commerce) ↔ query `industry=retail`) + a second combobox (inferred: sub-industry).
- **"Thông tin cơ bản"** (Basic information) (badge **"Mặc định"** (Default)): **"Tên workflow"** (Workflow name) ("Soft Follow-up"); **"Mô tả ngắn"** (Short description) ("Khi khách hàng để lại số điện thoại mà không mua hàng, hệ thống sẽ nhắn tin bám đuổi để kích thích khách hàng mua hàng." (When a customer leaves a phone number without purchasing, the system sends follow-up messages to encourage the customer to buy.)); **"Mục tiêu của Workflow"** (Workflow goal) ("Khách hàng có đơn hàng mới lần đầu tiên" (Customer places a first new order)).
- **"Điều kiện kích hoạt"** (Trigger condition): textbox **"Khi khách để lại SĐT mà chưa có đơn hàng"** (When a customer leaves a phone number but has no order yet) (fixed text per template).
- **"Hệ thống sẽ ngừng bám đuổi khi"** (The system will stop following up when): switches **"Khách bị gắn tag đỏ"** (Customer is tagged red) (ON), **"Khách bị gắn tag im lặng"** (Customer is tagged silent) (ON), **"Khách có 1 trong các tags"** (Customer has one of the tags) (multi-select **"Chọn tags..."** (Select tags...)).
- **"Tích hợp nền tảng"** (Platform integrations): Facebook / Instagram / TikTok / Zalo, each with a **"Kết nối"** (Connect) button (select the channels it applies to).
- Buttons: **"Hủy"** (Cancel), **"Xuất bản"** (Publish). No step for configuring the message sequence/delays was seen.

### 5.6 Facebook posts — `/quan-ly/post-facebook`
- **Blocked on the free plan** (no-permission message + **"Quay lại"** (Back)). Content unknown (inferred: post management for enabling comment auto-reply).

---

## 6. Integrations module

### 6.1 Platform integrations (workspace level) — `/quan-ly/tich-hop-nen-tang/{tab}`
- Header: **"Tích hợp nền tảng"** (Platform integrations); **"Chúng tôi nên tích hợp nền tảng nào tiếp theo?"** (Which platform should we integrate next?) → Google Form `https://forms.gle/GCEebvyfs67uoXfB8`.
- Tabs (routes): `tat-ca` (**"Tất cả"** (All)), `cho-kich-hoat` (**"Chờ kích hoạt"** (Pending activation)), `facebook`, `instagram`, `zalo`, `lazada`, `tiktok` (TikTok Business). **No Website at workspace level** (only at bot level).
- **"Tất cả"** (All): **"Danh sách trang"** (Page list); search **"Tìm theo tên hoặc ID page..."** (Search by name or page ID...); bulk buttons (disabled until a selection is made): **"Chỉnh sửa"** (Edit), **"Đồng bộ tin nhắn"** (Sync messages), **"Hủy kích hoạt"** (Deactivate); empty **"Chưa có nền tảng nào đã kích hoạt"** (No platforms activated yet).
- **"Chờ kích hoạt"** (Pending activation): **"Chọn trang để kích hoạt lại"** (Select pages to reactivate); search; **"Chỉnh sửa"** (Edit), **"Kích hoạt trang"** (Activate page) (disabled until selected); checkbox **"Chọn tất cả"** (Select all); each item: checkbox, page name, "ID: …", platform icon, **"Tích hợp ngày 23/10/2026"** (Integrated on 23/10/2026). → A page has been OAuth-authorized but is not active (status `pending/inactive`); the number of active pages is limited by the plan (Page: 1/3).
- **Facebook**: **"Kết nối Preny với Facebook — Sử dụng Preny để khóa mục tiêu mua hàng qua tin nhắn trên Ads Manager. Chatbot AI tự động nhắn tin, chốt đơn tăng tỷ lệ 50%"** (Connect Preny with Facebook — Use Preny to lock in the purchase-via-message objective in Ads Manager. The AI chatbot messages automatically, increasing order-closing rate by 50%) → **"Đăng nhập bằng Facebook"** (Log in with Facebook) (OAuth).
- **Instagram**: **"Kết nối với Preny Instagram — Tự động đồng bộ sự kiện mua hàng để tối ưu quảng cáo Instagram với CAPI"** (Connect with Preny Instagram — Automatically sync purchase events to optimize Instagram ads with CAPI) → **"Đăng nhập bằng instagram"** (Log in with Instagram).
- **Zalo**: **"Zalo OA yêu cầu bạn phải mua gói OA Tăng trưởng hoặc OA Toàn diện để có thể kết nối với Preny."** (Zalo OA requires you to purchase the **OA Tăng trưởng** (OA Growth) or **OA Toàn diện** (OA Comprehensive) package to connect with Preny.) → **"Đăng nhập bằng Zalo"** (Log in with Zalo).
- **Lazada**: **locked on the free plan** (**"Bạn cần nâng cấp gói để kết nối nền tảng này"** (You need to upgrade your plan to connect this platform) + **"Nâng cấp gói"** (Upgrade plan)).
- **TikTok**: **"Kết nối Preny với tài khoản TikTok Business — Quản lý tin nhắn, bình luận tài khoản TikTok Business… đối tác chính thức từ TikTok & Preny AI"** (Connect Preny with a TikTok Business account — Manage messages and comments of the TikTok Business account… official partner of TikTok & Preny AI) → **"Kết nối tài khoản TikTok Business"** (Connect TikTok Business account).

### 6.2 Bot-level integrations — `/quan-ly/bot/{botId}/tich-hop-nen-tang/{tab}`
- **"Kết nối Trang với Bot để tự động tư vấn và phản hồi khách hàng."** (Connect Pages to the Bot to automatically consult and respond to customers.)
- Tabs: `tat-ca`, `facebook`, `instagram`, `zalo`, `lazada`, `tiktok`, **`website`** (no "Chờ kích hoạt" (Pending activation)).
- **"Tất cả"** (All): **"Danh sách các trang đã kết nối với Bot"** (List of pages connected to the Bot); search; **"Chỉnh sửa"** (Edit), **"Hủy kích hoạt"** (Deactivate) (no **"Đồng bộ tin nhắn"** (Sync messages)); empty.
- Facebook/Instagram/Zalo/TikTok: the same copy as at workspace level **+ button "Chọn từ trang có sẵn"** (Choose from existing pages) (assign a page already connected at the workspace to the bot) + the OAuth button.
- **Lazada** & **Website (widget)**: **locked on the free plan** (**"Bạn cần nâng cấp gói…"** (You need to upgrade your plan…)). Widget details (embed script, colors…) not observed.
- Relationship: a Channel/Page belongs to the workspace; each Page is assigned to at most 1 bot (inferred).

### 6.3 Advanced connections — `/quan-ly/ket-noi-nang-cao/google` (under General Settings)
- Tabs: **Google (Email)** (active), **SMS (Coming soon)**, **ZNS (Coming soon)**.
- Empty: **"Chưa có tài khoản Gmail nào được kết nối — Hãy kết nối tài khoản Gmail để gửi email trực tiếp từ Preny AI"** (No Gmail account connected yet — Connect a Gmail account to send emails directly from Preny AI); button **"Kết nối Google"** (Connect Google).

### 6.4 Payments (payment gateway)
- ZBS credit top-up: **"Chuyển khoản ngân hàng"** (Bank transfer) (default) or **VNPAY** online. No payment-collection gateway for the shop's own orders was seen.

---

## 7. Statistics module

### 7.1 Conversation statistics — `/quan-ly/tong-quan`
- Date range (default "01/10/2026 - 23/10/2026" = start of month → today); comboboxes **"Lọc theo sale"** (Filter by salesperson), **"Lọc theo trang"** (Filter by page).
- Tabs/sections: **Trang (Page) | Tương tác (Interactions) | Thẻ (Tags) | Thẻ hiện tại (Current tags) | Trạng thái (Status)** ("Thẻ" and "Thẻ hiện tại" have secondary buttons).
- **"Thống kê về hoạt động"** (Activity statistics) — list: **"Tổng tương tác chuyển đổi"** (Total converted interactions), **"Khách hàng mới"** (New customers), **"Xin được số điện thoại"** (Phone numbers obtained).
- **"Tương tác hệ thống"** (System interactions): **"Tổng gắn/gỡ"** (Total applied/removed) (tags), **"Cuộc hội thoại"** (Conversations), **"Bình luận"** (Comments), **"Tin nhắn mới"** (New messages).
- **"Top thẻ hội thoại"** (Top conversation tags); **"Trạng thái"** (Status) (empty **"Chưa có dữ liệu trạng thái"** (No status data yet)).
- Order statistics: see 4.1; campaign statistics: tab in 5.1; affiliate statistics: 10.4.

---

## 8. Settings / Team / Permissions / Notifications / Profile module

### 8.1 Members — `/quan-ly/thanh-vien`
- Sub-nav **"Thành viên & Quyền truy cập"** (Members & Access): **"Thành viên"** (Members) | **"Quyền truy cập"** (Access).
- **"Danh sách thành viên"** (Member list); counter **"Thành viên 1/1"** (Members **1/1**) + progressbar; button **"Thêm thành viên"** (Add member).
- Table: **Tên (Name) | Vai trò (Role) | Số điện thoại (Phone number) | Email | Trạng thái (Status) | Thao tác (Actions)**. Owner row: role **"Chủ sở hữu"** (Owner), status **"Hoạt động"** (Active).

### 8.2 Access — `/quan-ly/quyen-truy-cap`
- **"Chọn role"** (Select role): combobox (currently "Sale"; other roles not listed; "Chủ sở hữu" (Owner) is known).
- Radio for **customer distribution mode (assignment)**: **"Tắt chế độ chia"** (Distribution off) (default) · **"Chia theo page"** (Distribute by page) · **"Chia theo tỉ lệ"** (Distribute by ratio) · **"Chia tỷ lệ theo ngày"** (Distribute by daily ratio).
- Table of the role's members: Tên (Name) | SĐT (Phone number) | Email; empty **"Không có thành viên nào"** (No members).
- **"Quyền quản lý khách hàng"** (Customer management permissions): **"Chưa có nhân viên Sale, vui lòng thêm mới nhân viên"** (No Sales staff yet, please add a staff member) + **"Thêm nhân viên"** (Add staff).
- The detailed permission matrix was not seen.

### 8.3 General settings (sub-nav) — shared by: **"Cài đặt thông báo"** (Notification settings) `/quan-ly/cai-dat-thong-bao`, **"Nguồn khách hàng"** (Customer sources) `/quan-ly/nguon-khach-hang`, **"Đồng bộ"** (Sync) `/quan-ly/dong-bo`, **"Tự động hóa"** (Automation) `/quan-ly/tu-dong-hoa`, **"Trạng thái"** (Statuses) `/quan-ly/trang-thai`, **"Kết nối nâng cao"** (Advanced connections) `/quan-ly/ket-noi-nang-cao/google`, **"Thông tin workspace"** (Workspace information) `/quan-ly/thong-tin-workspace`.

### 8.4 Notification settings — `/quan-ly/cai-dat-thong-bao`
- **"Nhận thông báo: Bật"** (Receive notifications: On) — **"Bạn sẽ được nhắc ngay khi có sự kiện mới"** (You will be reminded as soon as there is a new event) — switch (ON).
- **"Cài đặt thời gian thông báo — Cho phép thiết lập tối đa 5 mốc thời gian để hệ thống gửi thông báo trước sự kiện"** (Notification timing settings — Allows setting **up to 5 time offsets** for the system to send notifications before an event); button **"Tạo mới"** (Create new); default offsets: **0 phút (0 minutes), 2 giờ (2 hours), 24 giờ (24 hours)** (each offset has a delete button).

### 8.5 Workspace information — `/quan-ly/thong-tin-workspace`
- Logo image (720x720, ≤1MB) + **"Thay đổi"** (Change).
- **"Tên"** (Name) (default "`{tên chủ}`-workspace" (`{owner name}`-workspace)), **"Tên công ty"** (Company name), **"Dịch vụ kinh doanh"** (Business services), **"Mô tả sản phẩm"** (Product description) (textarea). Button **"Lưu thông tin"** (Save information).
- (The product/service description may be fed into the bot's context — inferred.)

### 8.6 Personal profile — `/quan-ly/thong-tin-ca-nhan`
- **"Hình đại diện"** (Avatar) (720x720, ≤1MB); **"Lưu thay đổi"** (Save changes) (disabled until something changes).
- Details: **"Tên"** (Name) (**"Chỉnh sửa"** (Edit)), **"ID người dùng"** (User ID), **"Trạng thái"** (Status) (**"Đang hoạt động"** (Active)), **"Mật khẩu"** (Password) `*********` (Edit), E-mail, **"Số điện thoại"** (Phone number) + badge **"Chưa xác thực"** (Unverified) (button → OTP verification, inferred) + Edit.
- **"Thiết lập múi giờ"** (Time zone setting): combobox "GMT+07:00 - Vietnam".
- Accordion **"Thông tin công ty (Nếu bạn muốn xuất hóa đơn tài chính)"** (Company information (if you want a financial invoice issued)) (VAT invoice info).

### 8.7 Security settings — `/quan-ly/cai-dat-bao-mat`
- **"Xác thực 2 yếu tố chưa được bật"** (Two-factor authentication is not enabled) + description; button **"Bật xác thực 2 yếu tố"** (Enable two-factor authentication) (method unclear).

### 8.8 Support tickets — `/quan-ly/ticket-ho-tro`
- **"Hỗ trợ yêu cầu ticket"** (Support ticket requests); button **"Tạo yêu cầu mới"** (Create new request).
- Copy: tickets are handled **within 10 minutes to 2 hours** depending on complexity.
- Empty: **"Không có dữ liệu. Hãy + Thêm yêu cầu của bạn, chúng tôi sẽ hỗ trợ"** (No data. + Add your request and we will help). The ticket form was not observed.

---

## 9. Billing / Credits / Top-up / Plans module

### 9.1 Usage limits — `/quan-ly/han-muc-su-dung`
Each card: name, **"Gói chính"** (Main plan), **"Đã sử dụng"** (Used), **"Giới hạn"** (Limit) (free-plan values):
| Limit | Used | Limit (free) |
|---|---|---|
| Tài liệu (Documents) | 14 documents | 500 |
| Thành viên (Members) | 1 | 1 |
| Tin nhắn (Messages) | 0 | 1,000 messages — **"Ngày reset gói chính: 6/11/2026"** (Main plan reset date: 6/11/2026) |
| Page | 1 | 3 |
| Hình ảnh AI (AI images) | 0 | 10 |
| Khách hàng CRM (CRM customers) | 1 | 5,000 |
| Dung lượng CRM (CRM storage) | 0 GB | 0 GB |
- **"Gói chính"** (Main plan) implies there may be secondary plans/add-ons that add to the limits (inferred, consistent with **"Mua thêm gói dịch vụ"** (Buy additional service packs)).
- Messages reset on a monthly cycle counted from the sign-up date (6/11 — inferred: signed up on the 6th).

### 9.2 Upgrade — `/quan-ly/nang-cap`
- Header **"Nâng cấp gói và mua thêm dữ liệu"** (Upgrade plan and buy more data); **"Nâng cấp dịch vụ"** (Upgrade service).
- 3 plans (price/month, billing cycle chosen via combobox, default **12 months**), button **"NÂNG CẤP"** (UPGRADE); each plan has a tooltip describing the bot model. See the detailed table in section 14.
- **"Mua thêm gói dịch vụ — Tăng giới hạn sử dụng linh hoạt…"** (Buy additional service packs — Flexibly increase usage limits…) + button **"Mua thêm"** (Buy more).
- **"Mua thêm tin nhắn"** (Buy more messages) — alert **"Đã chuyển qua ví Credit"** (Moved to the Credit wallet) (buying individual messages has been replaced by the credit wallet).

### 9.3 Billing & Plans (sub-nav) — **"Quản lý số dư credit và lịch sử giao dịch"** (Manage credit balance and transaction history)
Items: **"Lịch sử mua gói"** (Plan purchase history) `/quan-ly/lich-su-giao-dich` · **"Ví credit tin nhắn AI"** (AI message credit wallet) `/quan-ly/vi-tin-nhan` · **"Ví credit ZBS"** (ZBS credit wallet) `/quan-ly/vi-credit` · **"Nhập mã Voucher"** (Enter voucher code) `/quan-ly/doi-voucher`.

### 9.4 Plan purchase history — `/quan-ly/lich-su-giao-dich`
- Table: **Ngày tạo (Created date) | Số hóa đơn (Invoice number) | Tên gói (Plan name) | Số lượng (Quantity) | Thời gian đăng ký (Subscription period) | Phương thức thanh toán (Payment method) | Giá tiền (Price) | Hóa đơn (Invoice) | Trạng thái duyệt (Approval status) | Trạng thái thanh toán (Payment status)**. Empty **"Không có dữ liệu lịch sử giao dịch"** (No transaction history data).
- → Plan purchases go through **manual approval** (Approval status), separate from the payment status (bank transfer → admin approval, inferred); an invoice file is available.

### 9.5 AI message credit wallet — `/quan-ly/vi-tin-nhan`
- Sub-tabs: **"Ví credit tin nhắn AI"** (AI message credit wallet) · **"Lịch sử nạp tiền"** (Top-up history) `/quan-ly/vi-tin-nhan/lich-su-nap-tien` · **"Lịch sử sử dụng"** (Usage history) `/quan-ly/vi-tin-nhan/lich-su-su-dung`.
- Wallet card: logo, **"Đang hoạt động"** (Active), **"0 credits"**; **"Ví Credit Tin nhắn AI dùng để thanh toán chi phí cho các hoạt động tư vấn và phản hồi của Chatbot AI."** (The AI Message Credit Wallet is used to pay for the AI Chatbot's consultation and response activities.)
- **"Nạp Credit"** (Top up credit): input **"Số credit cần nạp"** (Credits to top up) + radio presets **100 / 200 / 500 / 1,000 / 2,000 / 5,000**; **"Lượng credit đã mua được sử dụng cho tới khi hết, không giới hạn thời gian."** (Purchased credits can be used until depleted, **with no time limit**.); button **"Nạp Credit"** (Top up credit). (No payment method selection in the AI wallet, unlike the ZBS wallet.)
- Table **"Định mức tiêu hao Credit"** (Credit consumption rates): **Model Bot (Bot model) | Đơn giá (đ) (Unit price (VND)) | Credit/tin (Credits/message)** — see section 14.
- Note: **"Số lượng credit sẽ được trừ tự động dựa vào cấu hình phiên bản bot tương ứng trong mỗi tin nhắn phản hồi."** (Credits are deducted automatically based on the corresponding bot version configuration for each reply message.)

### 9.6 Top-up history (AI) — `/quan-ly/vi-tin-nhan/lich-su-nap-tien`
- Filter **"Thời gian"** (Time) (date range).
- Table: **Thời gian tạo (Created at) | Số hóa đơn (Invoice number) | Loại giao dịch (Transaction type) | Số credit nạp (Credits topped up) | Tiền mua credit (Credit purchase amount) | VAT (10%) | Số tiền thanh toán (Amount paid) | Phương thức thanh toán (Payment method) | Trạng thái thanh toán (Payment status) | Trạng thái hệ thống (System status)**. Note **"Số tiền thanh toán đã bao gồm thuế VAT 10%"** (Amount paid includes 10% VAT).

### 9.7 Usage history (AI) — `/quan-ly/vi-tin-nhan/lich-su-su-dung`
- Filter **"Thời gian"** (Time); **"Nhóm theo"** (Group by) combobox (default **"Ngày"** (Day); inferred: Week/Month).
- Table (aggregated): **Kỳ (Period) | Loại bot (Bot type) | Số tin (Message count) | Đơn giá TB / tin (Average unit price / message) | Tổng credit trừ (Total credits deducted)**.

### 9.8 ZBS credit wallet — `/quan-ly/vi-credit`
- Sub-tabs: **"Ví credit ZBS"** (ZBS credit wallet) · **"Lịch sử nạp tiền"** (Top-up history) `/quan-ly/vi-credit/lich-su-nap-tien` · **"Lịch sử sử dụng"** (Usage history) `/quan-ly/vi-credit/lich-su-su-dung`.
- Card: **"Đang hoạt động"** (Active), "0 credits", **"Cập nhật lúc: 23/10/2026 - 19:36"** (Updated at: 23/10/2026 - 19:36); **"Giao dịch gần đây"** (Recent transactions) (empty **"Không có giao dịch gần đây"** (No recent transactions)).
- Top-up: input + presets 100…5,000; **"Phương thức thanh toán"** (Payment method): radio **"Thanh toán chuyển khoản ngân hàng"** (Bank transfer payment) (default) / **"Thanh toán trực tuyến VNPAY"** (VNPAY online payment).
- **"Chi tiết thanh toán"** (Payment details): **"Tiền mua credit"** (Credit purchase amount), **"Thuế VAT (10%)"** (VAT (10%)), **"Tổng thanh toán"** (Total payment); **"Giá đã bao gồm thuế VAT 10%."** (Price includes 10% VAT.) (contradictory copy: VAT is shown added separately yet it says "already included"). Button **"Nạp Credit"** (Top up credit).
- ZBS credit → VND exchange rate: **not seen** (everything shows 0đ).

### 9.9 ZBS top-up history — `/quan-ly/vi-credit/lich-su-nap-tien`
- Filters: **"Ngày bắt đầu"** (Start date), **"Ngày kết thúc"** (End date), **"Trạng thái thanh toán"** (Payment status).
- Table: Thời gian tạo (Created at) | Số hóa đơn (Invoice number) | Loại giao dịch (Transaction type) | Số credit nạp (Credits topped up) | Tiền mua credit (Credit purchase amount) | VAT (10%) | Số tiền thanh toán (Amount paid) | Phương thức thanh toán (Payment method) | Trạng thái thanh toán (Payment status).

### 9.10 ZBS usage history — `/quan-ly/vi-credit/lich-su-su-dung`
- Filters as in 9.9. Table: Thời gian tạo (Created at) | Số hóa đơn (Invoice number) | Loại giao dịch (Transaction type) | Số credit nạp (Credits topped up) | Tiền mua credit (Credit purchase amount) | VAT (10%) | Số tiền thanh toán (Amount paid) | **Tính năng (Feature)** | Trạng thái thanh toán (Payment status) (same ledger schema as top-ups, plus a Feature column).

### 9.11 Voucher — `/quan-ly/doi-voucher`
- **"Nhập mã ưu đãi"** (Enter promo code): textbox **"Nhập mã voucher"** (Enter voucher code) + **"Áp dụng"** (Apply) (disabled when empty).
- **"Lịch sử sử dụng"** (Usage history): empty **"Chưa có lịch sử đổi voucher"** (No voucher redemption history yet).

---

## 10. Affiliate module (`/quan-ly/affiliate/*`)
Status: "terms not accepted" — there is a `button [expanded] "Show Dialog"` on every page (inferred: the affiliate terms dialog is open/blocking).
Sub-nav: **"Tổng quan"** (Overview) `/quan-ly/affiliate` · **"Khách hàng"** (Customers) `/khach-hang` · **"Quản lý link"** (Link management) `/quan-ly-link` · **"Thống kê"** (Statistics) `/thong-ke` · **"Giao dịch khách hàng"** (Customer transactions) `/danh-sach-giao-dich` · **"Lịch sử rút/nhận tiền"** (Withdrawal/receipt history) `/lich-su-giao-dich` · **"Thông tin ngân hàng"** (Bank information) `/thong-tin-ngan-hang` (the last 3 pages were not observed).

### 10.1 Overview
- 2 referral link cards (auto-generated referral code): **"20% / đơn hàng"** (20% / order) and **"300.000 VNĐ / đơn hàng"** (300,000 VND / order); each card: **"Chia sẻ"** (Share) (Facebook sharer `https://www.facebook.com/sharer/sharer.php?u=https://preny.ai/affiliates?referralCode={code}`), "Copy Link".
- **"Tổng quan thu nhập"** (Income overview): **"Số tiền trong ví"** (Wallet balance) (0 VND) + **"Rút tiền"** (Withdraw); **"Tổng doanh thu"** (Total revenue).
- **"Biểu đồ báo cáo"** (Report charts): **"Báo cáo doanh thu (Từ … -> đến …)"** (Revenue report (From … -> to …)) combobox **"30 ngày"** (30 days), line chart; **"Số lượng đăng ký tài khoản"** (Number of account sign-ups) combobox 30 days, chart **"Số lượng"** (Quantity).
### 10.2 Customers
- Filters: **"Tìm theo tên / Email"** (Search by name / Email), **"Lọc theo ngày hết hạn gói"** (Filter by plan expiry date) (range), **"Trạng thái"** (Status), **"Link affiliate"** (Affiliate link).
- Table: **STT (No.) | Tên khách hàng (Customer name) | Email | Ngày đăng ký (Sign-up date) | Trạng thái (Status) | Tổng đơn hàng (Total orders) | Giá trị đơn hàng thành công (Successful order value) | Tổng doanh thu hoa hồng nhận được (Total commission earned) | Ngày hết hạn gói (Plan expiry date) | Ngày thanh toán cuối cùng (Last payment date) | (actions)**. Empty **"Chưa có dữ liệu khách hàng / Hãy kiểm tra lại bộ lọc…"** (No customer data yet / Please check the filters…).
### 10.3 Link management
- **"Thống kê chi tiết danh sách link Affiliate"** (Detailed statistics of Affiliate links); button **"Tạo link"** (Create link); alert **"Bạn chỉ có thể tạo tối đa 5 link affiliate."** (You can only create up to 5 affiliate links.)
- Table: **Link | Loại hình affiliate (Affiliate type) | Ngày tạo (Created date) | Trạng thái (Status) | (actions)**. 2 default links (20% & 300,000 VND), created 23/10/2026 12:27, **"Hoạt động"** (Active).
### 10.4 Statistics
- **"Thống kê tương tác link Affiliate"** (Affiliate link interaction statistics): **"Từ ngày"** (From date) / **"Đến ngày"** (To date) (disabled textbox → opens a picker), **"Xóa"** (Clear), **"Áp dụng"** (Apply).
- Table: **Link | Số lần click chuột (Clicks) | Số lượt đăng ký tài khoản (Account sign-ups) | Mua gói (Plan purchases)**.

---

## 11. Tools
- Tool Ads Facebook (1.11) — message JSON generator for Ads Manager.
- Test chat (1.10).
- Export Excel (instructions, FAQ), import FAQ file, import products.

## 12. Admin / other
- No internal admin page was observed. Signs of a back office: **"Trạng thái duyệt"** (Approval status) (plan purchases), **"Trạng thái hệ thống"** (System status) (AI credit top-ups), support tickets, **"Team kịch bản Preny hỗ trợ"** (Preny scenario team support) (Neo plan).
- Integration feedback form (Google Form), YouTube tutorial videos, guide page `preny.ai/huong-dan`.

---

## 13. Inferred data entities (data model)

> Everything here is inferred from the UI; field names are proposed (English), with the UI source in parentheses.

**User** — id ("ID người dùng" (User ID)), name, email, phone, phoneVerified ("Chưa xác thực" (Unverified)), passwordHash, avatarUrl, status ("Đang hoạt động" (Active)), timezone ("GMT+07:00"), twoFactorEnabled, companyInvoiceInfo {companyName, taxCode?, address?} (invoice accordion — sub-fields not seen), language.

**Workspace** — id, name ("{user}-workspace"), logoUrl, companyName, businessService, productDescription, ownerUserId, planId, planCycleStart/resetDate ("Ngày reset gói chính" (Main plan reset date)), notificationEnabled, notificationOffsets[] (≤5; default [0m, 2h, 24h]), assignmentMode (off | by_page | by_ratio | by_ratio_daily), referralCode.

**Member** — workspaceId, userId, role (owner "Chủ sở hữu" (Owner) | sale | …), status ("Hoạt động" (Active)), phone, email; page/ratio assignment relationship (for the distribution mode).

**Role/Permission** — name ("Sale", "Chủ sở hữu" (Owner)…), permissions (not seen), memberIds, "Quyền quản lý khách hàng" (Customer management permissions).

**Plan** — code (free | sales_smart | sales_pro | sales_neo), legacyName (Cơ Bản (Basic) / Nâng Cao (Advanced) / Doanh Nghiệp (Enterprise)), listPrice, discountPct, pricePerMonth by cycle, botModels[], limits {documents, members, messagesPerMonth, pages/channels, aiImages, crmCustomers, crmStorageGB, trainingMedia}, feature flags (lazada, website widget, post-facebook, …).

**Subscription/PlanOrder** ("Lịch sử mua gói" (Plan purchase history)) — createdAt, invoiceNo, planName, quantity, cycle ("Thời gian đăng ký" (Subscription period)), paymentMethod, amount, invoiceFileUrl, approvalStatus, paymentStatus.

**UsageCounter** — workspaceId, metric, used, limit, source ("Gói chính" (Main plan) / add-on), resetAt.

**Wallet** — workspaceId, type (AI_MESSAGE | ZBS), balanceCredits (decimal: 0.06 …), status ("Đang hoạt động" (Active)), updatedAt.

**WalletTopup** — walletId, createdAt, invoiceNo, txType ("Loại giao dịch" (Transaction type)), credits, amountBeforeVat, vat10, totalPaid, paymentMethod (bank_transfer | vnpay), paymentStatus, systemStatus (AI wallet).

**CreditUsage** — walletId, messageId?, botModel, credits, unitPrice, createdAt, feature (ZBS "Tính năng" (Feature)); reports grouped by period (day/…).

**Voucher / VoucherRedemption** — code, redeemedAt, effect (unclear).

**Bot** — id (ObjectId), workspaceId, name, industry ("Thương mại điện tử" (E-commerce)/retail), active (switch), modelTier (V1/2/3 | Smart | Pro | Neo — tied to the plan), mission ("Nhiệm vụ chính" (Main mission)), greetingMessages[], reactionReplies[], settings {replyFirstMessage, autoReplyComments, commentToMessenger, replySpeed, creativity, classifyInstructions(≤2000), fallbackEnabled, fallbackMessage(≤1000), selfPronoun, customerPronoun, useCustomerName, smartPronounFb, pronounsByGender{male, female, other}, imageSendMode ("Bộ sưu tập" (Collection), album ≤30 images), imageUnderstanding, stopAfterContactCollected, silenceOnExternalMessage(5 minutes), autoReenableAfterManual(5 minutes), followUp24h, followUpOnPhone}, onboardingProgress (x/4).

**BotInstruction ("Hướng dẫn"/kịch bản (Instructions/scenarios))** — botId, situation (title), content/handling (inferred), order, createdAt. Seeded by industry.

**FAQ / KnowledgeItem** — botId, question, answer, source (manual | import), createdAt. 6 seeded by industry. Counts toward "Tài liệu" (Documents) (inferred).

**BotProduct** — botId, code, name, priceText (string), description?, images?, perProductInstructions.

**MediaFolder (album) / MediaAsset** — botId, folderName, assets[] {type image|video, url, size}; quota "Hình ảnh x/10" (Images x/10).

**QuickReply** — botId (route belongs to the bot), shortcut (`@…`), content, images[], updatedAt.

**BotChangeLog** — botId, actor, category ("Cài đặt" (Settings)…), diff, createdAt.

**Channel/Page (Integration)** — workspaceId, platform (facebook | instagram | zalo_oa | lazada | tiktok_business | website), externalId ("ID page"), name, accessToken, status (active | pending "Chờ kích hoạt" (Pending activation) | deactivated), integratedAt, botId (nullable), messageSyncStatus.

**AdvancedConnection** — workspaceId, type (google_gmail | sms | zns), account email, tokens; also used for the order Google Sheet.

**AdAccountConnection (FMM)** — workspaceId, adAccountId, pageId; FMM Audience, FMM Campaign.

**Conversation** — workspaceId, channelId/pageId, customerId/contact, platform, autoReplyEnabled (ON/OFF toggle; auto re-enabled after 5 minutes), assignedSaleId, tags[] (conversation tags), statusId, extracted {phone, address, gender, name}, notes[], lastMessageAt, isNew.

**Message** — conversationId, direction (in/out), senderType (customer | bot | agent | external platform), type (text | image | reaction | comment | product card | album), content, note?, botModel?, creditsCharged?, createdAt.

**Comment** (post comments) — postId, pageId, autoReplied, dmSent (inferred from the bot settings + the "Bình luận" (Comments) statistic).

**Customer (CRM)** — workspaceId, name, phone?, email?, gender, birthday, addresses[], sourceId ("Nguồn" (Source)), saleId ("nhân viên sales" (sales staff)), statusId, tags[] (+ tag attribute values), notes[], files[] (CRM storage), history/timeline, createdAt. Dialog: Tổng quan (Overview) / Chi tiết (Details) / Lịch sử (History) / Files.

**CustomerSegment ("Tệp khách hàng" (Customer segment))** — name, type ("Tệp CRM" (CRM segment)…), customerCount, createdAt; system segment "Tất cả khách hàng" (All customers).

**Tag** — name, color (hex), type ("Thuộc tính" (Attribute) | "Công việc" (Task) | …), fields[] (attribute schema, e.g. 5–7 fields), createdBy ("Hệ thống" (System)/user), note, isQuickTag ("Cài đặt tag nhanh" (Quick tag settings)).

**CustomerStatus** — name, order, (color?) — 8 seeded statuses.

**CustomerSource** — name, icon, isDefault (7 defaults), custom.

**AutomationRule (CRM)** — key, enabled (9 fixed rules).

**Order** — id ("ID Đơn hàng" (Order ID)), workspaceId, sourceId ("Nguồn đơn" (Order source) / page), warehouseId, customer {gender, name, phone, email, birthday}, shipping {name, phone, address, province, ward, expectedDeliveryAt}, items[] {productId, variantId, qty, price}, carrierId ("ĐVVC" (Shipping carrier)), trackingCode ("Mã vận đơn" (Tracking code)), shippingFee ("Phí VC" (Shipping fee)), shippingFeeCharged ("Phí VC thu khách" (Shipping fee charged to customer)), freeShipping, discount, surcharge ("Phụ thu" (Surcharge)), transferAmount ("Tiền chuyển khoản" (Transferred amount)), isTransfer, subtotal ("Tiền hàng" (Goods amount)), total, amountDue ("Tiền cần thu" (Amount due)), paid, remaining, cod, noteInternal, notePrint, createdBy ("Nhân viên tạo đơn" (Created by staff)), createdAt ("Tạo lúc" (Created at), editable), status, syncToGoogleSheet, conversationId? (order from chat).
- Status enum (observed): Mới (New), Chờ xác nhận (Awaiting confirmation), Đã đặt hàng (Ordered), Đã xác nhận (Confirmed), Đang đóng hàng (Packing), Chờ in (Awaiting print), Đã in (Printed), Chờ chuyển hàng (Awaiting shipment), … (+ cancelled, returned, deleted, closed, inferred from statistics). "Chờ in/Đã in" (Awaiting print/Printed) are optional statuses that can be toggled on/off.

**OrderSettings (per source)** — extraStatuses[], statusesRequireNote[], statusesRequireConfirm[], createConditions[], confirmConditions[], gsheet {enabled, googleAccountId, carrierId}, chatOrder {…}, fbAdsOptimization {…}.

**ShippingSettings (per source)** — freeShipIfFullyTransferred, lockSendStatus, statusOnDirectSend, innerCityDays (2, enabled), outerCityDays (2, enabled), customInnerWards (enabled + list).

**CarrierConnection** — carrier, credentials, (per source?) — list of carriers not seen.

**Warehouse** — name ("Kho mặc định" (Default warehouse)), phone, province/ward, addressDetail.

**Product (sales catalog)** — code, name, images, variants[] ("Số mẫu mã" (Number of variants)), unitPrice, costPrice? (for profit calculation, inferred), stock per warehouse ("Còn hàng" (In stock)).

**Campaign (ZBS / Email)** — name, channel ("Kênh gửi" (Sending channel)), status, recipientsTotal, sentSuccess, sentFailed, createdAt, sentAt, createdBy, templateId, segmentId (inferred). **Template** (Template tab; Zalo templates in Workflow).

**Workflow** — templateKey ("soft-follow-up"), industry, name, description, goal, triggerText, stopConditions {redTag, silentTag, anyOfTags[]}, channels[] (fb/ig/tiktok/zalo), status (draft | published), steps (not seen).

**SupportTicket** — subject/content (form not seen), status, createdAt.

**Affiliate** — userId, referralCode, walletBalance, totalRevenue, bankInfo; **AffiliateLink** (≤5) {url, commissionType (percent 20% | fixed 300,000 VND per order), createdAt, status}; **AffiliateReferral** {customer name, email, registeredAt, status, totalOrders, successfulOrderValue, commissionEarned, planExpiresAt, lastPaymentAt, linkId}; **AffiliateClickStats** {linkId, clicks, signups, purchases}; **AffiliatePayout** (withdrawals/receipts).

**Notification** — events + advance reminders by offsets (tag "Nhắc lịch" (Reminder)).

Main relationships: User 1–n Member n–1 Workspace; Workspace 1–n Bot, Channel, Customer, Order, Tag, Status, Source, Campaign, Workflow, Wallet(2); Bot 1–n Instruction, FAQ, BotProduct, MediaFolder, QuickReply, ChangeLog; Channel n–1 Bot; Conversation n–1 Channel, n–1 Customer, n–1 Member(sale); Order n–1 Customer, n–1 Source, n–1 Warehouse, n–1 Carrier, 0..1 Conversation; Customer n–n Tag (with attribute values), n–n Segment.

---

## 14. Observed pricing / credit / limit rules

### 14.1 Plans (Upgrade page, prices shown for the 12-month cycle)
| Plan (legacy name) | List price/month | Discount | Price/month | Savings (12 months) | Bot model | Channels / Staff | Bonus messages | Training | Mini CRM | Support |
|---|---|---|---|---|---|---|---|---|---|---|
| **Sales Smart** (Cơ Bản / Basic) | 1,310,000 VND | -40% | **785,000 VND** | 6,300,000 VND | Smart — "Trả lời nhanh, xử lý thông tin cơ bản" (Fast replies, handles basic information) | 5 channels, 5 staff | 7,000 AI messages/month | Unlimited files; 200 images/videos | 20,000 customers, 10GB | Email |
| **Sales Pro** (Nâng Cao / Advanced) | 1,624,000 VND | -40% | **974,000 VND** | 7,800,000 VND | Pro, Pro special — "Thông minh, tư vấn chính xác, tính toán giỏi" (Smart, accurate consultation, good at calculations) | 20 channels, 15 staff | 7,000 AI messages/month | Unlimited files; 200 images/videos | 50,000 customers, 30GB | Chat channel |
| **Sales Neo** (Doanh Nghiệp / Enterprise) | 2,499,000 VND | -35% | **1,624,000 VND** | 10,500,000 VND | Neo, Neo special — "Thông minh, tư vấn nhanh và chính xác, xử lý tình huống khó và chốt đơn hiệu quả" (Smart, fast and accurate consultation, handles difficult situations and closes orders effectively) | 100 channels, 30 staff | 7,000 AI messages/month | 600 images/videos; **"Team kịch bản Preny hỗ trợ"** (Preny scenario team support) | Unlimited customers, 100GB | Dedicated 1-on-1 |
- Common Smart features (inherited by Pro/Neo): **"Tích hợp đa nền tảng"** (Multi-platform integration); **"Chat đa kênh miễn phí"** (Free omnichannel chat); **"AI bình luận, trả lời tin nhắn khách từ comment"** (AI commenting, replying to customer messages from comments); Mini CRM; **"Gửi Email / Facebook Messenger Marketing / ZBS"** (Send Email / Facebook Messenger Marketing / ZBS); **"Tạo đơn từ hội thoại"** (Create orders from conversations) + shipping carrier connection.
- Number check: (1,310,000 − 785,000) × 12 = 6,300,000 ✓; (1,624,000 − 974,000) × 12 = 7,800,000 ✓; (2,499,000 − 1,624,000) × 12 = 10,500,000 ✓. The displayed discount % is rounded (785/1310 ≈ -40.1%).
- Prices for cycles other than 12 months: **not seen** (the combobox has multiple cycles).
- **Free** plan (from Usage Limits): 500 documents, 1 member, 1,000 messages/month, 3 pages, 10 AI images (image library 0/10), 5,000 CRM customers, 0 GB CRM. Free-plan bot model: not stated (inferred V1/2/3). Locked: Lazada, Website widget, Facebook Posts.

### 14.2 AI message credits
| Bot model | Unit price | Credits/message |
|---|---|---|
| Bot V1/2/3 | 60 VND | 0.06 |
| Bot Smart | 110 VND | 0.11 |
| Bot Pro | 150 VND | 0.15 |
| Bot Neo | 195 VND | 0.195 |
- ⇒ **1 credit = 1,000 VND** (derived from the table). Deducted automatically **per bot reply message** according to the configured bot version.
- Purchased credits **do not expire**. Top-up presets: 100/200/500/1,000/2,000/5,000 credits (or free-form input).
- Relationship between the plan's "Tin nhắn" (Messages) quota (1,000 free / 7,000 bonus) and the credit wallet: alert **"Mua thêm tin nhắn — Đã chuyển qua ví Credit"** (Buy more messages — Moved to the Credit wallet) → once the plan quota is exhausted, the wallet is charged (inferred; deduction order not confirmed).
- 10% VAT on the credit purchase amount (separate column in the history).

### 14.3 ZBS credits
- Separate wallet, topped up via bank transfer or VNPAY, 10% VAT; used for sending Zalo ZBS (the "Tính năng" (Feature) column). ZBS unit price per message & credit exchange rate: not seen.

### 14.4 Other limits
- Affiliate: up to 5 links; commission 20%/order or 300,000 VND/order.
- Notifications: up to 5 reminder offsets.
- Image library: albums send at most the first 30 images; image quota by plan (10 on free; 200/600 images-videos on paid plans).
- Text limits: classification instructions 2000 characters; fallback message 1000 characters.
- Bot stays silent for 5 minutes when a message comes from another platform; the bot is automatically re-enabled 5 minutes after staff message manually; follow-up within the 24h window (Messenger policy).
- Avatar/logo upload ≤1MB, 720x720.
- Zalo OA must be on the OA Tăng trưởng (OA Growth) / OA Toàn diện (OA Comprehensive) package.
- Ticket SLA 10 minutes – 2 hours.
- Default page size: orders 20, instructions 10.

---

## 15. Unknowns / gaps (noted in the files or due to not being observable)
1. **Inbox `/quan-ly/tin-nhan`**: empty snapshot — no details on layout, conversation filters, customer panel, or creating orders from chat.
2. Bot list `/quan-ly/bot` and the bot creation wizard: only notes, no field list.
3. Detail forms: add instruction, add FAQ (file import structure), add bot product (fields beyond code/name/price/instructions), add catalog product (variants, cost price, stock), **"Cấu hình sản phẩm"** (Product configuration), **"Nhập sản phẩm"** (Import products).
4. CRM customer table: columns, filters, fields in the detail dialog; the **"Tự động hoá"** (Automation) view in the CRM.
5. Tag details: the attribute fields (5–7 fields) of the system tags; the **"Cài đặt tag nhanh"** (Quick tag settings) tab; what **"tag đỏ"** (red tag) / **"tag im lặng"** (silent tag) are.
6. Workflow: template list beyond Soft Follow-up; configuration of steps/delays/message content; Zalo Templates (blocked because no OA connected).
7. ZBS/Email campaigns: campaign creation wizard, Statistics/Template tabs; ZBS pricing.
8. FMM: no ad account connected, so Campaigns/Audiences were not visible.
9. Facebook Posts: blocked by plan.
10. Integrations: no OAuth was run for any platform; Lazada & Website widget are locked — widget configuration (embed code, colors, position) unknown. The page in **"Chờ kích hoạt"** (Pending activation) was not activated.
11. Shipping carrier: list of supported carriers and credential form not seen; the **"Đơn hàng từ chat"** (Orders from chat) tab did not render content; the list of order creation/confirmation conditions not seen; status options (lock sending orders…).
12. Full list of order statuses (hidden in the **"Chờ chuyển hàng"** (Awaiting shipment) combobox).
13. Permissions: list of roles beyond "Sale"/"Chủ sở hữu" (Owner), the permission matrix, the add-member form (limit 1/1 on free).
14. Billing: prices for cycles other than 12 months; plan payment flow; **"Mua thêm gói dịch vụ"** (Buy additional service packs) (add-ons, pricing); ZBS credit rate; deduction order of plan quota vs. credit wallet; what vouchers do; 2FA method; phone number verification.
15. Affiliate: terms not accepted; 3 pages (Customer transactions, Withdrawal/receipt history, Bank information) not observed; withdrawal threshold.
16. Ticket: ticket creation form.
17. How "Tài liệu" (Documents) (14/500) and "Hình ảnh AI" (AI images) (image library vs. AI-generated images?) are counted is unclear.
18. Whether test chats consume credits/quota; which changes "Lịch sử chỉnh sửa" (Edit history) logs (still empty after adding FAQ/product/quick reply).
19. Disclaimer in each file: snapshots are UI text, "không phải xác nhận tất cả nút đã chạy" (not a confirmation that every button was executed); early snapshots may still have been loading (e.g., TikTok bot observation #75 was empty, #77 showed content after loading).
20. The referenced files `../README.md` and `../09-ket-qua-thu-nghiem.md` (business analysis, test results) — outside the scope of this reading.
