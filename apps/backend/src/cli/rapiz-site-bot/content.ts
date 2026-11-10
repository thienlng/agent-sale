/**
 * What the Rapiz website chat bot knows (`rapiz-site-bot seed`). Tenant content in Vietnamese,
 * version-controlled so a re-seed puts it back. Every fact comes from the marketing site
 * (`apps/site/public`, generated from `apps/site/tools/site_content.py`) or
 * `apps/site/FEATURES.vi.md`; change those first, then this file. Rapiz publishes only its company
 * name and support email (site footer): no address, hotline or opening hours, so those stay empty.
 */

export const SITE_BOT_NAME = 'Rapiz';
export const SITE_CHANNEL_NAME = 'Website Rapiz';

/** Shown by the chat bubble (channel settings) and used as the bot greeting. */
export const SITE_GREETING =
  'Dạ em chào anh/chị! Em là trợ lý của Rapiz. Anh/chị muốn tìm hiểu tính năng, bảng giá hay đặt lịch demo ạ?';

export const SITE_WIDGET = {
  agentName: 'Rapiz',
  color: '#FF7A45',
  greeting: SITE_GREETING,
  requirePhoneAfter: 0,
} as const;

export const SITE_MISSION = [
  'Tư vấn cho khách truy cập website Rapiz về sản phẩm Rapiz: nhân viên sale AI cho doanh nghiệp Việt, tư vấn bằng dữ liệu của doanh nghiệp, lên đơn ngay trong chat và chuyển người khi khách cần.',
  'Chỉ dùng thông tin trong hồ sơ doanh nghiệp và câu hỏi thường gặp. Không hứa tính năng, giá, ưu đãi hay thời gian ra mắt ngoài thông tin đã có. Tính năng có nhãn Beta (Instagram DM, KiotViet) hoặc Sắp ra mắt (Zalo, TikTok) phải nói rõ nhãn đó.',
  'Khi khách đang ở một trang cụ thể (bảng giá, một ngành, một tính năng), trả lời theo nội dung trang đó trước.',
  'Chỉ xin số điện thoại hoặc email khi khách muốn đặt lịch demo, cần báo giá hoặc tư vấn gói, hoặc muốn nói chuyện với đội sale. Khi đó xin tên, số điện thoại (hoặc email), tên doanh nghiệp và nhu cầu để đội Rapiz liên hệ. Không xin thông tin liên hệ khi khách chỉ hỏi để tìm hiểu.',
  'Khách muốn tự thử thì hướng dẫn tạo tài khoản gói Miễn phí trên website. Câu hỏi ngoài phạm vi thì nói chưa có thông tin và mời khách để lại liên hệ cho đội Rapiz.',
].join('\n');

/** Saas profile fields (contracts `profileFieldsFor('saas')`); keys left out stay empty. */
export const SITE_PROFILE_FIELDS: Readonly<Record<string, string>> = {
  displayName: 'Rapiz',
  plans: [
    'Giá mỗi tháng theo kỳ trả trước 12 / 6 / 3 tháng.',
    'Miễn phí: 0đ, không thời hạn, không cần thẻ thanh toán. 1.000 lượt trả lời AI mỗi 14 ngày, 1 thành viên, tối đa 3 kênh, 5.000 khách hàng lưu trữ; Tin nhắn đa kênh, Đào tạo Bot, chốt đơn trong chat, Trợ lý Rapiz.',
    'Sales Smart: 785.000đ / 1.050.000đ / 1.310.000đ. Cho shop và cơ sở dịch vụ có đội sale nhỏ. 7.000 lượt trả lời AI mỗi 30 ngày, 5 thành viên, 5 kênh, 20.000 khách hàng, bình luận Facebook theo bài đăng, khung chat website, 10 GB ảnh và tệp.',
    'Sales Pro: 974.000đ / 1.299.000đ / 1.624.000đ. Cho nhiều fanpage, nhiều chi nhánh, cần kết nối hệ thống. Mọi thứ trong Sales Smart, 15 thành viên, 20 kênh, 50.000 khách hàng, 30 GB, thêm mô hình AI Pro, API công khai và webhook có chữ ký.',
    'Sales Neo: 1.624.000đ / 1.999.000đ / 2.499.000đ. Cho chuỗi và doanh nghiệp nhiều thương hiệu. Mọi thứ trong Sales Pro, 30 thành viên, 100 kênh, không giới hạn khách hàng, thêm mô hình AI Neo, 100 GB lưu trữ.',
    'Gói tính theo tài khoản; hạn mức lượt trả lời AI dùng chung cho mọi doanh nghiệp trong tài khoản.',
  ].join('\n'),
  freeTrial:
    'Gói Miễn phí không giới hạn thời gian, có 1.000 lượt trả lời AI mỗi 14 ngày: kết nối fanpage, chat thử với bot giống như trên Messenger rồi mới bật cho khách thật. Tài khoản mới có thể được dùng thử gói trả phí trong thời gian khuyến mãi khi đăng ký; sau đó chuyển về gói đã chọn hoặc gói Miễn phí.',
  demo: 'Buổi demo riêng 30 phút, không mất phí: cài thử trên một phần danh mục và chính sách của khách, chat thử bằng câu khách hay hỏi (kể cả không dấu), xem hộp thư, bàn giao cho nhân viên và Trợ lý Rapiz, tư vấn gói theo số thành viên, kênh và lượng tin nhắn. Đăng ký ở trang Đặt lịch demo.',
  integrations:
    'Kênh: Facebook Messenger, bình luận Facebook theo bài đăng, khung chat trên website. Instagram DM đang Beta. Zalo và TikTok sắp ra mắt. KiotViet (Beta): đồng bộ sản phẩm, tồn kho theo chi nhánh, đẩy đơn, đồng bộ khách. Nhập danh mục từ Excel hoặc CSV. API công khai, webhook có chữ ký và tài liệu OpenAPI (gói Sales Pro, Sales Neo). Sapo, Haravan, Pancake POS sắp có.',
  onboarding:
    'Không cần lập trình: kết nối fanpage, chọn bộ mẫu theo ngành, nhập danh mục từ Excel và chat thử. Bộ mẫu điền sẵn phần lớn nội dung, Trợ lý Rapiz giúp điền phần còn lại để chủ doanh nghiệp duyệt.',
  dataSecurity:
    'Dữ liệu tách riêng theo doanh nghiệp ở tầng cơ sở dữ liệu; thành viên chỉ thấy doanh nghiệp họ được mời vào. Phân quyền theo vai trò, xác thực hai lớp, nhật ký thao tác. Dữ liệu một doanh nghiệp không được dùng để trả lời khách của doanh nghiệp khác. Doanh nghiệp cần hồ sơ bảo mật cho thẩm định thì đặt lịch trao đổi với Rapiz.',
  support:
    'Email hỗ trợ: support@rapiz.io. Rapiz là sản phẩm của Công ty TNHH Công nghệ Rapiz (Rapiz Technology Company Limited).',
  payment:
    'Chuyển khoản qua mã VietQR. Mỗi yêu cầu thanh toán có mã chuyển khoản riêng; gói được kích hoạt khi Rapiz xác nhận đã nhận tiền. Thanh toán trước khi hết kỳ thì kỳ mới bắt đầu từ ngày kết thúc kỳ hiện tại.',
};

export const SITE_PROFILE_NOTES = [
  'Ngành Rapiz phục vụ: bán lẻ và thương mại điện tử, lưu trú và nghỉ dưỡng (villa, homestay), làm đẹp và spa, giáo dục và đào tạo, công nghệ và phần mềm (SaaS). Một tài khoản quản lý nhiều doanh nghiệp, mỗi doanh nghiệp một ngành.',
  'Tính năng chính: chốt đơn trong chat (đơn chỉ tạo khi khách bấm xác nhận, nhân viên duyệt), tính tiền bằng máy tính, giá và tồn kho tra từ dữ liệu của shop, tìm sản phẩm kể cả khi khách gõ không dấu, gửi ảnh sản phẩm thật, gọi API riêng của shop có bước xác nhận, chuyển cho nhân viên kèm lý do và tóm tắt.',
  'Hộp thư đa kênh cho đội sale, bật tắt bot cho từng hội thoại, cài như app trên điện thoại với thông báo đẩy. Đào tạo bot bằng hồ sơ doanh nghiệp, quy tắc theo tình huống, FAQ, tài liệu, lịch sử chỉnh sửa và khôi phục. CRM: nguồn, trạng thái, nhãn, tự chia khách cho sale; thống kê từ hội thoại tới khách mới, số điện thoại và đơn.',
  'Trợ lý Rapiz cho chủ doanh nghiệp: hỏi số liệu bằng tiếng Việt và nhận biểu đồ, báo cáo định kỳ, hỏi vì sao bot trả lời như vậy, nhập sản phẩm từ Excel hoặc CSV; mọi thay đổi chờ chủ doanh nghiệp duyệt.',
].join('\n');

export interface SiteFaq {
  question: string;
  answer: string;
}

/** Matched by question text: a re-seed updates these answers and leaves other FAQs alone. */
export const SITE_FAQS: readonly SiteFaq[] = [
  {
    question: 'Rapiz là gì?',
    answer:
      'Rapiz là nhân viên sale AI cho doanh nghiệp Việt: tư vấn bằng dữ liệu của doanh nghiệp, lên đơn ngay trong chat và chuyển người khi khách cần. Chủ doanh nghiệp còn có Trợ lý Rapiz để hỏi số liệu và nhận báo cáo.',
  },
  {
    question: 'Rapiz phù hợp với ngành nào?',
    answer:
      'Bán lẻ online, villa và homestay, spa và salon, giáo dục và trung tâm, phần mềm và SaaS. Mỗi ngành có bộ mẫu riêng: ví dụ bán lẻ chốt đơn trong chat, villa xem lịch trống và giữ chỗ, spa ghi lịch hẹn, giáo dục đăng ký học thử, SaaS nhận yêu cầu demo và dùng thử.',
  },
  {
    question: 'Bảng giá các gói Rapiz thế nào?',
    answer:
      'Giá mỗi tháng khi trả 12 / 6 / 3 tháng: Sales Smart 785.000đ / 1.050.000đ / 1.310.000đ; Sales Pro 974.000đ / 1.299.000đ / 1.624.000đ; Sales Neo 1.624.000đ / 1.999.000đ / 2.499.000đ. Gói Miễn phí 0đ, không thời hạn, không cần thẻ thanh toán.',
  },
  {
    question: 'Các gói khác nhau ở điểm nào?',
    answer:
      'Miễn phí: 1 thành viên, 3 kênh, 1.000 lượt trả lời AI mỗi 14 ngày. Sales Smart: 5 thành viên, 5 kênh, 7.000 lượt mỗi 30 ngày, thêm bình luận Facebook theo bài đăng và khung chat website. Sales Pro: 15 thành viên, 20 kênh, thêm mô hình AI Pro, API công khai và webhook. Sales Neo: 30 thành viên, 100 kênh, không giới hạn khách hàng, thêm mô hình AI Neo, 100 GB lưu trữ.',
  },
  {
    question: 'Có được dùng thử không?',
    answer:
      'Dạ có. Gói Miễn phí không giới hạn thời gian, có 1.000 lượt trả lời AI mỗi 14 ngày, không cần thẻ thanh toán. Anh/chị kết nối fanpage, chat thử với bot giống như trên Messenger rồi mới bật cho khách thật. Tài khoản mới có thể được dùng thử gói trả phí trong thời gian khuyến mãi khi đăng ký.',
  },
  {
    question: 'Lượt trả lời AI được tính thế nào?',
    answer:
      'Một lượt là một câu trả lời bot gửi tới khách, kể cả trả lời bình luận. Tin nhắn nhân viên gửi không bị tính. Một câu trả lời được tính một lần dù hệ thống gửi lại.',
  },
  {
    question: 'Hết lượt trả lời AI thì sao?',
    answer:
      'Bot ngừng trả lời và hội thoại mới tự chuyển cho nhân viên trong hộp thư, bình luận mới vào danh sách chờ, không có tin nhắn nào bị bỏ rơi. Hạn mức mở lại ở chu kỳ sau hoặc khi nâng gói.',
  },
  {
    question: 'Thanh toán bằng cách nào?',
    answer:
      'Chuyển khoản qua mã VietQR. Mỗi yêu cầu thanh toán có mã chuyển khoản riêng; gói được kích hoạt khi Rapiz xác nhận đã nhận tiền. Thanh toán trước khi hết kỳ thì kỳ mới bắt đầu từ ngày kết thúc kỳ hiện tại, không mất ngày nào.',
  },
  {
    question: 'Hết hạn mà chưa gia hạn thì sao?',
    answer:
      'Tài khoản chuyển sang trạng thái quá hạn và được nhắc trước. Sau thời gian ân hạn, tài khoản tạm dừng rồi chuyển về gói Miễn phí.',
  },
  {
    question: 'Một tài khoản có nhiều doanh nghiệp, tính phí ra sao?',
    answer:
      'Gói tính theo tài khoản. Hạn mức lượt trả lời AI dùng chung cho mọi doanh nghiệp trong tài khoản.',
  },
  {
    question: 'Rapiz kết nối được những kênh nào?',
    answer:
      'Facebook Messenger, bình luận Facebook theo bài viết và khung chat nhúng vào website. Instagram DM đang ở bản Beta. Zalo và TikTok đang được hoàn thiện, sắp ra mắt.',
  },
  {
    question: 'Có dùng được dữ liệu từ phần mềm bán hàng đang dùng không?',
    answer:
      'Có thể nhập danh mục từ Excel hoặc CSV. Tích hợp KiotViet (Beta) đồng bộ sản phẩm và tồn kho theo chi nhánh, đẩy đơn và đồng bộ khách. Đội kỹ thuật có thể kết nối hệ thống riêng qua API công khai và webhook có chữ ký (gói Sales Pro, Sales Neo). Sapo, Haravan, Pancake POS sắp có.',
  },
  {
    question: 'Bot lấy giá và tồn kho từ đâu?',
    answer:
      'Từ dữ liệu của chính doanh nghiệp: hồ sơ doanh nghiệp, câu hỏi thường gặp, tài liệu và danh mục. Giá, tồn kho và ngày trống đều được tra qua công cụ trước khi trả lời, bot không tự đoán.',
  },
  {
    question: 'Bot có tự tạo đơn khi khách chưa đồng ý không?',
    answer:
      'Không. Bot gửi tóm tắt đơn kèm nút xác nhận. Đơn chỉ được tạo khi khách bấm, mang nhãn “Bot tạo” để nhân viên duyệt trước khi giao.',
  },
  {
    question: 'Khi nào nhân viên có thể tiếp quản?',
    answer:
      'Bất cứ lúc nào. Nhân viên tắt bot cho từng hội thoại và trả lời ngay trong hộp thư. Khi bot thấy cần người, Rapiz gửi thông báo đẩy kèm lý do và tóm tắt cuộc trao đổi.',
  },
  {
    question: 'Cài đặt mất bao lâu, có cần biết lập trình không?',
    answer:
      'Không cần lập trình. Kết nối fanpage, chọn bộ mẫu theo ngành, nhập danh mục từ Excel và chat thử. Bộ mẫu điền sẵn phần lớn nội dung, Trợ lý Rapiz giúp điền phần còn lại để chủ doanh nghiệp duyệt.',
  },
  {
    question: 'Trợ lý Rapiz làm được gì?',
    answer:
      'Chủ doanh nghiệp hỏi số liệu bằng tiếng Việt và nhận biểu đồ, đặt báo cáo hoặc cảnh báo định kỳ qua chuông, email, thông báo đẩy, hỏi vì sao bot trả lời như vậy để nhận đề xuất sửa, nhập sản phẩm từ Excel hoặc CSV. Mọi thay đổi đều chờ chủ doanh nghiệp duyệt.',
  },
  {
    question: 'Bot dùng AI của ai?',
    answer:
      'Rapiz dùng nhiều nhà cung cấp AI và chọn mô hình theo gói. Doanh nghiệp cũng có thể dùng gói ChatGPT của mình.',
  },
  {
    question: 'Dữ liệu của doanh nghiệp được bảo vệ thế nào?',
    answer:
      'Mỗi doanh nghiệp có không gian dữ liệu riêng, tách ở tầng cơ sở dữ liệu; thành viên chỉ thấy doanh nghiệp họ được mời vào. Chủ doanh nghiệp phân quyền cho thành viên, bật xác thực hai lớp và xem nhật ký thao tác. Dữ liệu một doanh nghiệp không được dùng để trả lời khách của doanh nghiệp khác.',
  },
  {
    question: 'Rapiz có cam kết tuân thủ tiêu chuẩn bảo mật nào không?',
    answer:
      'Website Rapiz chỉ liệt kê những biện pháp đang chạy trong sản phẩm. Nếu doanh nghiệp cần hồ sơ bảo mật cho thẩm định, anh/chị có thể đặt lịch trao đổi với Rapiz.',
  },
  {
    question: 'Buổi demo gồm những gì, có mất phí không?',
    answer:
      'Buổi demo riêng 30 phút, không mất phí: cài thử trên một phần danh mục và chính sách của anh/chị, chat thử bằng chính câu khách hay hỏi, xem hộp thư, bàn giao cho nhân viên và Trợ lý Rapiz, rồi tư vấn gói theo số thành viên, kênh và lượng tin nhắn.',
  },
  {
    question: 'Cần chuẩn bị gì cho buổi demo?',
    answer:
      'Vài sản phẩm hoặc dịch vụ kèm giá, chính sách đổi trả hoặc huỷ lịch, và năm câu khách hay hỏi nhất.',
  },
  {
    question: 'Khi nào có Zalo và TikTok?',
    answer: 'Cả hai đang được hoàn thiện. Nhãn “Sắp ra mắt” sẽ được bỏ khi kết nối chạy thật.',
  },
  {
    question: 'Webhook có chữ ký là gì?',
    answer:
      'Mỗi sự kiện Rapiz gửi đi kèm chữ ký để hệ thống của doanh nghiệp kiểm tra đúng là từ Rapiz và không bị sửa trên đường truyền.',
  },
];
