# Rapiz: danh sách tính năng cho landing page

> Xương sống nội dung và checklist cho landing page (`apps/site`).
> Nguồn: `origin/main` tới PR #142, tài liệu module, app chạy thử ngày 08/11/2026.
> Sơ đồ: https://claude.ai/artifact/AjpEtnNaMnLGDktFyz3Stn

## Cách dùng file này

- Mỗi tính năng có **trạng thái**. Landing chỉ hứa những gì đã chạy.
  - `CHẠY`: đã có trong `main`, dùng được.
  - `BETA`: có code nhưng đang thử nghiệm hoặc chưa xác minh chạy thật. Trên landing phải gắn nhãn "Beta".
  - `SẮP`: đang làm, gần xong, chưa vào `main`. Landing gắn nhãn "Sắp ra mắt"; chuyển sang `CHẠY` khi merge và chạy được thật.
  - `CHƯA`: chưa có. Chỉ được nhắc dưới dạng "Sắp có", hoặc không nhắc.
- Cột **Landing**: đánh `[x]` khi tính năng đã có mặt trên landing (đúng section, có ảnh hoặc demo).
- Cột **Nguồn**: PR hoặc tài liệu để kiểm chứng trước khi viết copy.
- Khi thêm tính năng mới, cập nhật file này trước rồi mới sửa landing.

## Định vị

> Nhân viên sale AI cho doanh nghiệp Việt: tư vấn, **chốt đơn và giữ chỗ** bằng đúng dữ liệu của shop, biết lúc cần gọi người, và chủ shop có trợ lý riêng để nắm số liệu.

Đối tượng chính: shop bán online chạy quảng cáo Facebook, villa/homestay, spa/salon, trung tâm giáo dục, công ty SaaS.

---

## A. Bot bán hàng AI (section chính, hero)

| Landing | Tính năng | Trạng thái | Điểm chứng minh nên nói | Nguồn |
|---|---|---|---|---|
| [x] | **Chốt đơn trong chat**: bot gửi tóm tắt đơn kèm nút ✅ Đặt hàng / sửa; đơn chỉ được tạo khi khách bấm xác nhận | CHẠY | Đơn vào hệ thống, giữ tồn kho, đánh dấu "Bot tạo", nhân viên duyệt | #100 |
| [x] | **Tính tiền chính xác**: mọi phép tính đi qua máy tính, bot bị cấm nhẩm | CHẠY | Đọc đúng `1.760.000`, `500,000`, `1,5` | #100 |
| [x] | **Không bịa giá, tồn kho**: giá, tồn, ngày trống đều lấy từ dữ liệu shop qua công cụ | CHẠY | Câu trả lời dựa trên hồ sơ doanh nghiệp, FAQ, catalog | #94, #143 (T-143) |
| [x] | **Tìm sản phẩm theo nhu cầu**: khách gõ không dấu, viết tắt vẫn ra đúng sản phẩm | CHẠY | Ví dụ: "ao thun trang con size L ko" | #94 |
| [x] | **Gửi ảnh sản phẩm thật** trong chat | CHẠY | Ảnh lưu trên Rapiz, chỉ gửi ảnh có trong catalog | #95 |
| [x] | **Gọi API riêng của shop** (tra đơn, kiểm tra tồn, đặt lịch…) | CHẠY | Có bước xác nhận trước khi thực hiện, chặn gọi vào mạng nội bộ | #58 (T-055), `docs/actions.md` |
| [x] | **Chuyển cho nhân viên** khi cần, kèm lý do và tóm tắt | CHẠY | Nhân viên nhận thông báo đẩy ngay | #58, #136 |
| [x] | **Agent loop v2**: tối đa 10 bước, gọi công cụ song song, tự sửa lỗi, tóm tắt hội thoại dài | CHẠY | Nói bằng lợi ích: "trả lời nhanh, không quên ngữ cảnh khi chat dài" | #99 |
| [x] | Nhiều nhà cung cấp AI, dùng được gói ChatGPT | CHẠY | Chỉ nhắc ở FAQ hoặc phần kỹ thuật | #56, #58 |

## B. Trợ lý Rapiz cho chủ doanh nghiệp (điểm khác biệt số 2)

| Landing | Tính năng | Trạng thái | Điểm chứng minh nên nói | Nguồn |
|---|---|---|---|---|
| [x] | **Hỏi số liệu bằng tiếng Việt, nhận biểu đồ** | CHẠY | "Tuần này bao nhiêu đơn?", "Doanh thu villa tháng 10?" | #128 (T-171) |
| [x] | **Báo cáo, cảnh báo định kỳ** qua chuông, email, push | CHẠY | "Mỗi sáng 8h gửi tôi số đơn hôm qua" | #128 (T-172) |
| [x] | **Bác sĩ bot**: hỏi vì sao bot trả lời như vậy, nhận đề xuất sửa | CHẠY | Minh bạch, chủ shop tự sửa bot không cần kỹ thuật | #128 (T-174) |
| [x] | **Nhập sản phẩm** từ Excel/CSV và ảnh, duyệt một lần | CHẠY | Lên catalog trong vài phút | #128 (T-173) |
| [x] | **Tự điền thông tin shop, kịch bản**, nháp API action | CHẠY | Nút "Nhờ trợ lý điền mẫu" | #128 (T-175) |
| [x] | Mọi thay đổi đều **chờ chủ shop duyệt**; trợ lý có bộ nhớ và tự học kỹ năng | CHẠY | Thông điệp an tâm: "trợ lý đề xuất, bạn quyết định" | #128 (T-170) |

## C. Bot theo ngành (mỗi ngành một trang con)

| Landing | Ngành | Bot làm được gì | Trạng thái | Nguồn |
|---|---|---|---|---|
| [x] | **Bán lẻ online** | Tư vấn, tìm sản phẩm, chốt đơn, trừ tồn | CHẠY | #94, #100 |
| [x] | **Villa, homestay** | Xem lịch trống, báo giá theo gói phòng (6PN/5PN/4PN), giữ chỗ tự hết hạn, nhân viên xác nhận | CHẠY | #103, #105, #135, `docs/lodging.md` |
| [x] | **Spa, salon, thẩm mỹ** | Ghi lịch hẹn (dịch vụ, chi nhánh, ngày giờ, số người), không nhận ngày đã qua | CHẠY | #131, `docs/education-and-spa.md` |
| [x] | **Giáo dục, trung tâm** | Đăng ký test trình độ, học thử, tư vấn lộ trình; phụ huynh đăng ký cho con | CHẠY | #131 |
| [x] | **SaaS, phần mềm** | Nhận yêu cầu demo, dùng thử; theo dõi gói, MRR, rời bỏ | CHẠY | #93, #112, `docs/saas.md` |

## D. Kênh

| Landing | Kênh | Trạng thái | Ghi chú cho landing | Nguồn |
|---|---|---|---|---|
| [x] | Facebook Messenger | CHẠY | Logo đậm | #40, #58 |
| [x] | **Bình luận Facebook theo ngữ cảnh bài post**: trả lời công khai, nhắn riêng (một tin văn bản, cùng nội dung), ẩn bình luận khớp từ khóa | CHẠY | Điểm nhấn cho shop chạy ads. Chỉ ẩn theo từ khóa, không tự nhận diện bình luận xấu | #60, T-106 |
| [x] | Chat trên website (widget ~9 KB, thu số điện thoại) | CHẠY | Có mã nhúng | T-097..T-104 |
| [x] | Instagram DM | BETA | Gắn nhãn "Beta" tới khi xác minh chạy thật | `docs/meta-inbox.md` |
| [x] | **Zalo** | SẮP | Đang hoàn thiện. Logo đậm kèm nhãn "Sắp ra mắt"; bỏ nhãn khi chạy thật | đang làm |
| [x] | **TikTok** | SẮP | Đang hoàn thiện. Logo đậm kèm nhãn "Sắp ra mắt"; bỏ nhãn khi chạy thật | đang làm |
| [ ] | Lazada | CHƯA | Không nhắc | – |

## E. Inbox cho đội sale

| Landing | Tính năng | Trạng thái | Nguồn |
|---|---|---|---|
| [x] | Inbox đa kênh kiểu Meta Business Suite: chưa đọc, nhãn, lọc theo bot và thời gian | CHẠY | T-096, #59 |
| [x] | Bật/tắt bot cho từng hội thoại, nhân viên tiếp quản | CHẠY | #59, T-090 |
| [x] | Hồ sơ khách và tạo đơn ngay cạnh khung chat | CHẠY | #59 (T-068) |
| [x] | Nháp tự lưu, chế độ trả lời, follow-up, phím tắt | CHẠY | #59 |
| [x] | Bình luận Facebook xử lý chung trong inbox | CHẠY | T-106 |
| [x] | **Cài như app trên điện thoại** + thông báo đẩy khi bot cần người | CHẠY | #136, `docs/19-installable-app.md` |

## F. Đào tạo bot

| Landing | Tính năng | Trạng thái | Nguồn |
|---|---|---|---|
| [x] | Hồ sơ doanh nghiệp có cấu trúc; tính cách, độ dài câu, emoji | CHẠY | T-137..T-143 |
| [x] | Quy tắc theo tình huống (bật/tắt, sau chốt đơn), bộ mẫu theo ngành | CHẠY | #58 (T-070) |
| [x] | FAQ, tài liệu, catalog riêng cho từng bot, thư viện ảnh | CHẠY | #40, #84 |
| [x] | **Lịch sử chỉnh sửa và khôi phục** phiên bản cũ | CHẠY | #40, `docs/training-workspace.md` |
| [x] | Chat thử hiển thị giống Messenger, cả trên điện thoại | CHẠY | #98, #141 |
| [ ] | Bộ đánh giá tự động cho câu trả lời của bot | CHẠY (chỉ cho dev) | T-145. Lệnh `pnpm eval`, không có màn hình trong app: không nhắc trên landing |

## G. Vận hành bán hàng

| Landing | Tính năng | Trạng thái | Nguồn |
|---|---|---|---|
| [x] | Sản phẩm, biến thể, kho, tồn kho | CHẠY | #13, #24 |
| [x] | Đơn hàng: nguồn, trạng thái, sửa món, tách tổng tiền và tiền phải thu | CHẠY | #24 |
| [x] | Lưu trú: căn, phòng, gói phòng, giá theo thứ và khoảng ngày | CHẠY | #103, #135 |
| [x] | Lịch phòng 2 tuần, tháng, quý, năm; booking, khoá lịch, ghi chú đêm | CHẠY | #103, #142 |
| [ ] | Hãng vận chuyển (GHN, GHTK…), in đơn | CHƯA | Không nhắc |

## H. CRM và thống kê

| Landing | Tính năng | Trạng thái | Nguồn |
|---|---|---|---|
| [x] | Khách hàng: nguồn, trạng thái theo ngành, nhãn, ghi chú, lịch sử | CHẠY | #39, #131 |
| [x] | Tự chia khách cho sale theo chính sách | CHẠY | #41 (T-033) |
| [x] | Thống kê: hội thoại → khách mới → SĐT → đơn; lọc theo trang, bot, ngày; drilldown | CHẠY | #54, #83 |
| [x] | Tổng quan nhiều business trên một màn hình | CHẠY | #84 |
| [ ] | Remarketing ZBS, email; workflow tự động | CHƯA | Không nhắc |

## I. Tích hợp

| Landing | Tính năng | Trạng thái | Ghi chú | Nguồn |
|---|---|---|---|---|
| [x] | **KiotViet**: sản phẩm, tồn theo chi nhánh, đẩy đơn, đồng bộ khách | BETA | App đang ghi "Thử nghiệm", landing gắn "Beta" | #104, #106, #107 |
| [x] | Sapo, Haravan, Pancake POS | CHƯA | "Sắp có" | – |
| [x] | API công khai, webhook có chữ ký, tài liệu OpenAPI | CHẠY | Cho agency, dev | #115 |

## J. Nền tảng, bảo mật, gói cước

| Landing | Tính năng | Trạng thái | Nguồn |
|---|---|---|---|
| [x] | Một tài khoản quản lý nhiều business, mỗi business một ngành | CHẠY | #82, #84 |
| [x] | Thành viên, vai trò, giới hạn ghế, lời mời | CHẠY | #41, #53 |
| [x] | Xác thực 2 lớp (2FA), nhật ký thao tác (audit) | CHẠY | #53 |
| [x] | Dữ liệu tách riêng từng business | CHẠY | Kiến trúc RLS |
| [x] | Gói cước, dùng thử, thanh toán VietQR | CHẠY | #111 |
| [x] | Đăng ký bằng mã xác thực email, quên mật khẩu | CHẠY | #118 |

---

## Cấu trúc landing đề xuất (map với các nhóm trên)

| # | Section | Lấy nội dung từ | Landing |
|---|---|---|---|
| 1 | Hero: định vị + demo chat chốt đơn (tóm tắt + nút ✅) | A | [x] |
| 2 | Kênh: Messenger, bình luận FB, website, Zalo, TikTok; Instagram "Beta", Zalo/TikTok "Sắp ra mắt" tới khi chạy thật | D | [x] |
| 3 | Bot làm việc thật: chốt đơn, tính tiền, tìm sản phẩm, gọi API | A | [x] |
| 4 | Bình luận hiểu bài post | D | [x] |
| 5 | Trợ lý Rapiz: hỏi số liệu ra biểu đồ, báo cáo định kỳ, bác sĩ bot | B | [x] |
| 5b | Rapiz Agents: hai khung chat minh họa Shop-Agent (bot bán hàng) và Personal-Assistant (trợ lý của chủ), mỗi bên 3 nhóm tính năng; Core AI: một lượt chạy của từng agent | A, B | [x] |
| 6 | Theo ngành: tab bán lẻ / villa / spa / giáo dục / SaaS, mỗi tab một đoạn chat mẫu | C | [x] |
| 7 | Bot và người làm chung: inbox, chuyển người, push trên điện thoại | E | [x] |
| 8 | Dạy bot như dạy nhân viên mới: hồ sơ, quy tắc, lịch sử + khôi phục | F | [x] |
| 9 | Đo được doanh thu: thống kê, CRM, tự chia khách | H | [x] |
| 10 | Tích hợp: KiotViet (Beta), API + webhook, POS khác "Sắp có" | I | [x] |
| 11 | An toàn: 2FA, audit, phân quyền, dữ liệu tách riêng | J | [x] |
| 12 | Bảng giá, FAQ, CTA cuối | J | [x] |

## Trang con (sinh bằng `tools/build_site.py` vào `public/`)

- Ngành: `nganh/ban-le`, `nganh/villa-homestay`, `nganh/spa-salon`, `nganh/giao-duc`, `nganh/phan-mem`
- Tính năng: `tinh-nang/ban-hang-ai`, `binh-luan-facebook`, `hop-thu`, `dao-tao-ai`, `tro-ly-rapiz`, `khach-hang-thong-ke`
- Nền tảng: `tich-hop`, `bao-mat`, `bang-gia`, `dat-lich-demo`
- Giá và hạn mức gói lấy từ `packages/db/migrations/0015_billing.sql` (phiên bản 1). Kiểm tra lại nếu admin đã xuất bản phiên bản gói mới.

## Không được hứa trên landing

- [ ] Zalo và TikTok mang nhãn "Sắp ra mắt" cho tới khi đã merge và chạy thật; khi đó cập nhật trạng thái trong file này rồi bỏ nhãn.
- [ ] Không nhắc Lazada.
- [ ] Không nhắc remarketing ZBS/email, workflow tự động, hãng vận chuyển như tính năng đã có.
- [ ] Instagram và KiotViet luôn có nhãn "Beta".
- [ ] Không nêu tên đối thủ; so sánh với "chatbot thông thường".
- [ ] Mọi đoạn chat mẫu ghi rõ là hội thoại minh hoạ, trừ khi lấy từ bot thật.
