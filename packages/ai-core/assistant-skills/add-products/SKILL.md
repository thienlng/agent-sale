---
name: add-products
description: Add or update products in the catalog, set stock, and choose which products a bot sells
title: Thêm sản phẩm
description_vi: Thêm hoặc sửa sản phẩm, đặt tồn kho và chọn sản phẩm cho bot bán
toolsets: [ui, routes]
version: 5
---
# Add products

Use this when the owner wants to add a product, a course or a service, change one, set its stock, or decide what a bot may sell.

1. Ask which business it is for when the owner has more than one.
2. Check what already exists before adding: search the catalog with the products read tool, so the same product is not added twice.
3. To add one product with the owner, open /app/products/new with ui_navigate. When the page lists a product form in <page_context> forms, call ui_fill_form with what the owner gave: code, name, category, description, price, and cost (giá vốn) and weightGram (grams) when the form lists them. The SKU is required to save, so every product fill sends the SKU field (the first variant's SKU) with a value, also when the owner did not mention it: use the SKU the owner gave; else make one from the code (the code itself, or code-size such as AT01-M); else from the name (unaccented initials in capitals plus a number, at most 20 characters, no trailing dash). Never leave it empty, and say a made-up SKU is a suggestion. For a course or a service the form also lists the offering fields (durationMinutes, sessions, format, level, period, schedule, audience, priceNote): put each detail in its own field, never in the description, for example "lịch học sáng thứ 7" in schedule and "3 tháng" in period. Only say the form has no field for something after checking the fields listed in <page_context>. The owner checks the form and saves it.
4. To add or change products for the owner, draft the change with the product write tool (create a product with its variants, or replace a product and its variants). It becomes a proposal; tell the owner to approve it in the chat. Replacing a product archives the variants that are left out, so always start from the current product.
5. Pictures are uploaded by the owner on the product page; you cannot upload files.
6. Stock: the counted stock of an existing variant is set per warehouse (POST /products/{productId}/stock); list the warehouses first and use the default one unless the owner names another. A new product with a stock figure ("tồn kho 5") is one card: pass `stock` ([{sku, onHand}]) with the POST /products tool_call, and the stock is set in the default warehouse when the owner approves. Never promise a later stock proposal.
7. Courses and services (an education or spa business). A course or a service is a product with an offering: kind (course or service), durationMinutes (one session or one appointment, in minutes), sessions (sessions in a course or a treatment package), period (how long the course runs, as the business says it), format (online, offline or hybrid), level, schedule, audience, outcomes (at most 5) and priceNote ("liên hệ", "từ", "giá tham khảo"). Send the offering with the product write tool; each option with its own price (a level, a package of sessions) is a variant. A course or a service has no stock: never propose stock for it. When the site gives no price, the variant price is 0 and priceNote says why. priceNote is wording, never a copy of the price: never write an amount that a variant price already holds ("150.000đ/lần"); leave it empty when the price is published and needs no wording. Fill only the fields the owner gave; leave the rest out. A product never has both an offering and a lodging accommodation.
8. What the bot may say about a product (visible to the bot, extra bot instructions) is changed on its own, without touching price or variants.
9. Which products a bot sells: a bot sells every active product, or only the products selected for it. Open /app/bots/{botId}/products to show or change the selection.
10. After the owner approved, confirm from the event message only, then offer to open /app/products.
11. The product name is exactly what the owner wrote ("tạo sản phẩm QA AS2 Búp bê gỗ" → name "QA AS2 Búp bê gỗ"); never move a part of it into the code. Make the code from the whole name when the owner gave none.
12. When the owner corrects a draft (a rejected card, "tên phải là …"), send the corrected card in that same turn; do not ask whether to send it.
