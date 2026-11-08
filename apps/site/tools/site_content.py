"""Copy and data for the Rapiz sub-pages.

Every claim here must match FEATURES.vi.md: only running features are promised, Beta and
upcoming ones carry their label, no competitor names, and every chat, order or number is
marked as an illustration. Plan prices and limits come from the product's plan catalogue
(agent-sale, packages/db/migrations/0015_billing.sql, plan version 1).
"""

SITE_URL = 'https://rapiz.io/'
SIGNUP_URL = '/signup'
LOGIN_URL = '/login'


def vnd(n: int) -> str:
    return f'{n:,}'.replace(',', '.') + 'đ'


# ---------- navigation ----------

INDUSTRY_LINKS = [
    {'slug': 'nganh/ban-le', 'name': 'Bán lẻ online', 'blurb': 'Tư vấn size, tra tồn và chốt đơn trong chat.'},
    {'slug': 'nganh/villa-homestay', 'name': 'Villa & homestay', 'blurb': 'Xem ngày trống, báo giá theo gói, giữ chỗ.'},
    {'slug': 'nganh/spa-salon', 'name': 'Spa, salon, thẩm mỹ', 'blurb': 'Tư vấn dịch vụ và ghi lịch hẹn đủ thông tin.'},
    {'slug': 'nganh/giao-duc', 'name': 'Trung tâm giáo dục', 'blurb': 'Ghi danh test trình độ và học thử.'},
    {'slug': 'nganh/phan-mem', 'name': 'Phần mềm, SaaS', 'blurb': 'Nhận yêu cầu demo, dùng thử; theo dõi MRR.'},
]
FEATURE_LINKS = [
    {'slug': 'tinh-nang/ban-hang-ai', 'name': 'Bot bán hàng AI', 'blurb': 'Chốt đơn bằng nút xác nhận, không bịa giá.'},
    {'slug': 'tinh-nang/binh-luan-facebook', 'name': 'Bình luận Facebook', 'blurb': 'Trả lời theo bài đăng, nhắn riêng, ẩn bình luận xấu.'},
    {'slug': 'tinh-nang/hop-thu', 'name': 'Hộp thư đội sale', 'blurb': 'Bot và người làm chung, tiếp quản một chạm.'},
    {'slug': 'tinh-nang/dao-tao-ai', 'name': 'Đào tạo AI', 'blurb': 'Dạy bot như dạy nhân viên mới, có lịch sử.'},
    {'slug': 'tinh-nang/tro-ly-rapiz', 'name': 'Trợ lý Rapiz', 'blurb': 'Hỏi số liệu bằng tiếng Việt, nhận biểu đồ.'},
    {'slug': 'tinh-nang/khach-hang-thong-ke', 'name': 'Khách hàng & thống kê', 'blurb': 'Từ hội thoại đến đơn, đo được từng bước.'},
]
NAV_PLAIN = [('Tích hợp', 'tich-hop'), ('Bảng giá', 'bang-gia')]
FOOT_PLATFORM = [
    ('Tích hợp & kênh', 'tich-hop', None),
    ('Bảo mật & dữ liệu', 'bao-mat', None),
    ('Bảng giá', 'bang-gia', None),
    ('Câu hỏi thường gặp', '#questions', None),
]
FOOT_ACCOUNT = [
    ('Bắt đầu miễn phí', SIGNUP_URL, None),
    ('Đăng nhập', LOGIN_URL, None),
    ('Đặt lịch demo', 'dat-lich-demo', None),
]

LINK_INDEX = {}
for _l in INDUSTRY_LINKS:
    LINK_INDEX[_l['slug']] = {**_l, 'group': 'Giải pháp'}
for _l in FEATURE_LINKS:
    LINK_INDEX[_l['slug']] = {**_l, 'group': 'Tính năng'}
LINK_INDEX['tich-hop'] = {'name': 'Tích hợp & kênh', 'blurb': 'Messenger, website, KiotViet, API và webhook.', 'group': 'Nền tảng'}
LINK_INDEX['bao-mat'] = {'name': 'Bảo mật & dữ liệu', 'blurb': 'Dữ liệu tách riêng, phân quyền, 2FA, nhật ký.', 'group': 'Nền tảng'}
LINK_INDEX['bang-gia'] = {'name': 'Bảng giá', 'blurb': 'Bắt đầu miễn phí, nâng gói khi đội lớn lên.', 'group': 'Nền tảng'}


# ---------- icons (24px grid, 2px stroke) ----------

def _svg(body: str) -> str:
    return ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
            f'stroke-linecap="round" stroke-linejoin="round">{body}</svg>')


ICONS = {
    'check': _svg('<path d="M4 12.5 9 17.5 20 6.5"/>'),
    'calc': _svg('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2M12 11h2M16 11v6M8 15h2M12 15h2"/>'),
    'data': _svg('<ellipse cx="12" cy="5.5" rx="7" ry="2.5"/><path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/>'),
    'search': _svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
    'image': _svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-9 9"/>'),
    'plug': _svg('<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v4"/>'),
    'hand': _svg('<circle cx="9" cy="7" r="3.5"/><path d="M3 20c.6-3.4 3-5.5 6-5.5 1.5 0 2.8.5 3.9 1.3M15 15h6M18 12l3 3-3 3"/>'),
    'comment': _svg('<path d="M4 5h16v11H10l-5 4v-4H4z"/><path d="M8 9.5h8M8 12.5h5"/>'),
    'chart': _svg('<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>'),
    'calendar': _svg('<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17M8 14h3"/>'),
    'shield': _svg('<path d="M12 3 5 6v5c0 4.6 3 8.4 7 10 4-1.6 7-5.4 7-10V6z"/><path d="m9 12 2 2 4-4"/>'),
    'inbox': _svg('<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5.5 5h13L21 13v6H3v-6z"/>'),
    'phone': _svg('<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18h2"/>'),
    'book': _svg('<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 7h6"/>'),
    'history': _svg('<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 4v4h4M12 8v4l3 2"/>'),
    'memory': _svg('<path d="M4 6h16M4 12h10M4 18h7"/><path d="m16 16 2 2 4-4"/>'),
    'users': _svg('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.5-3.2 2.8-5 6-5s5.5 1.8 6 5M16 5a3 3 0 0 1 0 6M18 15c1.8.6 2.8 2.2 3 5"/>'),
    'bell': _svg('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
}


# ---------- pricing ----------

TERMS = [('3', ''), ('6', ''), ('12', 'tiết kiệm nhất')]
PLANS = [
    {
        'code': 'free', 'name': 'Miễn phí', 'prices': None, 'cta': 'Tạo tài khoản',
        'for': 'Một người, một fanpage. Đủ để thử bot với khách thật.',
        'ticks': ['1.000 lượt trả lời AI mỗi 14 ngày', '1 thành viên, tối đa 3 kênh', 'Inbox, đào tạo AI, chốt đơn trong chat', 'Trợ lý Rapiz cho chủ shop'],
    },
    {
        'code': 'sales_smart', 'name': 'Sales Smart', 'cta': 'Chọn Sales Smart',
        'prices': {'3': 1310000, '6': 1050000, '12': 785000},
        'for': 'Shop và cơ sở dịch vụ có đội sale nhỏ.',
        'ticks': ['7.000 lượt trả lời AI mỗi 30 ngày', '5 thành viên, 5 kênh', 'Bình luận Facebook theo bài đăng', 'Khung chat website, 10 GB ảnh và tệp'],
    },
    {
        'code': 'sales_pro', 'name': 'Sales Pro', 'cta': 'Chọn Sales Pro', 'featured': True, 'badge': 'Phù hợp đội đang lớn',
        'prices': {'3': 1624000, '6': 1299000, '12': 974000},
        'for': 'Nhiều fanpage, nhiều chi nhánh, cần kết nối hệ thống.',
        'ticks': ['Mọi thứ trong Sales Smart', '15 thành viên, 20 kênh', 'Thêm mô hình AI Pro', 'API công khai và webhook có chữ ký'],
    },
    {
        'code': 'sales_neo', 'name': 'Sales Neo', 'cta': 'Chọn Sales Neo',
        'prices': {'3': 2499000, '6': 1999000, '12': 1624000},
        'for': 'Chuỗi và doanh nghiệp nhiều thương hiệu.',
        'ticks': ['Mọi thứ trong Sales Pro', '30 thành viên, 100 kênh', 'Không giới hạn khách hàng', 'Thêm mô hình AI Neo, 100 GB lưu trữ'],
    },
]
PLANS_FOOT = ('Một lượt trả lời AI là một câu trả lời bot gửi tới khách; tin nhắn của nhân viên không bị tính. '
              'Hạn mức dùng chung cho mọi doanh nghiệp trong một tài khoản. Khi hết lượt trong chu kỳ, hội thoại mới tự chuyển '
              'cho nhân viên, bot không trả lời thay.')
COMPARE = [
    'Đội ngũ và dữ liệu',
    ('Thành viên', '1', '5', '15', '30'),
    ('Kênh kết nối', '3', '5', '20', '100'),
    ('Khách hàng lưu trữ', '5.000', '20.000', '50.000', 'Không giới hạn'),
    ('Dung lượng ảnh và tệp', 'Không', '10 GB', '30 GB', '100 GB'),
    ('Ảnh trong thư viện bot', '10', '200', '200', '600'),
    'AI',
    ('Lượt trả lời AI', '1.000 / 14 ngày', '7.000 / 30 ngày', '7.000 / 30 ngày', '7.000 / 30 ngày'),
    ('Mô hình AI', 'Smart', 'Smart', 'Smart, Pro', 'Smart, Pro, Neo'),
    ('Mục kiến thức cho bot', '500', '500', '500', '500'),
    'Kênh và tính năng',
    ('Messenger, inbox đội sale', True, True, True, True),
    ('Bình luận Facebook theo bài đăng', False, True, True, True),
    ('Khung chat trên website', False, True, True, True),
    ('Trợ lý Rapiz, báo cáo định kỳ', True, True, True, True),
    ('API công khai, webhook', False, False, True, True),
]


# ---------- demo form ----------

FORM_INDUSTRIES = [
    ('ban-le', 'Bán lẻ online'), ('villa-homestay', 'Villa, homestay, lưu trú'), ('spa-salon', 'Spa, salon, thẩm mỹ'),
    ('giao-duc', 'Giáo dục, trung tâm'), ('phan-mem', 'Phần mềm, SaaS'), ('khac', 'Ngành khác'),
]
FORM_PLANS = [('', 'Chưa chắc, cần tư vấn')] + [(p['code'], p['name']) for p in PLANS]
FORM_CHANNELS = ['Messenger', 'Bình luận Facebook', 'Instagram', 'Website', 'Zalo', 'TikTok']


# ---------- shared FAQ answers ----------

FAQ_HANDOFF = ('Khi nào nhân viên tiếp quản được?',
               'Bất cứ lúc nào. Nhân viên tắt bot cho từng hội thoại và trả lời ngay trong hộp thư. Khi bot thấy cần người, '
               'Rapiz gửi thông báo đẩy kèm lý do và tóm tắt cuộc trao đổi.')
FAQ_DATA = ('Bot lấy giá và thông tin từ đâu?',
            'Từ dữ liệu của chính bạn: hồ sơ doanh nghiệp, câu hỏi thường gặp, tài liệu và danh mục. Giá, tồn kho và ngày trống '
            'đều được tra qua công cụ trước khi trả lời, bot không tự đoán.')
FAQ_TRY = ('Tôi có thể thử trước khi trả tiền không?',
           'Có. Gói Miễn phí không giới hạn thời gian, có 1.000 lượt trả lời AI mỗi 14 ngày. Bạn kết nối fanpage, chat thử với bot '
           'giống như trên Messenger, rồi mới bật cho khách thật.')


# ---------- pages ----------

def related(*slugs):
    return {'kind': 'related', 'slugs': list(slugs)}


PAGES = []

# ===== industries =====

PAGES.append({
    'slug': 'nganh/ban-le', 'group': 'Giải pháp · Bán lẻ online',
    'title': 'Bán lẻ online: tư vấn và chốt đơn trong chat | Rapiz',
    'description': 'Rapiz tra danh mục, giá và tồn kho của shop, gửi ảnh sản phẩm thật và gửi tóm tắt đơn để khách bấm xác nhận ngay trong Messenger.',
    'h1': 'Khách hỏi size.<br><em>Đơn đã lên.</em>',
    'deck': 'Rapiz tra danh mục, giá và tồn kho của shop, gửi ảnh sản phẩm thật, rồi gửi tóm tắt đơn để khách bấm xác nhận. Đơn vào hệ thống, giữ tồn và chờ nhân viên duyệt.',
    'demo_query': '?nganh=ban-le',
    'points': ['Hiểu tin nhắn không dấu', 'Đơn chỉ tạo khi khách bấm xác nhận'],
    'visual': {'img': 'rapiz-retail.webp', 'w': 840, 'h': 1050, 'alt': 'Nhân viên shop thời trang kiểm tra đơn hàng bên giá treo áo',
               'card': ('Rapiz Agent · Minh họa', 'Đơn chờ duyệt: 2 áo · 465.000đ')},
    'blocks': [
        {'kind': 'pains', 'kicker': 'VÌ SAO KHÁCH BỎ ĐI', 'h2': 'Inbox chậm một nhịp,<br><em>đơn sang shop khác.</em>',
         'lead': 'Ba tình huống quen thuộc của shop chạy quảng cáo tin nhắn.',
         'items': [
             ('Tin nhắn dồn khi quảng cáo chạy', 'Quảng cáo ra số vào buổi tối, hàng chục khách hỏi cùng lúc. Chờ vài phút, khách đã nhắn shop khác.'),
             ('Báo nhầm giá, nhầm tồn', 'Nhân viên nhớ bảng giá cũ hoặc báo còn hàng khi kho đã hết, đơn phải huỷ và xin lỗi khách.'),
             ('Khách gõ không dấu, viết tắt', '“ao thun trang con L ko” vẫn là một đơn hàng, nếu có người hiểu và trả lời ngay lúc đó.'),
         ]},
        {'kind': 'player', 'kicker': 'XEM MỘT ĐƠN HÀNG', 'h2': 'Một đơn hàng,<br><em>xem từng bước.</em>',
         'lead': 'Hội thoại tự chạy khi bạn cuộn tới. Bên trái là việc Rapiz làm ở từng bước.',
         'aside_title': 'Rapiz làm gì trong lúc chat', 'aside': 'Bot tra hoặc tính mọi con số trong câu trả lời bằng công cụ.',
         'steps': ['Tìm đúng sản phẩm và biến thể', 'Gửi ảnh thật từ danh mục', 'Tính tiền bằng máy tính', 'Gửi tóm tắt đơn có nút xác nhận', 'Tạo đơn, giữ tồn, báo nhân viên'],
         'thread': [
             ('c', 'ao thun trang con size L ko shop'),
             ('l', 'Tìm sản phẩm: áo thun cotton trắng · size L · còn 6', 0),
             ('a', 'Dạ còn ạ. Áo thun cotton trắng size L giá 220.000đ. Em gửi chị ảnh thật của mẫu này nhé.'),
             ('l', 'Gửi 2 ảnh từ thư viện sản phẩm', 1),
             ('c', 'lay 2 cai, giao q7 nha'),
             ('l', 'Tính tiền: 2 × 220.000đ + phí giao 25.000đ = 465.000đ', 2),
             ('order', {'rows': [('Áo thun cotton trắng · L', '× 2'), ('Tạm tính', '440.000đ'), ('Phí giao Quận 7', '25.000đ')], 'total': ('Tổng', '465.000đ')}, 3),
             ('r', 'Khách đã bấm ✅ Đặt hàng · Đơn mang nhãn “Bot tạo”, giữ 2 áo trong kho, chờ nhân viên duyệt.', 4),
         ]},
        {'kind': 'caps', 'kicker': 'BỘ VIỆC CỦA SHOP', 'h2': 'Những việc Rapiz<br><em>làm thay đội sale.</em>',
         'items': [
             {'icon': 'search', 'title': 'Tìm sản phẩm theo nhu cầu', 'text': 'Khách gõ không dấu, viết tắt hay chỉ tả màu và dáng, Rapiz vẫn ra đúng mẫu và biến thể.', 'proof': '“con mau den ko” → tra tồn theo màu'},
             {'icon': 'data', 'title': 'Giá và tồn từ dữ liệu shop', 'text': 'Giá, biến thể, tồn kho lấy từ danh mục của bạn trước khi trả lời. Không có dữ liệu thì bot nói chưa có.', 'link': 'tinh-nang/ban-hang-ai'},
             {'icon': 'calc', 'title': 'Tính tiền chính xác', 'text': 'Mọi phép tính đi qua máy tính, kể cả khi khách gõ 1,5 hay 500,000.', 'proof': '<span class="mono">2 × 880.000 = 1.760.000đ</span>'},
             {'icon': 'check', 'title': 'Chốt đơn bằng nút bấm', 'text': 'Bot gửi tóm tắt đơn. Đơn chỉ được tạo khi khách bấm ✅ Đặt hàng, nhân viên duyệt trước khi giao.', 'link': 'tinh-nang/ban-hang-ai'},
             {'icon': 'image', 'title': 'Gửi ảnh sản phẩm thật', 'text': 'Chỉ gửi ảnh có trong thư viện sản phẩm của bạn, không lấy ảnh lạ trên mạng.'},
             {'icon': 'comment', 'title': 'Bình luận dưới bài quảng cáo', 'text': 'Trả lời công khai theo đúng sản phẩm trong bài, nhắn riêng báo giá, ẩn bình luận xấu.', 'link': 'tinh-nang/binh-luan-facebook'},
             {'icon': 'hand', 'title': 'Gọi nhân viên đúng lúc', 'text': 'Đổi địa chỉ sau khi chốt, khiếu nại, xin giảm giá: bot chuyển người kèm lý do và tóm tắt.', 'link': 'tinh-nang/hop-thu'},
             {'icon': 'plug', 'title': 'Đồng bộ KiotViet', 'status': 'Beta', 'text': 'Lấy sản phẩm và tồn theo chi nhánh, đẩy đơn và khách hàng về KiotViet.', 'link': 'tich-hop'},
         ]},
        {'kind': 'shot', 'kicker': 'MÀN HÌNH THẬT', 'h2': 'Đơn của bot nằm ngay<br><em>cạnh khung chat.</em>',
         'lead': 'Nhân viên đọc lại hội thoại, xem hồ sơ khách và duyệt đơn mà không đổi màn hình.',
         'img': 'ui-inbox-clean.jpg', 'alt': 'Hộp thư Rapiz: danh sách hội thoại, tin nhắn tư vấn và hồ sơ khách hàng bên phải.',
         'caption': 'Ảnh chụp ứng dụng Rapiz với dữ liệu mẫu.'},
        {'kind': 'faq', 'items': [
            ('Bot có tự tạo đơn khi khách chưa đồng ý không?', 'Không. Bot gửi tóm tắt đơn kèm nút ✅ Đặt hàng và nút sửa. Đơn chỉ được tạo khi khách bấm xác nhận, mang nhãn “Bot tạo” để nhân viên duyệt.'),
            ('Tồn kho được xử lý thế nào khi bot tạo đơn?', 'Đơn bot tạo giữ tồn kho cho các biến thể trong đơn. Nhân viên thấy nguồn đơn, trạng thái, có thể sửa món và tách tổng tiền với tiền phải thu.'),
            ('Shop tôi có nhiều màu, nhiều size?', 'Mỗi sản phẩm có biến thể, kho và tồn riêng. Bot tra theo đúng biến thể khách hỏi và báo khi một màu hoặc size đã hết.'),
            ('Nhập sản phẩm có mất nhiều thời gian không?', 'Bạn nhập từ Excel hoặc CSV kèm ảnh. Trợ lý Rapiz đọc tệp, đề xuất danh mục để bạn duyệt một lần là xong.'),
            ('Tôi đang dùng KiotViet, có cần nhập lại không?', 'Tích hợp KiotViet đang ở bản Beta: đồng bộ sản phẩm, tồn theo chi nhánh, đẩy đơn và khách hàng. Hệ thống khác có thể kết nối qua API và webhook.'),
            FAQ_HANDOFF,
        ]},
        related('tinh-nang/ban-hang-ai', 'tinh-nang/binh-luan-facebook', 'tinh-nang/hop-thu'),
        {'kind': 'close', 'h2': 'Thử Rapiz với<br><em>danh mục của shop bạn.</em>', 'demo_query': '?nganh=ban-le'},
    ],
})

PAGES.append({
    'slug': 'nganh/villa-homestay', 'group': 'Giải pháp · Villa & homestay',
    'title': 'Villa, homestay: báo giá, xem ngày trống, giữ chỗ trong chat | Rapiz',
    'description': 'Rapiz xem lịch trống theo từng căn, báo giá theo gói phòng và theo thứ, tạo lượt giữ chỗ có thời hạn để nhân viên xác nhận.',
    'h1': 'Hỏi ngày trống.<br><em>Giữ chỗ ngay.</em>',
    'deck': 'Rapiz xem lịch trống theo từng căn, báo giá theo gói phòng và giá theo thứ, rồi tạo lượt giữ chỗ có thời hạn để nhân viên gọi xác nhận với khách.',
    'demo_query': '?nganh=villa-homestay',
    'points': ['Giá theo gói 4, 5, 6 phòng ngủ', 'Giữ chỗ tự hết hạn', 'Lịch phòng theo tháng, quý, năm'],
    'visual': {'img': 'photo-m61856012-960.jpg', 'w': 960, 'h': 1280, 'alt': 'Phòng ngủ sáng với gối vải sọc và đèn tường',
               'card': ('Rapiz Agent · Minh họa', 'Giữ chỗ Pine Villa · T7 14/11')},
    'blocks': [
        {'kind': 'pains', 'kicker': 'MÙA CAO ĐIỂM', 'h2': 'Khách hỏi lúc nửa đêm,<br><em>căn đẹp không chờ.</em>',
         'items': [
             ('Câu hỏi đến ngoài giờ', 'Khách lên kế hoạch cuối tuần vào buổi tối. Sáng hôm sau trả lời thì họ đã cọc chỗ khác.'),
             ('Giá đổi theo ngày và theo gói', 'Thứ Bảy khác ngày thường, 4 phòng ngủ khác 6 phòng ngủ. Báo nhầm một lần là mất lòng khách.'),
             ('Giữ chỗ bằng lời, trùng lịch', 'Hứa giữ phòng qua tin nhắn nhưng không ghi lên lịch, hai nhóm khách cùng đến một đêm.'),
         ]},
        {'kind': 'player', 'kicker': 'XEM MỘT LƯỢT GIỮ CHỖ', 'h2': 'Tin nhắn lúc nửa đêm<br><em>thành một lượt giữ chỗ.</em>',
         'aside_title': 'Rapiz làm gì trong lúc chat', 'aside': 'Ngày trống và giá đều đọc từ lịch phòng và bảng giá bạn khai báo.',
         'steps': ['Tra lịch trống theo ngày và số khách', 'Báo giá theo gói phòng và thứ', 'Gửi ảnh phòng từ thư viện', 'Tạo giữ chỗ có thời hạn', 'Nhân viên xác nhận và nhận cọc'],
         'thread': [
             ('c', 'cuoi tuan nay con can nao cho 8ng ko a'),
             ('l', 'Tra lịch: tối thứ Bảy 14/11 · 8 khách · 2 căn trống', 0),
             ('a', 'Dạ tối thứ Bảy 14/11 còn Pine Villa, gói 4 phòng ngủ vừa cho 8 khách, giá 4.800.000đ một đêm. Anh muốn xem ảnh phòng ngủ không ạ?'),
             ('l', 'Bảng giá: gói 4 phòng ngủ · giá thứ Bảy', 1),
             ('c', 'gui anh di e'),
             ('l', 'Gửi 3 ảnh phòng ngủ Pine Villa', 2),
             ('c', 'ok giu cho a nhe, sdt 0912 345 678'),
             ('l', 'Tạo giữ chỗ · tự huỷ nếu chưa xác nhận', 3),
             ('a', 'Em đã giữ chỗ Pine Villa tối 14/11 cho anh. Nhân viên sẽ gọi số 0912 345 678 để xác nhận và hướng dẫn đặt cọc trong hôm nay ạ.'),
             ('r', 'Giữ chỗ hiện trên lịch phòng · nhân viên nhận thông báo để gọi xác nhận.', 4),
         ]},
        {'kind': 'caps', 'kicker': 'CHO NGƯỜI VẬN HÀNH LƯU TRÚ', 'h2': 'Lịch phòng và bảng giá<br><em>ở cùng một nơi.</em>',
         'items': [
             {'icon': 'calendar', 'title': 'Lịch trống theo căn', 'text': 'Bot đọc lịch từng căn, từng đêm trước khi trả lời, kể cả khi khách hỏi nhiều đêm liền.'},
             {'icon': 'data', 'title': 'Gói phòng và giá theo thứ', 'text': 'Khai báo gói 6, 5, 4 phòng ngủ và giá theo thứ hoặc khoảng ngày. Bot báo đúng giá của đêm khách chọn.'},
             {'icon': 'history', 'title': 'Giữ chỗ tự hết hạn', 'text': 'Lượt giữ chỗ có thời hạn. Quá hạn mà chưa xác nhận, đêm đó tự mở lại cho khách khác.'},
             {'icon': 'hand', 'title': 'Nhân viên chốt lịch', 'text': 'Rapiz không tự nhận cọc. Nhân viên nhận thông báo, gọi khách và xác nhận theo quy trình của bạn.'},
             {'icon': 'image', 'title': 'Ảnh phòng thật', 'text': 'Gửi ảnh phòng ngủ, hồ bơi, view từ thư viện của từng căn khi khách hỏi.'},
             {'icon': 'book', 'title': 'Trả lời nội quy, tiện ích', 'text': 'Giờ nhận phòng, thú cưng, BBQ, chỗ đỗ xe: bot trả lời theo sổ tay bạn soạn.'},
             {'icon': 'users', 'title': 'Nhiều căn, nhiều cơ sở', 'text': 'Một tài khoản quản lý nhiều cơ sở lưu trú, mỗi nơi một bot và một lịch riêng.'},
             {'icon': 'chart', 'title': 'Hỏi công suất bằng lời', 'text': '“Doanh thu villa tháng 10?” Trợ lý Rapiz trả lời bằng số và biểu đồ.', 'link': 'tinh-nang/tro-ly-rapiz'},
         ]},
        {'kind': 'shot', 'kicker': 'MÀN HÌNH THẬT', 'h2': 'Biết phòng nào trống<br><em>trước khi khách hỏi.</em>',
         'lead': 'Lịch phòng xem theo 2 tuần, tháng, quý hoặc năm; ghi booking, khoá lịch và ghi chú cho từng đêm.',
         'img': 'ui-calendar-clean.jpg', 'alt': 'Lịch phòng Rapiz của một cụm villa với các lượt đặt theo ngày.',
         'caption': 'Ảnh chụp ứng dụng Rapiz với dữ liệu mẫu.'},
        {'kind': 'faq', 'items': [
            ('Bot có tự chốt đặt phòng không?', 'Không. Bot tạo lượt giữ chỗ có thời hạn và báo nhân viên. Việc xác nhận và nhận cọc vẫn do đội của bạn làm.'),
            ('Giữ chỗ hết hạn thì sao?', 'Lượt giữ chỗ chưa được xác nhận sẽ tự hết hạn và đêm đó mở lại trên lịch, tránh giữ phòng ảo.'),
            ('Giá cuối tuần, ngày lễ khai báo thế nào?', 'Bạn đặt giá theo thứ trong tuần và theo khoảng ngày cho từng gói phòng. Bot tính đúng giá của đêm khách hỏi.'),
            ('Tôi có nhiều villa ở nhiều nơi?', 'Một tài khoản quản lý nhiều cơ sở. Mỗi cơ sở có lịch, bảng giá và bot riêng, xem chung trên một màn hình tổng quan.'),
            ('Khách hỏi ngoài lề như BBQ, thú cưng?', 'Bot trả lời theo sổ tay và câu hỏi thường gặp bạn soạn. Chưa có thông tin thì bot nói chưa có và mời nhân viên.'),
            FAQ_HANDOFF,
        ]},
        related('tinh-nang/ban-hang-ai', 'tinh-nang/tro-ly-rapiz', 'tinh-nang/hop-thu'),
        {'kind': 'close', 'h2': 'Cho bot đọc<br><em>lịch phòng của bạn.</em>', 'demo_query': '?nganh=villa-homestay'},
    ],
})

PAGES.append({
    'slug': 'nganh/spa-salon', 'group': 'Giải pháp · Spa, salon, thẩm mỹ',
    'title': 'Spa, salon, thẩm mỹ: tư vấn dịch vụ và đặt lịch trong chat | Rapiz',
    'description': 'Rapiz tư vấn dịch vụ theo bảng giá của bạn, ghi lịch hẹn đủ dịch vụ, chi nhánh, ngày giờ, số người và chuyển lễ tân xác nhận.',
    'h1': 'Hỏi dịch vụ.<br><em>Có lịch hẹn.</em>',
    'deck': 'Rapiz tư vấn dịch vụ theo bảng giá của bạn, ghi lịch hẹn đủ dịch vụ, chi nhánh, ngày giờ và số người, rồi chuyển lễ tân xác nhận.',
    'demo_query': '?nganh=spa-salon',
    'points': ['Lịch hẹn đủ dịch vụ, chi nhánh, ngày giờ, số người', 'Không nhận ngày đã qua'],
    'visual': {'img': 'rapiz-spa.webp', 'w': 840, 'h': 1050, 'alt': 'Không gian spa với giường chăm sóc và ánh sáng ấm',
               'card': ('Rapiz Agent · Minh họa', 'Lịch hẹn: T7 10:00 · Quận 3 · 2 người')},
    'blocks': [
        {'kind': 'pains', 'kicker': 'KHÁCH ĐẾN TỪ INBOX', 'h2': 'Hỏi giá rồi im lặng<br><em>là lịch hẹn bị lỡ.</em>',
         'items': [
             ('Hỏi giá xong là đi', 'Khách so giá nhiều nơi. Nơi trả lời nhanh và gợi ý được giờ trống thường giữ được khách.'),
             ('Lịch hẹn thiếu thông tin', 'Ghi “chị Lan, thứ Bảy” mà thiếu dịch vụ, chi nhánh, số người. Lễ tân phải nhắn hỏi lại.'),
             ('Đặt nhầm ngày đã qua', 'Khách nhắn “thứ 7” vào tối Chủ nhật. Không ai để ý, lịch rơi vào một ngày đã qua.'),
         ]},
        {'kind': 'player', 'kicker': 'XEM MỘT LỊCH HẸN', 'h2': 'Bot hỏi cho đủ<br><em>rồi mới ghi lịch.</em>',
         'aside_title': 'Rapiz làm gì trong lúc chat', 'aside': 'Thiếu thông tin nào, bot hỏi tiếp thông tin đó thay vì đoán.',
         'steps': ['Tư vấn dịch vụ theo bảng giá', 'Hỏi chi nhánh và giờ', 'Kiểm tra ngày không nằm trong quá khứ', 'Thu số điện thoại', 'Ghi yêu cầu hẹn vào CRM'],
         'channel': 'Messenger',
         'thread': [
             ('c', 't7 nay dat goi dau duong sinh 2ng dc ko e'),
             ('l', 'Tra dịch vụ: gội đầu dưỡng sinh 60 phút', 0),
             ('a', 'Dạ được ạ. Gội đầu dưỡng sinh 60 phút giá 180.000đ một người. Chị muốn đến chi nhánh nào và khoảng mấy giờ ạ?', 1),
             ('c', 'q3, tam 10h'),
             ('l', 'Thứ Bảy 14/11 · 10:00 · còn trong tương lai', 2),
             ('a', 'Em ghi nhận gội dưỡng sinh cho 2 người lúc 10h thứ Bảy 14/11 tại chi nhánh Quận 3. Chị cho em xin số điện thoại để lễ tân xác nhận nhé.'),
             ('c', '0901 234 567'),
             ('l', 'Lưu số điện thoại vào hồ sơ khách', 3),
             ('r', 'Đã tạo yêu cầu đặt lịch: dịch vụ, chi nhánh, ngày giờ, 2 người, số điện thoại. Lễ tân Quận 3 nhận thông báo.', 4),
         ]},
        {'kind': 'caps', 'kicker': 'CHO LỄ TÂN VÀ CHỦ CƠ SỞ', 'h2': 'Ít tin nhắn hỏi lại,<br><em>nhiều lịch đủ thông tin.</em>',
         'items': [
             {'icon': 'calendar', 'title': 'Lịch hẹn đủ trường', 'text': 'Dịch vụ, chi nhánh, ngày giờ, số người và số điện thoại. Thiếu gì bot hỏi tiếp cái đó.'},
             {'icon': 'shield', 'title': 'Không nhận ngày đã qua', 'text': 'Bot đối chiếu ngày khách chọn với hôm nay, tránh lịch rơi vào quá khứ.'},
             {'icon': 'book', 'title': 'Tư vấn theo bảng giá', 'text': 'Giá, thời lượng, combo và lưu ý trước dịch vụ đều lấy từ tài liệu bạn đưa vào.'},
             {'icon': 'hand', 'title': 'Huỷ, đổi lịch về lễ tân', 'text': 'Yêu cầu huỷ hoặc đổi giờ được chuyển cho người xử lý kèm tóm tắt.'},
             {'icon': 'users', 'title': 'Nhiều chi nhánh', 'text': 'Mỗi chi nhánh có thông tin riêng; khách chọn nơi gần nhất, lịch về đúng nơi.'},
             {'icon': 'data', 'title': 'Trạng thái khách theo ngành', 'text': 'Khách mới, đã hẹn, đã đến: CRM theo dõi theo đúng quy trình spa.', 'link': 'tinh-nang/khach-hang-thong-ke'},
             {'icon': 'comment', 'title': 'Bình luận dưới bài ưu đãi', 'text': 'Trả lời giá ngay dưới bài, mời khách vào inbox để giữ giờ.', 'link': 'tinh-nang/binh-luan-facebook'},
             {'icon': 'bell', 'title': 'Báo cáo sáng mỗi ngày', 'text': '“8h sáng gửi tôi số lịch hẹn hôm nay.” Trợ lý Rapiz gửi qua chuông, email hoặc thông báo đẩy.', 'link': 'tinh-nang/tro-ly-rapiz'},
         ]},
        {'kind': 'shot', 'kicker': 'MÀN HÌNH THẬT', 'h2': 'Lịch hẹn hiện ngay<br><em>trong hồ sơ khách.</em>',
         'lead': 'Khách nhắn không dấu, bot hỏi số điện thoại và cơ sở, CRM ghi “Yêu cầu đặt lịch”.',
         'img': 'ui-inbox-clean.jpg', 'alt': 'Hộp thư Rapiz với hội thoại đặt lịch spa và trạng thái yêu cầu đặt lịch trong hồ sơ khách.',
         'caption': 'Ảnh chụp ứng dụng Rapiz với dữ liệu mẫu.'},
        {'kind': 'faq', 'items': [
            ('Bot có xác nhận lịch thay lễ tân không?', 'Bot ghi nhận yêu cầu hẹn với đủ thông tin và báo cho lễ tân. Lễ tân xác nhận lại với khách theo lịch thực tế của cơ sở.'),
            ('Khách nhắn “thứ 7” mà không nói ngày?', 'Bot quy đổi sang ngày cụ thể và nhắc lại để khách kiểm tra, không nhận ngày đã qua.'),
            ('Tôi có 3 chi nhánh, giá khác nhau?', 'Mỗi chi nhánh có thông tin, bảng giá và giờ làm việc riêng. Yêu cầu hẹn mang tên chi nhánh khách chọn.'),
            ('Khách hỏi về liệu trình, chống chỉ định?', 'Bot trả lời theo tài liệu bạn cung cấp. Câu hỏi cần chuyên môn sẽ được chuyển cho nhân viên tư vấn.'),
            FAQ_DATA,
            FAQ_HANDOFF,
        ]},
        related('tinh-nang/khach-hang-thong-ke', 'tinh-nang/dao-tao-ai', 'tinh-nang/tro-ly-rapiz'),
        {'kind': 'close', 'h2': 'Thử với bảng giá<br><em>dịch vụ của bạn.</em>', 'demo_query': '?nganh=spa-salon'},
    ],
})

PAGES.append({
    'slug': 'nganh/giao-duc', 'group': 'Giải pháp · Trung tâm giáo dục',
    'title': 'Trung tâm giáo dục: tư vấn lộ trình, ghi danh học thử | Rapiz',
    'description': 'Rapiz tư vấn chương trình, ghi danh test trình độ và học thử, nhận đăng ký phụ huynh làm cho con và chuyển hồ sơ cho tư vấn viên.',
    'h1': 'Phụ huynh hỏi lớp.<br><em>Con có buổi học thử.</em>',
    'deck': 'Rapiz tư vấn chương trình, ghi danh test trình độ hoặc học thử, nhận đăng ký phụ huynh làm cho con. Tư vấn viên nhận hồ sơ đủ thông tin để xếp lớp.',
    'demo_query': '?nganh=giao-duc',
    'points': ['Phụ huynh đăng ký cho con'],
    'visual': {'img': 'rapiz-education.webp', 'w': 840, 'h': 1050, 'alt': 'Lớp học nhỏ với học sinh và giáo viên',
               'card': ('Rapiz Agent · Minh họa', 'Học thử: lớp 8 · thứ Bảy')},
    'blocks': [
        {'kind': 'pains', 'kicker': 'MÙA TUYỂN SINH', 'h2': 'Phụ huynh hỏi buổi tối,<br><em>tư vấn viên đã về.</em>',
         'items': [
             ('Hỏi sau giờ làm', 'Phụ huynh tìm hiểu sau bữa tối. Sáng hôm sau gọi lại thì họ đã đăng ký học thử nơi khác.'),
             ('Câu hỏi lặp lại mỗi ngày', 'Học phí, sĩ số, lịch khai giảng, giáo viên bản ngữ: cùng một bộ câu hỏi, trả lời hàng trăm lần.'),
             ('Hồ sơ thiếu thông tin', 'Thiếu tên con, lớp, nguyện vọng. Tư vấn viên phải gọi hỏi lại trước khi xếp được buổi test.'),
         ]},
        {'kind': 'player', 'kicker': 'XEM MỘT LƯỢT GHI DANH', 'h2': 'Phụ huynh nhắn vài dòng,<br><em>tư vấn viên có đủ hồ sơ.</em>',
         'aside_title': 'Rapiz làm gì trong lúc chat', 'aside': 'Bot hỏi đủ thông tin học sinh để tư vấn viên xếp lớp ngay.',
         'steps': ['Tư vấn chương trình phù hợp', 'Hỏi thông tin học sinh', 'Ghi nguyện vọng học thử', 'Thu số điện thoại phụ huynh', 'Chuyển hồ sơ cho tư vấn viên'],
         'channel': 'Messenger',
         'thread': [
             ('c', 'be lop 8 hoc thu t.anh giao tiep t7 dc ko'),
             ('l', 'Tra chương trình: giao tiếp THCS · học thử thứ Bảy', 0),
             ('a', 'Dạ được ạ. Trung tâm có lớp giao tiếp cho học sinh THCS, học thử miễn phí 1 buổi vào sáng thứ Bảy. Anh/chị cho em xin tên của bé ạ?'),
             ('c', 'be ten Minh Anh'),
             ('l', 'Hồ sơ: Minh Anh · lớp 8 · phụ huynh đăng ký', 1),
             ('a', 'Em ghi nhận bé Minh Anh, lớp 8, muốn học thử giao tiếp sáng thứ Bảy. Anh/chị cho em xin số điện thoại để tư vấn viên xếp ca nhé.', 2),
             ('c', '0987 654 321'),
             ('l', 'Lưu số điện thoại phụ huynh', 3),
             ('r', 'Đã ghi danh học thử: học sinh, lớp, chương trình, ca mong muốn, số điện thoại phụ huynh. Tư vấn viên nhận thông báo.', 4),
         ]},
        {'kind': 'caps', 'kicker': 'CHO ĐỘI TƯ VẤN TUYỂN SINH', 'h2': 'Câu hỏi lặp lại<br><em>để bot trả lời.</em>',
         'items': [
             {'icon': 'book', 'title': 'Tư vấn lộ trình', 'text': 'Học phí, sĩ số, lịch khai giảng, giáo trình: bot trả lời theo tài liệu của trung tâm.'},
             {'icon': 'calendar', 'title': 'Ghi danh test và học thử', 'text': 'Nhận đăng ký test trình độ hoặc buổi học thử, kèm ca học mong muốn.'},
             {'icon': 'users', 'title': 'Phụ huynh đăng ký cho con', 'text': 'Tách thông tin người liên hệ và học sinh: tên con, lớp, nguyện vọng.'},
             {'icon': 'hand', 'title': 'Chuyển tư vấn viên', 'text': 'Câu hỏi về học bổng, chuyển lớp, hoàn học phí được chuyển cho người kèm tóm tắt.'},
             {'icon': 'data', 'title': 'Trạng thái tuyển sinh', 'text': 'Mới hỏi, đã hẹn test, đã học thử, đã đăng ký: CRM theo dõi theo ngành giáo dục.', 'link': 'tinh-nang/khach-hang-thong-ke'},
             {'icon': 'chart', 'title': 'Báo cáo đăng ký theo tuần', 'text': '“Tuần này bao nhiêu lượt học thử?” Trợ lý Rapiz trả lời bằng số và biểu đồ.', 'link': 'tinh-nang/tro-ly-rapiz'},
         ]},
        {'kind': 'faq', 'items': [
            ('Bot có xếp lớp thay tư vấn viên không?', 'Bot ghi nhận nguyện vọng và ca mong muốn. Tư vấn viên xác nhận lịch test hoặc học thử dựa trên lớp thực tế.'),
            ('Phụ huynh và học sinh cùng nhắn thì sao?', 'Hồ sơ tách người liên hệ và học sinh, nên một phụ huynh có thể đăng ký cho một hoặc nhiều con.'),
            ('Trung tâm có nhiều cơ sở?', 'Mỗi cơ sở có thông tin riêng. Hồ sơ ghi cơ sở phụ huynh chọn để chuyển đúng đội tư vấn.'),
            FAQ_DATA,
            FAQ_HANDOFF,
            FAQ_TRY,
        ]},
        related('tinh-nang/khach-hang-thong-ke', 'tinh-nang/dao-tao-ai', 'tinh-nang/hop-thu'),
        {'kind': 'close', 'h2': 'Để bot nhận<br><em>câu hỏi tuyển sinh.</em>', 'demo_query': '?nganh=giao-duc'},
    ],
})

PAGES.append({
    'slug': 'nganh/phan-mem', 'group': 'Giải pháp · Phần mềm, SaaS',
    'title': 'Phần mềm, SaaS: trả lời câu hỏi sản phẩm, nhận yêu cầu demo | Rapiz',
    'description': 'Rapiz trả lời câu hỏi sản phẩm từ tài liệu của bạn, nhận yêu cầu demo hoặc dùng thử kèm quy mô đội và nhu cầu, theo dõi gói, MRR và khách rời bỏ.',
    'h1': 'Khách hỏi tính năng.<br><em>Lịch demo đã có.</em>',
    'deck': 'Rapiz trả lời câu hỏi sản phẩm từ tài liệu của bạn, nhận yêu cầu demo hoặc dùng thử kèm quy mô đội và nhu cầu, và giúp bạn theo dõi gói, MRR và khách rời bỏ.',
    'demo_query': '?nganh=phan-mem',
    'points': ['Khung chat trên website', 'Gọi API của bạn', 'Theo dõi gói và MRR'],
    'visual': {'img': 'rapiz-software.webp', 'w': 840, 'h': 1050, 'alt': 'Đội ngũ phần mềm làm việc trước màn hình',
               'card': ('Rapiz Agent · Minh họa', 'Yêu cầu demo · đội 6 sale')},
    'blocks': [
        {'kind': 'pains', 'kicker': 'PHỄU B2B', 'h2': 'Khách tìm hiểu một mình,<br><em>rồi rời trang.</em>',
         'items': [
             ('Câu hỏi kỹ thuật lúc khuya', 'Người mua đọc trang giá ngoài giờ. Không ai trả lời, họ mở tab đối thủ.'),
             ('Form demo thiếu ngữ cảnh', 'Chỉ có tên và email. Sale gọi lại mà không biết đội mấy người, đang dùng gì, cần gì.'),
             ('Không thấy ai sắp rời bỏ', 'Gói sắp hết hạn, khách ít đăng nhập. Đến khi biết thì họ đã chuyển đi.'),
         ]},
        {'kind': 'player', 'kicker': 'XEM MỘT YÊU CẦU DEMO', 'h2': 'Sale biết đội khách mấy người<br><em>trước buổi demo.</em>',
         'aside_title': 'Rapiz làm gì trong lúc chat', 'aside': 'Bot hỏi đúng những gì sale cần trước buổi demo.',
         'steps': ['Trả lời từ tài liệu sản phẩm', 'Hỏi quy mô đội và hệ thống đang dùng', 'Ghi nhận yêu cầu demo', 'Chuyển chuyên viên kèm tóm tắt'],
         'channel': 'Website',
         'thread': [
             ('c', 'Phần mềm có phân quyền theo nhóm sale không?'),
             ('l', 'Tra tài liệu: phân quyền và vai trò', 0),
             ('a', 'Có ạ. Bạn tạo vai trò và giới hạn từng nhóm chỉ thấy khách hàng của nhóm mình. Đội bạn hiện có bao nhiêu sale và đang quản lý khách bằng công cụ gì ạ?'),
             ('c', 'ben minh 6 sale, dang dung excel. muon xem demo'),
             ('l', 'Hồ sơ: 6 sale · đang dùng Excel · cần phân quyền', 1),
             ('a', 'Mình ghi nhận đội 6 sale, đang quản lý bằng Excel và cần phân quyền theo nhóm. Bạn cho mình xin email công việc để chuyên viên gửi lịch demo nhé.', 2),
             ('c', 'lan@congty.vn'),
             ('r', 'Đã tạo yêu cầu demo kèm quy mô, công cụ hiện tại và nhu cầu. Chuyên viên nhận thông báo.', 3),
         ]},
        {'kind': 'caps', 'kicker': 'CHO ĐỘI SALE VÀ VẬN HÀNH SAAS', 'h2': 'Câu hỏi kỹ thuật<br><em>có câu trả lời ngay.</em>',
         'items': [
             {'icon': 'book', 'title': 'Trả lời từ tài liệu', 'text': 'Đưa tài liệu sản phẩm, bảng giá, câu hỏi thường gặp; bot trả lời trong phạm vi đó.'},
             {'icon': 'comment', 'title': 'Khung chat trên website', 'text': 'Nhúng khung chat khoảng 9 KB vào website, thu số điện thoại và email ngay trong chat.', 'link': 'tich-hop'},
             {'icon': 'calendar', 'title': 'Yêu cầu demo, dùng thử', 'text': 'Ghi nhận quy mô đội, công cụ đang dùng và nhu cầu trước khi chuyển sale.'},
             {'icon': 'plug', 'title': 'Gọi API của bạn', 'text': 'Kiểm tra trạng thái tài khoản hay tạo yêu cầu trong hệ thống của bạn, có bước xác nhận trước khi thực hiện.', 'link': 'tinh-nang/ban-hang-ai'},
             {'icon': 'chart', 'title': 'Gói, MRR, rời bỏ', 'text': 'Theo dõi khách theo gói, doanh thu định kỳ và khách rời bỏ trong cùng nơi với hội thoại.'},
             {'icon': 'data', 'title': 'API công khai, webhook', 'text': 'Đẩy khách hàng và sự kiện sang CRM hay kho dữ liệu của bạn, webhook có chữ ký.', 'status': 'Gói Pro, Neo', 'link': 'tich-hop'},
         ]},
        {'kind': 'faq', 'items': [
            ('Bot có trả lời câu hỏi ngoài tài liệu không?', 'Bot trả lời dựa trên tài liệu và câu hỏi thường gặp bạn cung cấp. Ngoài phạm vi đó, bot nói chưa có thông tin và mời chuyên viên.'),
            ('Gọi API riêng có an toàn không?', 'Mỗi hành động API có bước xác nhận trước khi thực hiện, và Rapiz chặn các lệnh gọi vào mạng nội bộ.'),
            ('Tôi muốn đưa dữ liệu khách về CRM đang dùng?', 'Gói Sales Pro và Sales Neo có API công khai, webhook có chữ ký và tài liệu OpenAPI để kết nối.'),
            FAQ_HANDOFF,
            FAQ_TRY,
        ]},
        related('tich-hop', 'tinh-nang/ban-hang-ai', 'tinh-nang/khach-hang-thong-ke'),
        {'kind': 'close', 'h2': 'Đặt bot lên<br><em>trang giá của bạn.</em>', 'demo_query': '?nganh=phan-mem'},
    ],
})


# ===== features =====

PAGES.append({
    'slug': 'tinh-nang/ban-hang-ai', 'group': 'Tính năng · Bot bán hàng AI',
    'title': 'Bot bán hàng AI: chốt đơn trong chat bằng dữ liệu của bạn | Rapiz',
    'description': 'Bot bán hàng AI tra giá, tồn kho và ngày trống từ dữ liệu của bạn, tính tiền bằng máy tính, gửi tóm tắt đơn để khách bấm xác nhận.',
    'h1': 'Bot bán hàng<br><em>nói đúng giá của bạn.</em>',
    'deck': 'Bot tra giá, tồn kho và ngày trống từ dữ liệu của bạn, tính tiền bằng máy tính, gửi tóm tắt đơn để khách bấm xác nhận, và biết lúc nào cần gọi người.',
    'points': ['Đơn chỉ tạo khi khách xác nhận', 'Tính tiền bằng máy tính', 'Gọi API của bạn có xác nhận'],
    'visual': {'mock': {'type': 'order', 'title': 'Messenger · Rapiz Agent',
                        'before': [('c', 'lay 2 bo do ngu size M nha shop')],
                        'order': {'rows': [('Bộ đồ ngủ lụa · M', '× 2'), ('Tạm tính', '1.760.000đ'), ('Phí giao', '30.000đ')], 'total': ('Tổng', '1.790.000đ')},
                        'after': [('r', 'Đơn được tạo sau khi khách bấm ✅')]}},
    'blocks': [
        {'kind': 'rows', 'kicker': 'CÁCH BOT LÀM VIỆC', 'h2': 'Mỗi câu trả lời<br><em>đều có nguồn.</em>',
         'lead': 'Bot không trả lời bằng kiến thức chung. Giá, tồn, lịch và phép tính đều đi qua công cụ.',
         'rows': [
             {'title': 'Chốt đơn bằng nút xác nhận', 'text': 'Khi khách muốn mua, bot gửi tóm tắt đơn kèm nút ✅ Đặt hàng và nút sửa. Đơn chỉ được tạo khi khách bấm.',
              'ticks': ['Đơn vào hệ thống và giữ tồn kho', 'Đánh dấu “Bot tạo” để nhân viên duyệt', 'Khách sửa số lượng, biến thể trước khi xác nhận'],
              'mock': {'type': 'order', 'title': 'Tóm tắt đơn gửi khách',
                       'order': {'rows': [('Áo thun cotton trắng · L', '× 2'), ('Tạm tính', '440.000đ'), ('Phí giao Quận 7', '25.000đ')], 'total': ('Tổng', '465.000đ')},
                       'after': [('r', 'Khách đã xác nhận · Đơn chờ nhân viên duyệt')]}},
             {'title': 'Tính tiền chính xác', 'text': 'Mọi phép tính đi qua công cụ máy tính, bot không được tự nhẩm. Cách gõ số quen thuộc của người Việt cũng được đọc đúng.',
              'ticks': ['Đọc đúng 1.760.000, 500,000 và 1,5', 'Cộng phí giao, giảm giá theo chính sách bạn khai báo', 'Tách tổng tiền và tiền phải thu'],
              'mock': {'type': 'calc', 'title': 'Phép tính trong một đơn',
                       'before': [('c', 'lay 2 bo, moi bo 880,000 dung ko shop')],
                       'rows': [('2 × 880.000', '1.760.000', False), ('Phí giao', '30.000', False), ('Tổng phải thu', '1.790.000đ', True)],
                       'foot': 'Tính bằng công cụ máy tính, không ước lượng'}},
             {'title': 'Giá, tồn, ngày trống lấy từ dữ liệu của bạn', 'text': 'Trước khi trả lời, bot tra hồ sơ doanh nghiệp, câu hỏi thường gặp và danh mục. Không có dữ liệu thì bot nói chưa có.',
              'mock': {'type': 'kv', 'title': 'Bot tra trước khi trả lời',
                       'rows': [('Áo sơ mi trắng · M', 'Còn 4', 'ok'), ('Áo sơ mi trắng · XL', 'Hết hàng', 'warn'), ('Giá bán', '350.000đ', ''), ('Chính sách đổi size', '7 ngày', '')],
                       'foot': 'Nguồn: danh mục sản phẩm và sổ tay cửa hàng'}},
             {'title': 'Hiểu cách khách nhắn thật', 'text': 'Không dấu, viết tắt, gõ nhầm hay chỉ tả màu và dáng, bot vẫn tìm ra đúng sản phẩm.',
              'mock': {'type': 'chat', 'title': 'Messenger · tin nhắn thật của khách',
                       'thread': [('c', 'ao thun trang con size L ko'), ('l', 'Tìm: áo thun · trắng · L'), ('c', 'con mau den ko'), ('l', 'Tra tồn theo màu: đen · L · còn 3'),
                                  ('a', 'Dạ màu đen size L còn 3 chiếc ạ. Em gửi chị ảnh thật nhé.')]}},
             {'title': 'Gọi API riêng của bạn', 'text': 'Tra đơn, kiểm tra tồn ở hệ thống khác, đặt lịch: bot gọi API bạn khai báo, có bước xác nhận trước khi thực hiện.',
              'ticks': ['Khai báo hành động bằng biểu mẫu, không cần viết code bot', 'Chặn gọi vào mạng nội bộ', 'Trợ lý Rapiz giúp soạn nháp hành động'],
              'mock': {'type': 'kv', 'title': 'Hành động: Tra trạng thái đơn',
                       'rows': [('Phương thức', '<span class="mono">GET /orders/{mã}</span>', ''), ('Xác nhận với khách trước khi gọi', 'Bật', 'ok'), ('Địa chỉ mạng nội bộ', 'Bị chặn', 'warn'), ('Kết quả', 'Đang giao · dự kiến thứ Năm', '')],
                       'foot': 'Ví dụ cấu hình một hành động API'}},
             {'title': 'Nhớ ngữ cảnh khi chat dài', 'text': 'Bot làm nhiều bước trong một lượt trả lời, tra song song, tự sửa khi một bước lỗi và tóm tắt hội thoại dài để không quên điều khách đã nói.',
              'mock': {'type': 'list', 'title': 'Các bước trong một lượt trả lời',
                       'items': [('1', 'Tìm sản phẩm', 'search_products · áo khoác · M', 'xong', 'ok'), ('2', 'Kiểm tra tồn hai màu', 'chạy song song', 'xong', 'ok'),
                                 ('3', 'Tính tiền', 'calculator', 'xong', 'ok'), ('4', 'Soạn câu trả lời', 'dựa trên kết quả các bước', 'gửi', 'hot')],
                       'foot': 'Tối đa 10 bước cho một lượt trả lời'}},
             {'title': 'Gọi nhân viên đúng lúc', 'text': 'Khiếu nại, đổi địa chỉ sau khi chốt, xin ngoại lệ: bot chuyển hội thoại cho người, kèm lý do và tóm tắt. Nhân viên nhận thông báo đẩy ngay.',
              'mock': {'type': 'kv', 'title': 'Ghi chú chuyển giao',
                       'rows': [('Khách', 'Mai Linh · Messenger', ''), ('Yêu cầu', 'Đổi địa chỉ giao sau khi đã chốt', ''), ('Lý do cần người', 'Phải kiểm tra đơn đã bàn giao chưa', 'warn'), ('Thông báo', 'Đã gửi tới 2 nhân viên', 'ok')]}},
         ]},
        {'kind': 'faq', 'items': [
            ('Bot dùng mô hình AI nào?', 'Rapiz dùng nhiều nhà cung cấp AI. Gói Miễn phí và Sales Smart dùng mô hình Smart; Sales Pro thêm Pro; Sales Neo thêm Neo. Bạn cũng có thể dùng gói ChatGPT của mình.'),
            ('Bot trả lời sai thì sao?', 'Hỏi Trợ lý Rapiz vì sao bot trả lời như vậy: trợ lý chỉ ra quy tắc hay dữ liệu đã dùng và đề xuất sửa. Bạn duyệt rồi mới áp dụng.'),
            ('Bot có tự giảm giá cho khách không?', 'Không, trừ khi bạn khai báo chính sách giảm giá. Yêu cầu ngoại lệ được chuyển cho nhân viên.'),
            FAQ_DATA, FAQ_HANDOFF, FAQ_TRY,
        ]},
        related('nganh/ban-le', 'tinh-nang/dao-tao-ai', 'tinh-nang/hop-thu'),
        {'kind': 'close'},
    ],
})

PAGES.append({
    'slug': 'tinh-nang/binh-luan-facebook', 'group': 'Tính năng · Bình luận Facebook',
    'title': 'Trả lời bình luận Facebook theo bài đăng | Rapiz',
    'description': 'Rapiz đọc ngữ cảnh bài đăng để trả lời bình luận công khai, nhắn riêng báo giá và ẩn bình luận xấu, xử lý chung trong hộp thư đội sale.',
    'h1': 'Trả lời bình luận<br><em>theo đúng bài đăng.</em>',
    'deck': 'Rapiz đọc ngữ cảnh bài đăng để trả lời bình luận công khai, nhắn riêng báo giá cho khách và ẩn bình luận xấu. Tất cả hiện chung trong hộp thư đội sale.',
    'points': ['Có trong gói Sales Smart trở lên'],
    'visual': {'mock': {'type': 'comment', 'title': 'Fanpage · bài quảng cáo', 'post_img': 'rapiz-retail.webp', 'page': 'Linen House',
                        'post': 'Áo sơ mi linen mới về, 4 màu, size S đến XL.',
                        'comments': [('user', 'Thu Hà', 'gia sao shop, con mau be size M ko', '', ''),
                                     ('page', 'Linen House', 'Dạ màu be size M còn ạ. Shop đã nhắn riêng giá và ảnh thật cho chị nhé!', 'Rapiz trả lời theo bài đăng', '')],
                        'dm': 'Đã nhắn riêng cho Thu Hà: giá, ảnh màu be, nút đặt hàng'}},
    'blocks': [
        {'kind': 'rows', 'kicker': 'TRẢ LỜI DƯỚI BÀI ĐĂNG', 'h2': 'Trả lời ngay dưới bài,<br><em>chốt trong tin nhắn riêng.</em>',
         'rows': [
             {'title': 'Hiểu bài đăng khách đang bình luận', 'text': '“Giá sao shop” dưới bài áo linen khác với dưới bài váy maxi. Rapiz đọc nội dung bài đăng để trả lời đúng sản phẩm.',
              'mock': {'type': 'comment', 'title': 'Bình luận dưới bài đăng', 'post_img': 'rapiz-spa.webp', 'page': 'Mộc Spa',
                       'post': 'Ưu đãi gội dưỡng sinh 60 phút trong tháng 11.',
                       'comments': [('user', 'Ngọc Trâm', 'gia bn v spa', '', ''),
                                    ('page', 'Mộc Spa', 'Dạ gói gội dưỡng sinh 60 phút đang ưu đãi 180.000đ ạ. Spa đã nhắn riêng để giữ giờ cho chị nhé.', 'Rapiz trả lời theo bài đăng', '')]}},
             {'title': 'Nhắn riêng để chốt', 'text': 'Giá chi tiết, ảnh, tóm tắt đơn được gửi qua tin nhắn riêng, nơi khách có thể đặt hàng hoặc đặt lịch ngay.',
              'mock': {'type': 'chat', 'title': 'Messenger · tin nhắn riêng',
                       'thread': [('a', 'Chào chị Thu Hà, áo sơ mi linen màu be size M giá 390.000đ ạ. Em gửi chị ảnh thật nhé.'), ('l', 'Gửi 2 ảnh màu be'),
                                  ('c', 'lay 1 cai nha'), ('a', 'Dạ em gửi tóm tắt đơn để chị xác nhận ạ.')]}},
             {'title': 'Ẩn bình luận xấu', 'text': 'Bình luận spam, chửi bới hay để lại số điện thoại lừa đảo được ẩn khỏi bài, không xoá dữ liệu.',
              'mock': {'type': 'comment', 'title': 'Kiểm duyệt bình luận', 'post_img': 'rapiz-retail.webp', 'page': 'Linen House',
                       'post': 'Áo sơ mi linen mới về, 4 màu.',
                       'comments': [('user', 'Tài khoản lạ', 'Inbox 09xx để nhận quà miễn phí!!!', 'Đã ẩn: nội dung spam', 'hidden'),
                                    ('user', 'Minh Thư', 'size L con mau trang ko a', '', '')]}},
             {'title': 'Xử lý chung trong hộp thư', 'text': 'Bình luận và tin nhắn nằm chung một hộp thư. Nhân viên xem những bình luận bot chưa trả lời, hoặc tự trả lời khi cần.',
              'mock': {'type': 'list', 'title': 'Hộp thư · bình luận',
                       'items': [('TH', 'Thu Hà', 'Bình luận · Áo sơ mi linen', 'Bot đã trả lời', 'ok'), ('MT', 'Minh Thư', 'Bình luận · Áo sơ mi linen', 'Chờ trả lời', 'hot'),
                                 ('NT', 'Ngọc Trâm', 'Tin nhắn · Gội dưỡng sinh', 'Bot đang chat', 'ai')]}},
         ]},
        {'kind': 'faq', 'items': [
            ('Tính năng này có trong gói nào?', 'Trả lời bình luận theo bài đăng có trong các gói Sales Smart, Sales Pro và Sales Neo.'),
            ('Bot có trả lời mọi bình luận không?', 'Bot trả lời bình luận hỏi về sản phẩm hoặc dịch vụ. Bình luận cần người xử lý được đưa vào hộp thư cho nhân viên.'),
            ('Ẩn bình luận có xoá bình luận không?', 'Không. Bình luận chỉ bị ẩn khỏi bài đăng, bạn có thể xem lại trong hộp thư.'),
            ('Hết lượt trả lời AI thì bình luận thế nào?', 'Bình luận mới được đưa vào danh sách chờ để nhân viên xem, bot không trả lời thay.'),
        ]},
        related('nganh/ban-le', 'tinh-nang/hop-thu', 'tinh-nang/ban-hang-ai'),
        {'kind': 'close'},
    ],
})

PAGES.append({
    'slug': 'tinh-nang/hop-thu', 'group': 'Tính năng · Hộp thư đội sale',
    'title': 'Hộp thư đội sale: bot và nhân viên làm chung | Rapiz',
    'description': 'Hộp thư đa kênh cho đội sale: bật tắt bot từng hội thoại, tiếp quản một chạm, hồ sơ khách và tạo đơn cạnh khung chat, thông báo đẩy trên điện thoại.',
    'h1': 'Bot trả lời trước,<br><em>nhân viên tiếp lời khi cần.</em>',
    'deck': 'Một hộp thư cho Messenger, bình luận và website. Nhân viên thấy bot đang làm gì, tiếp quản một chạm, xem hồ sơ khách và tạo đơn ngay cạnh khung chat.',
    'points': ['Bật, tắt bot từng hội thoại', 'Cài như app trên điện thoại', 'Tự chia khách cho sale'],
    'visual': {'img': 'ui-inbox-clean.jpg', 'w': 2400, 'h': 1345, 'shot': True, 'alt': 'Hộp thư Rapiz với danh sách hội thoại, tin nhắn và hồ sơ khách.'},
    'blocks': [
        {'kind': 'caps', 'kicker': 'MỘT MÀN HÌNH CHO CẢ ĐỘI', 'h2': 'Mọi thứ nhân viên cần<br><em>cạnh khung chat.</em>',
         'items': [
             {'icon': 'inbox', 'title': 'Hộp thư đa kênh', 'text': 'Messenger, bình luận Facebook, website trong một danh sách. Lọc chưa đọc, nhãn, bot và thời gian.'},
             {'icon': 'hand', 'title': 'Tiếp quản một chạm', 'text': 'Tắt bot cho riêng hội thoại này và trả lời ngay. Bật lại khi xong việc.'},
             {'icon': 'users', 'title': 'Hồ sơ khách, tạo đơn', 'text': 'Thông tin khách, đơn gần nhất và nút tạo đơn nằm ngay bên phải khung chat.'},
             {'icon': 'memory', 'title': 'Nháp tự lưu, phím tắt', 'text': 'Nháp không mất khi đổi hội thoại; có chế độ trả lời, nhắc theo dõi và phím tắt.'},
             {'icon': 'comment', 'title': 'Bình luận chung hộp thư', 'text': 'Bình luận dưới bài đăng được xử lý cùng chỗ với tin nhắn.', 'link': 'tinh-nang/binh-luan-facebook'},
             {'icon': 'phone', 'title': 'Cài như app trên điện thoại', 'text': 'Thêm Rapiz vào màn hình chính, nhận thông báo đẩy khi bot cần người.'},
             {'icon': 'bell', 'title': 'Thông báo kèm lý do', 'text': 'Mỗi lần bot chuyển người đều có lý do và tóm tắt, không phải đọc lại từ đầu.'},
             {'icon': 'data', 'title': 'Tự chia khách cho sale', 'text': 'Khách mới được chia cho nhân viên theo chính sách bạn đặt.', 'link': 'tinh-nang/khach-hang-thong-ke'},
         ]},
        {'kind': 'rows', 'cls': 'tint', 'kicker': 'KHI BOT GỌI NGƯỜI', 'h2': 'Nhận bàn giao<br><em>không cần hỏi lại.</em>',
         'rows': [
             {'title': 'Ghi chú chuyển giao', 'text': 'Bot ghi yêu cầu của khách và lý do cần người. Nhân viên đọc ba dòng là nắm được việc.',
              'mock': {'type': 'kv', 'title': 'Chờ tiếp quản',
                       'rows': [('Yêu cầu', 'Đổi địa chỉ giao áo sơ mi', ''), ('Lý do', 'Cần kiểm tra đơn đã bàn giao chưa', 'warn'), ('Đơn gần nhất', 'Áo sơ mi trắng · M', ''), ('Kênh', 'Messenger', '')]}},
             {'title': 'Thông báo đẩy trên điện thoại', 'text': 'Cài Rapiz như một app. Khi bot cần người, điện thoại của nhân viên trực rung ngay, kể cả khi đang không mở máy tính.',
              'mock': {'type': 'list', 'title': 'Thông báo',
                       'items': [('R', 'Bot cần người: Mai Linh', 'Đổi địa chỉ sau khi chốt đơn', 'vừa xong', 'hot'), ('R', 'Đơn mới chờ duyệt', '2 áo thun trắng · 465.000đ', '3 phút', 'ok'),
                                 ('R', 'Giữ chỗ chờ xác nhận', 'Pine Villa · T7 14/11', '12 phút', 'ai')]}},
         ]},
        {'kind': 'faq', 'items': [
            FAQ_HANDOFF,
            ('Nhiều nhân viên cùng trực thì sao?', 'Khách mới được chia theo chính sách bạn đặt. Mỗi thành viên có vai trò riêng; số ghế tuỳ gói.'),
            ('Có app điện thoại không?', 'Rapiz cài được như app trên điện thoại từ trình duyệt và gửi thông báo đẩy khi bot cần người.'),
            ('Bot có trả lời khi nhân viên đang chat không?', 'Không. Khi nhân viên tiếp quản, bot tắt cho hội thoại đó cho tới khi được bật lại.'),
        ]},
        related('tinh-nang/ban-hang-ai', 'tinh-nang/khach-hang-thong-ke', 'tinh-nang/binh-luan-facebook'),
        {'kind': 'close'},
    ],
})

PAGES.append({
    'slug': 'tinh-nang/dao-tao-ai', 'group': 'Tính năng · Đào tạo AI',
    'title': 'Đào tạo AI: dạy bot như dạy nhân viên mới | Rapiz',
    'description': 'Hồ sơ doanh nghiệp có cấu trúc, quy tắc theo tình huống, tài liệu và danh mục riêng từng bot, chat thử giống Messenger, lịch sử và khôi phục phiên bản.',
    'h1': 'Dạy bot như<br><em>dạy nhân viên mới.</em>',
    'deck': 'Điền hồ sơ doanh nghiệp, đưa tài liệu và danh mục, đặt quy tắc theo tình huống, rồi chat thử như trên Messenger. Sửa sai thì khôi phục được phiên bản cũ.',
    'points': ['Bộ mẫu theo ngành', 'Lịch sử và khôi phục', 'Chat thử trên điện thoại', 'Chấm điểm câu trả lời'],
    'visual': {'img': 'ui-training-clean.jpg', 'w': 2400, 'h': 1345, 'shot': True, 'alt': 'Khu vực đào tạo bot Rapiz với hồ sơ doanh nghiệp và chat thử.'},
    'blocks': [
        {'kind': 'steps', 'kicker': 'TỪ TRỐNG ĐẾN SẴN SÀNG', 'h2': 'Bốn phần bot cần học<br><em>trước khi đón khách.</em>',
         'items': [
             ('Hồ sơ doanh nghiệp', 'Địa chỉ, hotline, giờ làm việc, chính sách; tính cách, độ dài câu và cách dùng emoji.'),
             ('Tài liệu và danh mục', 'Câu hỏi thường gặp, tài liệu, catalog và thư viện ảnh riêng cho từng bot.'),
             ('Quy tắc theo tình huống', 'Bật, tắt theo ngữ cảnh: sau khi chốt đơn, khi khách phàn nàn, khi hỏi giá sỉ.'),
             ('Chat thử rồi bật', 'Chat thử hiển thị giống Messenger, cả trên điện thoại, trước khi bot gặp khách thật.'),
         ]},
        {'kind': 'rows', 'cls': 'tint', 'kicker': 'GIỮ BOT ĐÚNG Ý BẠN', 'h2': 'Đổi chính sách hôm nay,<br><em>bot trả lời khác ngay.</em>',
         'rows': [
             {'title': 'Quy tắc và bộ mẫu theo ngành', 'text': 'Bắt đầu từ bộ mẫu cho bán lẻ, lưu trú, spa, giáo dục hoặc phần mềm, rồi chỉnh theo cách shop bạn làm.',
              'mock': {'type': 'list', 'title': 'Quy tắc của bot',
                       'items': [('1', 'Sau khi khách chốt đơn', 'Cảm ơn, nhắc thời gian giao dự kiến', 'Bật', 'ok'), ('2', 'Khách hỏi giá sỉ', 'Chuyển nhân viên kinh doanh', 'Bật', 'ok'),
                                 ('3', 'Khách phàn nàn chất lượng', 'Xin lỗi, xin ảnh, gọi người', 'Bật', 'ok'), ('4', 'Ngoài giờ làm việc', 'Hẹn gọi lại sáng mai', 'Tắt', '')]}},
             {'title': 'Lịch sử chỉnh sửa và khôi phục', 'text': 'Mọi thay đổi hồ sơ, quy tắc, tài liệu đều được ghi lại: ai sửa, sửa gì, lúc nào. Khôi phục bản cũ bằng một nút.',
              'mock': {'type': 'list', 'title': 'Lịch sử chỉnh sửa',
                       'items': [('L', 'Hotline: 0901 → 0902', 'Lan · hôm nay 09:12', 'Hiện tại', 'ok'), ('L', 'Thêm ghi chú: Nghỉ Tết từ 28/1', 'Lan · hôm qua', 'Khôi phục', ''),
                                 ('M', 'Chính sách đổi size: 7 → 14 ngày', 'Minh · 03/11', 'Khôi phục', '')]}},
             {'title': 'Chấm điểm câu trả lời tự động', 'text': 'Bộ đánh giá chạy các câu hỏi mẫu qua bot và chỉ ra câu trả lời lệch dữ liệu, trước khi khách thấy.',
              'mock': {'type': 'kv', 'title': 'Kết quả đánh giá mẫu',
                       'rows': [('Hỏi giá có trong danh mục', 'Đạt', 'ok'), ('Hỏi sản phẩm đã hết', 'Đạt', 'ok'), ('Hỏi phí giao tỉnh', 'Cần bổ sung dữ liệu', 'warn')],
                       'foot': 'Ví dụ báo cáo, không phải số liệu thật'}},
         ]},
        {'kind': 'faq', 'items': [
            ('Tôi không rành công nghệ, có tự đào tạo được không?', 'Được. Bạn điền biểu mẫu bằng tiếng Việt và chọn bộ mẫu theo ngành. Trợ lý Rapiz còn giúp điền thông tin shop và soạn kịch bản để bạn duyệt.'),
            ('Một tài khoản có nhiều bot được không?', 'Có. Mỗi bot có tài liệu, danh mục và thư viện ảnh riêng, ví dụ một bot cho fanpage bán lẻ và một bot cho villa.'),
            ('Lỡ sửa sai quy tắc thì sao?', 'Mở lịch sử chỉnh sửa và khôi phục phiên bản trước. Bot dùng lại bản cũ ngay.'),
            FAQ_TRY,
        ]},
        related('tinh-nang/tro-ly-rapiz', 'tinh-nang/ban-hang-ai', 'nganh/spa-salon'),
        {'kind': 'close'},
    ],
})

PAGES.append({
    'slug': 'tinh-nang/tro-ly-rapiz', 'group': 'Tính năng · Trợ lý Rapiz',
    'title': 'Trợ lý Rapiz: hỏi số liệu bán hàng bằng tiếng Việt',
    'description': 'Trợ lý riêng cho chủ doanh nghiệp: hỏi số liệu nhận biểu đồ, báo cáo định kỳ, giải thích câu trả lời của bot, nhập sản phẩm. Mọi thay đổi chờ bạn duyệt.',
    'h1': 'Hỏi như hỏi<br><em>trưởng phòng kinh doanh.</em>',
    'deck': 'Trợ lý riêng cho chủ doanh nghiệp. Hỏi số liệu bằng tiếng Việt và nhận biểu đồ, hẹn giờ nhận báo cáo, hỏi vì sao bot trả lời như vậy. Trợ lý đề xuất, bạn quyết định.',
    'points': ['Mọi thay đổi chờ bạn duyệt'],
    'visual': {'mock': {'type': 'bars', 'title': 'Trợ lý Rapiz', 'question': 'Tuần này có bao nhiêu đơn?', 'answer': '72 đơn trong tuần, cao nhất vào Chủ nhật.',
                        'bars': [('T2', 4), ('T3', 9), ('T4', 8), ('T5', 12), ('T6', 10), ('T7', 14), ('CN', 15)],
                        'aria': 'Đơn hàng từ thứ Hai đến Chủ nhật: 4, 9, 8, 12, 10, 14, 15.'}},
    'blocks': [
        {'kind': 'rows', 'kicker': 'VIỆC CỦA TRỢ LÝ', 'h2': 'Bớt mở báo cáo,<br><em>hỏi thẳng câu cần hỏi.</em>',
         'rows': [
             {'title': 'Báo cáo, cảnh báo định kỳ', 'text': 'Nói bằng lời: “Mỗi sáng 8h gửi tôi số đơn hôm qua.” Trợ lý gửi qua chuông trong app, email hoặc thông báo đẩy.',
              'mock': {'type': 'list', 'title': 'Lịch báo cáo',
                       'items': [('8h', 'Số đơn hôm qua', 'Mỗi ngày · email và thông báo đẩy', 'Đang bật', 'ok'), ('T2', 'Hội thoại cần người tuần trước', 'Mỗi thứ Hai · chuông', 'Đang bật', 'ok'),
                                 ('!', 'Cảnh báo khi bot chuyển người quá 10 lần/ngày', 'Theo sự kiện', 'Đang bật', 'hot')]}},
             {'title': 'Bác sĩ bot', 'text': 'Hỏi “vì sao bot trả lời khách này như vậy?”. Trợ lý chỉ ra quy tắc và dữ liệu đã dùng, rồi đề xuất cách sửa.',
              'mock': {'type': 'chat', 'title': 'Trợ lý Rapiz',
                       'thread': [('c', 'Sao bot từ chối đổi size cho khách Mai Linh?'), ('l', 'Đọc hội thoại và quy tắc đã dùng'),
                                  ('a', 'Bot áp dụng “Chính sách đổi size: 7 ngày”. Khách nhận áo 10 ngày trước nên đã quá hạn. Nếu muốn nới lên 14 ngày, mình soạn thay đổi để bạn duyệt nhé?')]}},
             {'title': 'Nhập sản phẩm từ Excel và ảnh', 'text': 'Gửi tệp Excel, CSV và ảnh. Trợ lý đọc, ghép biến thể, đề xuất danh mục; bạn duyệt một lần.',
              'mock': {'type': 'kv', 'title': 'Đề xuất nhập danh mục',
                       'rows': [('Tệp', '<span class="mono">san-pham-thang-11.xlsx</span>', ''), ('Sản phẩm', '48', ''), ('Biến thể', '196', ''), ('Ảnh khớp tên', '41 / 48', 'warn')],
                       'foot': 'Chờ bạn duyệt trước khi lưu'}},
             {'title': 'Điền mẫu giúp bạn', 'text': 'Nút “Nhờ trợ lý điền mẫu” điền thông tin shop, kịch bản tư vấn và nháp hành động API từ những gì bạn đã có.',
              'mock': {'type': 'list', 'title': 'Thay đổi chờ duyệt',
                       'items': [('1', 'Giờ làm việc', '8:00 – 21:00, nghỉ trưa 12:00 – 13:30', 'Chờ duyệt', 'ai'), ('2', 'Kịch bản: khách hỏi giá sỉ', 'Chuyển nhân viên kinh doanh', 'Chờ duyệt', 'ai'),
                                 ('3', 'Hành động API: Tra trạng thái đơn', 'Nháp, chưa bật', 'Chờ duyệt', 'ai')],
                       'foot': 'Trợ lý đề xuất, bạn quyết định'}},
         ]},
        {'kind': 'faq', 'items': [
            ('Trợ lý có tự sửa bot không?', 'Không. Mọi thay đổi trợ lý đề xuất đều chờ chủ doanh nghiệp duyệt rồi mới áp dụng.'),
            ('Trợ lý xem được dữ liệu nào?', 'Dữ liệu của doanh nghiệp bạn đang quản lý: hội thoại, đơn hàng, khách hàng, bot. Dữ liệu của mỗi doanh nghiệp được tách riêng.'),
            ('Tôi hỏi được những câu gì?', 'Ví dụ: “Tuần này bao nhiêu đơn?”, “Doanh thu villa tháng 10?”, “Hôm nay bot chuyển người mấy lần, vì sao?”.'),
            ('Báo cáo gửi qua kênh nào?', 'Chuông trong ứng dụng, email và thông báo đẩy trên điện thoại.'),
        ]},
        related('tinh-nang/khach-hang-thong-ke', 'tinh-nang/dao-tao-ai', 'nganh/villa-homestay'),
        {'kind': 'close'},
    ],
})

PAGES.append({
    'slug': 'tinh-nang/khach-hang-thong-ke', 'group': 'Tính năng · Khách hàng & thống kê',
    'title': 'Khách hàng và thống kê: đo từ hội thoại tới đơn hàng | Rapiz',
    'description': 'CRM theo ngành, tự chia khách cho sale, thống kê hội thoại → khách mới → số điện thoại → đơn hàng, lọc theo trang, bot, ngày và xem chi tiết.',
    'h1': 'Mỗi hội thoại<br><em>thành một khách hàng.</em>',
    'deck': 'Mỗi hội thoại thành một khách hàng có nguồn, trạng thái và lịch sử. Thống kê đi từ hội thoại đến khách mới, số điện thoại và đơn hàng, lọc theo trang, bot và ngày.',
    'points': ['Trạng thái khách theo ngành', 'Tự chia khách cho sale', 'Tổng quan nhiều doanh nghiệp'],
    'visual': {'mock': {'type': 'list', 'title': 'Khách hàng',
                        'items': [('ML', 'Mai Linh', 'Messenger · Áo sơ mi trắng', 'Đã đặt hàng', 'ok'), ('NT', 'Ngọc Trâm', 'Bình luận · Gội dưỡng sinh', 'Đã hẹn', 'ai'),
                                  ('MA', 'Minh Anh (phụ huynh)', 'Messenger · Giao tiếp THCS', 'Học thử', 'hot'), ('TH', 'Thu Hà', 'Website · Linen be', 'Có SĐT', '')],
                        'foot': 'Dữ liệu minh họa'}},
    'blocks': [
        {'kind': 'rows', 'kicker': 'ĐO TỪNG BƯỚC', 'h2': 'Phễu bán hàng<br><em>đọc được bằng số.</em>',
         'rows': [
             {'title': 'Phễu hội thoại đến đơn', 'text': 'Thấy được bao nhiêu hội thoại thành khách mới, bao nhiêu để lại số điện thoại và bao nhiêu thành đơn. Lọc theo trang, bot, ngày; bấm vào từng bước để xem danh sách.',
              'mock': {'type': 'kv', 'title': 'Tháng 11 · tất cả trang',
                       'rows': [('Hội thoại', '1.240', ''), ('Khách mới', '836', ''), ('Để lại số điện thoại', '412', ''), ('Đơn hàng', '187', 'ok')],
                       'foot': 'Số liệu minh họa'}},
             {'title': 'Khách hàng theo ngành', 'text': 'Nguồn, trạng thái theo đúng quy trình của ngành, nhãn, ghi chú và toàn bộ lịch sử trao đổi trong một hồ sơ.',
              'mock': {'type': 'kv', 'title': 'Hồ sơ khách · Ngọc Trâm',
                       'rows': [('Nguồn', 'Bình luận · bài ưu đãi tháng 11', ''), ('Trạng thái', 'Đã hẹn', 'ok'), ('Nhãn', 'Khách mới, Quận 3', ''), ('Ghi chú', 'Da nhạy cảm, tránh tinh dầu bạc hà', '')]}},
             {'title': 'Tự chia khách cho sale', 'text': 'Khách mới được giao cho nhân viên theo chính sách bạn đặt, mỗi người thấy rõ khách của mình.',
              'mock': {'type': 'list', 'title': 'Chia khách hôm nay',
                       'items': [('L', 'Lan', 'Ca sáng · Messenger', '14 khách', ''), ('M', 'Minh', 'Ca chiều · Messenger, bình luận', '11 khách', ''), ('H', 'Hoa', 'Ca tối · Website', '9 khách', '')],
                       'foot': 'Ví dụ chính sách chia đều theo ca'}},
             {'title': 'Tổng quan nhiều doanh nghiệp', 'text': 'Một tài khoản quản lý nhiều doanh nghiệp, mỗi nơi một ngành. Xem số liệu tất cả trên một màn hình.',
              'mock': {'type': 'list', 'title': 'Tổng quan tài khoản',
                       'items': [('LH', 'Linen House', 'Bán lẻ online', '96 đơn', 'ok'), ('PV', 'Pine Villa', 'Lưu trú', '23 giữ chỗ', 'ai'), ('MS', 'Mộc Spa', 'Spa', '58 lịch hẹn', 'hot')],
                       'foot': 'Số liệu minh họa'}},
         ]},
        {'kind': 'faq', 'items': [
            ('Số liệu lấy từ đâu?', 'Từ hội thoại, khách hàng và đơn hàng trong Rapiz. Bộ lọc theo trang, bot và khoảng ngày; mỗi bước của phễu mở ra được danh sách chi tiết.'),
            ('Tôi có nhiều fanpage cho nhiều thương hiệu?', 'Một tài khoản quản lý nhiều doanh nghiệp, mỗi doanh nghiệp một ngành, dữ liệu tách riêng và có màn hình tổng quan chung.'),
            ('Có gửi tin nhắn hàng loạt, chăm sóc lại khách cũ không?', 'Chưa. Rapiz hiện tập trung vào trả lời, chốt đơn và theo dõi khách; tính năng chăm sóc lại tự động chưa có.'),
        ]},
        related('tinh-nang/tro-ly-rapiz', 'tinh-nang/hop-thu', 'bao-mat'),
        {'kind': 'close'},
    ],
})


# ===== platform =====

PAGES.append({
    'slug': 'tich-hop', 'group': 'Nền tảng · Tích hợp & kênh',
    'title': 'Tích hợp và kênh: Messenger, website, KiotViet, API | Rapiz',
    'description': 'Rapiz kết nối Messenger, bình luận Facebook, khung chat website; Instagram đang Beta, Zalo và TikTok sắp ra mắt. Đồng bộ KiotViet (Beta), API công khai và webhook.',
    'h1': 'Trả lời trên kênh khách nhắn,<br><em>bằng dữ liệu bạn đang có.</em>',
    'deck': 'Rapiz trả lời trên các kênh khách đang nhắn, đọc dữ liệu từ hệ thống bạn đang dùng, và đẩy khách hàng, đơn hàng về nơi bạn cần.',
    'blocks': [
        {'kind': 'caps', 'kicker': 'KÊNH NHẮN TIN', 'h2': 'Một bot,<br><em>nhiều nơi khách hỏi.</em>',
         'items': [
             {'icon': 'comment', 'title': 'Facebook Messenger', 'text': 'Kết nối fanpage, bot trả lời tin nhắn và gửi tóm tắt đơn có nút xác nhận.'},
             {'icon': 'comment', 'title': 'Bình luận Facebook', 'text': 'Trả lời công khai theo bài đăng, nhắn riêng, ẩn bình luận xấu.', 'link': 'tinh-nang/binh-luan-facebook'},
             {'icon': 'search', 'title': 'Khung chat website', 'text': 'Mã nhúng nhẹ, khoảng 9 KB. Khách chat ngay trên website và để lại số điện thoại.'},
             {'icon': 'image', 'title': 'Instagram DM', 'status': 'Beta', 'text': 'Trả lời tin nhắn Instagram từ cùng hộp thư.'},
             {'icon': 'comment', 'title': 'Zalo', 'status': 'Sắp ra mắt', 'text': 'Đang hoàn thiện kết nối Zalo.'},
             {'icon': 'comment', 'title': 'TikTok', 'status': 'Sắp ra mắt', 'text': 'Đang hoàn thiện kết nối tin nhắn TikTok.'},
         ]},
        {'kind': 'duo', 'cls': 'tint', 'kicker': 'DỮ LIỆU VÀ HỆ THỐNG', 'h2': 'Đọc từ hệ thống cũ,<br><em>ghi về nơi bạn cần.</em>',
         'cards': [
             {'kicker': 'BÁN HÀNG', 'title': 'Danh mục và tồn kho', 'text': 'Đưa sản phẩm vào Rapiz bằng tệp hoặc đồng bộ từ phần mềm bán hàng.',
              'chips': [('Excel, CSV và ảnh', None), ('KiotViet', 'Beta'), ('Sapo', 'Sắp ra mắt'), ('Haravan', 'Sắp ra mắt'), ('Pancake POS', 'Sắp ra mắt')],
              'ticks': ['KiotViet: sản phẩm, tồn theo chi nhánh, đẩy đơn, đồng bộ khách', 'Trợ lý Rapiz đọc tệp Excel, ghép biến thể, chờ bạn duyệt']},
             {'kicker': 'CHO ĐỘI KỸ THUẬT', 'title': 'API và webhook', 'text': 'Kết nối Rapiz với CRM, kho dữ liệu hay hệ thống nội bộ.',
              'chips': [('API công khai', 'Gói Pro, Neo'), ('Webhook có chữ ký', None), ('Tài liệu OpenAPI', None), ('Hành động API của bot', None)],
              'ticks': ['Bot gọi API của bạn để tra đơn, kiểm tra tồn, đặt lịch, có bước xác nhận', 'Chặn gọi vào mạng nội bộ', 'Giới hạn 120 yêu cầu mỗi phút trên gói Pro và Neo']},
         ]},
        {'kind': 'steps', 'kicker': 'BẮT ĐẦU NHANH', 'h2': 'Bốn bước<br><em>để bot bắt đầu trả lời.</em>',
         'items': [
             ('Tạo tài khoản', 'Đăng ký bằng email và mã xác thực, chọn ngành cho doanh nghiệp đầu tiên.'),
             ('Kết nối kênh', 'Chọn fanpage Messenger, bật bình luận, hoặc dán mã nhúng khung chat vào website.'),
             ('Đưa dữ liệu vào', 'Nhập danh mục từ Excel hoặc KiotViet, điền hồ sơ doanh nghiệp theo bộ mẫu ngành.'),
             ('Chat thử rồi bật', 'Thử như khách thật trên giao diện giống Messenger, rồi bật bot cho kênh.'),
         ]},
        {'kind': 'faq', 'items': [
            ('Kết nối Messenger có ảnh hưởng fanpage không?', 'Rapiz kết nối qua quyền Meta cấp cho ứng dụng. Bạn vẫn dùng fanpage như bình thường và có thể tắt bot bất cứ lúc nào.'),
            ('Khi nào có Zalo và TikTok?', 'Cả hai đang được hoàn thiện. Nhãn “Sắp ra mắt” sẽ được bỏ khi kết nối chạy thật.'),
            ('Tôi dùng phần mềm bán hàng khác KiotViet?', 'Bạn nhập danh mục qua Excel hoặc CSV, hoặc để đội kỹ thuật kết nối qua API và webhook. Sapo, Haravan, Pancake POS sắp có.'),
            ('Webhook có chữ ký là gì?', 'Mỗi sự kiện Rapiz gửi đi kèm chữ ký để hệ thống của bạn kiểm tra đúng là từ Rapiz và không bị sửa trên đường truyền.'),
        ]},
        related('bao-mat', 'tinh-nang/ban-hang-ai', 'bang-gia'),
        {'kind': 'close'},
    ],
})

PAGES.append({
    'slug': 'bao-mat', 'group': 'Nền tảng · Bảo mật & dữ liệu',
    'title': 'Bảo mật và dữ liệu: tách riêng, phân quyền, 2FA | Rapiz',
    'description': 'Dữ liệu mỗi doanh nghiệp tách riêng ở tầng cơ sở dữ liệu, phân quyền thành viên, xác thực hai lớp, nhật ký thao tác; bot cần khách xác nhận trước khi tạo đơn.',
    'h1': 'Bot làm nhanh.<br><em>Việc quan trọng có người duyệt.</em>',
    'deck': 'Bot làm việc trong phạm vi bạn cho phép. Dữ liệu mỗi doanh nghiệp tách riêng, thành viên có vai trò, thao tác quan trọng được ghi nhật ký và việc tốn tiền cần người xác nhận.',
    'blocks': [
        {'kind': 'caps', 'kicker': 'BẢO VỆ DỮ LIỆU', 'h2': 'Dữ liệu mỗi doanh nghiệp<br><em>nằm riêng.</em>',
         'items': [
             {'icon': 'data', 'title': 'Dữ liệu tách riêng', 'text': 'Mỗi doanh nghiệp có vùng dữ liệu riêng, được khoá ở tầng cơ sở dữ liệu bằng chính sách theo dòng.'},
             {'icon': 'users', 'title': 'Vai trò và ghế', 'text': 'Mời thành viên, gán vai trò, giới hạn số ghế theo gói. Thu hồi quyền ngay khi cần.'},
             {'icon': 'shield', 'title': 'Xác thực hai lớp', 'text': 'Bật 2FA cho tài khoản; đăng ký bằng mã xác thực email.'},
             {'icon': 'history', 'title': 'Nhật ký thao tác', 'text': 'Thay đổi quan trọng được ghi lại: ai làm, làm gì, lúc nào.'},
         ]},
        {'kind': 'caps', 'cls': 'tint', 'kicker': 'KIỂM SOÁT BOT', 'h2': 'Bot làm trong phạm vi.<br><em>Người duyệt việc quan trọng.</em>',
         'items': [
             {'icon': 'check', 'title': 'Khách xác nhận trước khi tạo đơn', 'text': 'Đơn chỉ được tạo khi khách bấm nút xác nhận trên tóm tắt đơn.'},
             {'icon': 'hand', 'title': 'Nhân viên duyệt đơn và giữ chỗ', 'text': 'Đơn bot tạo mang nhãn riêng; giữ chỗ tự hết hạn nếu nhân viên chưa xác nhận.'},
             {'icon': 'plug', 'title': 'Hành động API có xác nhận', 'text': 'Mỗi lần gọi API của bạn có bước xác nhận, và lệnh gọi vào mạng nội bộ bị chặn.'},
             {'icon': 'memory', 'title': 'Trợ lý đề xuất, bạn duyệt', 'text': 'Thay đổi do Trợ lý Rapiz soạn chỉ áp dụng sau khi chủ doanh nghiệp duyệt.'},
             {'icon': 'calc', 'title': 'Không đoán số', 'text': 'Giá, tồn, ngày trống tra từ dữ liệu; phép tính đi qua máy tính.'},
             {'icon': 'book', 'title': 'Lịch sử và khôi phục', 'text': 'Mọi chỉnh sửa đào tạo bot có lịch sử và khôi phục được.'},
             {'icon': 'bell', 'title': 'Hết lượt thì chuyển người', 'text': 'Khi hết lượt trả lời AI hoặc tài khoản tạm dừng, hội thoại về nhân viên, bot không trả lời thay.'},
             {'icon': 'search', 'title': 'Giải thích được', 'text': 'Hỏi trợ lý vì sao bot trả lời như vậy để thấy quy tắc và dữ liệu đã dùng.'},
         ]},
        {'kind': 'faq', 'items': [
            ('Nhân viên của doanh nghiệp này có xem được dữ liệu doanh nghiệp khác không?', 'Không. Dữ liệu tách riêng theo doanh nghiệp ở tầng cơ sở dữ liệu. Thành viên chỉ thấy doanh nghiệp họ được mời vào.'),
            ('Rapiz có dùng hội thoại của tôi cho khách khác không?', 'Bot của bạn trả lời dựa trên dữ liệu doanh nghiệp bạn. Dữ liệu một doanh nghiệp không được dùng để trả lời khách của doanh nghiệp khác.'),
            ('Tôi muốn ngừng dùng bot ngay lập tức?', 'Tắt bot cho từng hội thoại, cho từng kênh hoặc cho cả bot trong phần cài đặt. Hội thoại vẫn nằm trong hộp thư để nhân viên xử lý.'),
            ('Có cam kết tuân thủ tiêu chuẩn nào không?', 'Trang này chỉ liệt kê những biện pháp đang chạy trong sản phẩm. Nếu doanh nghiệp bạn cần hồ sơ bảo mật cho thẩm định, hãy đặt lịch trao đổi với Rapiz.'),
        ]},
        related('tich-hop', 'tinh-nang/hop-thu', 'bang-gia'),
        {'kind': 'close', 'h2': 'Cần trao đổi<br><em>về bảo mật?</em>'},
    ],
})

PAGES.append({
    'slug': 'bang-gia', 'group': 'Nền tảng · Bảng giá',
    'title': 'Bảng giá | Rapiz',
    'description': 'Gói Miễn phí không thời hạn. Sales Smart từ 785.000đ, Sales Pro từ 974.000đ, Sales Neo từ 1.624.000đ mỗi tháng khi thanh toán 12 tháng. Chuyển khoản VietQR.',
    'h1': 'Bắt đầu miễn phí.<br><em>Trả khi đội lớn lên.</em>',
    'deck': 'Mọi gói đều có bot bán hàng, hộp thư đội sale, đào tạo AI và Trợ lý Rapiz. Gói trả phí mở thêm thành viên, kênh, bình luận Facebook, khung chat website và API.',
    'hero_actions': False,
    'blocks': [
        {'kind': 'plans', 'kicker': 'CÁC GÓI', 'h2': 'Chọn theo<br><em>quy mô đội.</em>', 'lead': 'Giá mỗi tháng giảm khi trả theo kỳ dài hơn.'},
        {'kind': 'compare'},
        {'kind': 'faq', 'kicker': 'THANH TOÁN', 'h2': 'Câu hỏi<br>về <em>bảng giá.</em>', 'items': [
            ('Lượt trả lời AI được tính thế nào?', 'Một lượt là một câu trả lời bot gửi tới khách, kể cả trả lời bình luận. Tin nhắn nhân viên gửi không bị tính. Một câu trả lời được tính một lần dù hệ thống gửi lại.'),
            ('Hết lượt trả lời AI giữa chu kỳ thì sao?', 'Bot ngừng trả lời và hội thoại mới tự chuyển cho nhân viên trong hộp thư; bình luận mới vào danh sách chờ. Hạn mức mở lại ở chu kỳ sau hoặc khi bạn nâng gói.'),
            ('Thanh toán bằng cách nào?', 'Chuyển khoản qua mã VietQR. Mỗi yêu cầu thanh toán có mã chuyển khoản riêng; gói được kích hoạt khi Rapiz xác nhận đã nhận tiền.'),
            ('Có dùng thử gói trả phí không?', 'Tài khoản mới có thể được dùng thử gói trả phí trong thời gian khuyến mãi khi đăng ký. Sau đó tài khoản chuyển về gói đã chọn hoặc gói Miễn phí.'),
            ('Hết hạn mà chưa gia hạn thì sao?', 'Tài khoản chuyển sang trạng thái quá hạn và được nhắc trước. Sau thời gian ân hạn, tài khoản tạm dừng rồi chuyển về gói Miễn phí.'),
            ('Một tài khoản có nhiều doanh nghiệp, tính phí ra sao?', 'Gói tính theo tài khoản. Hạn mức lượt trả lời AI dùng chung cho mọi doanh nghiệp trong tài khoản.'),
            ('Thanh toán trước khi hết kỳ được không?', 'Được. Kỳ mới bắt đầu từ ngày kết thúc kỳ hiện tại, bạn không mất ngày nào.'),
        ]},
        {'kind': 'close', 'h2': 'Chưa chắc<br><em>gói nào hợp?</em>'},
    ],
})

PAGES.append({
    'slug': 'dat-lich-demo', 'group': 'Đặt lịch demo',
    'title': 'Đặt lịch demo | Rapiz',
    'description': 'Đặt buổi demo 30 phút: Rapiz cài thử trên danh mục và chính sách của bạn, chat thử như khách thật và tư vấn gói phù hợp.',
    'h1': 'Xem Rapiz trả lời<br><em>khách của bạn.</em>',
    'deck': 'Để lại thông tin, chuyên viên Rapiz liên hệ trong giờ làm việc để hẹn buổi demo. Bạn mang theo vài câu khách hay hỏi, chúng tôi cho bot trả lời ngay trong buổi.',
    'hero_actions': False,
    'blocks': [
        {'kind': 'form', 'ticks': [
            'Cài thử trên một phần danh mục và chính sách của bạn',
            'Chat thử bằng chính câu khách hay hỏi, kể cả không dấu',
            'Xem hộp thư, bàn giao cho nhân viên và Trợ lý Rapiz',
            'Tư vấn gói theo số thành viên, kênh và lượng tin nhắn',
        ]},
        {'kind': 'faq', 'items': [
            ('Buổi demo có mất phí không?', 'Không. Buổi demo và gói Miễn phí đều không mất phí.'),
            ('Tôi cần chuẩn bị gì?', 'Vài sản phẩm hoặc dịch vụ kèm giá, chính sách đổi trả hoặc huỷ lịch, và năm câu khách hay hỏi nhất.'),
            FAQ_TRY,
        ]},
    ],
})
