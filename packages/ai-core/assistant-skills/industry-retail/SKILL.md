---
name: industry-retail
description: Industry guide for shops selling products: profile facts, customer questions, sample scenarios and quick replies
toolsets: [ui, routes]
version: 1
---
# Industry guide: retail shops

Use this when you draft the business information, FAQ, reply guidance, scenarios or quick replies of a bot whose industry is retail. Load fill-shop-info, draft-reply-guidance or fill-sample-data for the steps; this guide gives the industry content.

## Profile facts

Besides the basic fields (`displayName`, `address`, `hotline`, `hours`), a shop has:
- `payment`: how customers pay (bank transfer, cash on delivery, card);
- `shipping`: areas served, carriers, fees and delivery times;
- `returns`: return and exchange conditions and time limit;
- `warranty`: warranty terms, when the products have one;
- `promotion`: the current promotion, with its dates.
Each one comes from the owner, pasted text or Rapiz data; never from this guide.

## Sources in Rapiz

Read the products to learn the categories and what the shop sells. Product names and categories may shape the wording ("Shop bán áo thun, quần jean…"). Prices only from the catalog: never write a price, a range or a discount that is not in it.

## What customers ask

Còn hàng không, có size/màu nào, giá bao nhiêu, phí ship và bao lâu nhận được, có ship COD không, có được kiểm tra hàng không, đổi trả thế nào, shop ở đâu, mấy giờ mở cửa. Most of these are profile fields; the FAQ is for the rest (for example how to choose between two product lines, or whether the shop sells wholesale), and only with sourced answers.

## Sample scenarios

- Hỏi size, màu, còn hàng — Khi khách hỏi size, màu hoặc còn hàng — Trả lời theo dữ liệu sản phẩm; nếu sản phẩm có nhiều lựa chọn thì hỏi khách chọn loại nào. Không khẳng định còn hàng khi dữ liệu không có tồn kho.
- Khách muốn mua — Khi khách nói muốn mua hoặc chốt đơn — Tóm tắt sản phẩm, số lượng và giá theo danh mục, xin tên, số điện thoại và địa chỉ nhận hàng, chỉ lên đơn sau khi khách xác nhận.
- Khách khiếu nại — Khi khách phàn nàn về hàng lỗi, giao chậm hoặc thái độ phục vụ — Xin lỗi ngắn gọn, hỏi mã đơn hoặc số điện thoại đặt hàng và chuyển nhân viên xử lý. Không tự hứa hoàn tiền hay đổi hàng.
- Khách mặc cả — Khi khách xin giảm giá — Không tự giảm giá; nói sẽ chuyển nhân viên xem ưu đãi cho khách.
- Hỏi sản phẩm shop không bán — Khi khách hỏi sản phẩm không có trong danh mục — Nói thật là shop chưa có sản phẩm đó và gợi ý sản phẩm gần nhất trong danh mục, nếu có.

## Sample quick replies

- giaship: phí ship và thời gian giao, with the fee from `shipping`; ask the owner for it, never guess.
- ck: thông tin chuyển khoản, with the bank details the owner gives in the chat; never guess them.
- camon: Dạ shop cảm ơn anh/chị đã ủng hộ ạ!
- doitra: điều kiện đổi trả, from `returns`.

## Never

- a price, fee or discount that is not in the catalog or the profile;
- a promise of stock when the data has none;
- free shipping, cash on delivery or a return policy the profile does not state.
