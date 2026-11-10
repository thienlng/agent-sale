"""Copy and data for the Rapiz sub-pages.

Every claim here must match FEATURES.vi.md: only running features are promised, "Thử nghiệm" and
"Sắp ra mắt" ones carry their label, no competitor names, and every chat, order or number is
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
    {'slug': 'nganh/ban-le', 'name': 'Bán lẻ & thương mại điện tử', 'blurb': 'Tư vấn size, tra tồn và chốt đơn trong chat.'},
    {'slug': 'nganh/villa-homestay', 'name': 'Lưu trú & nghỉ dưỡng', 'blurb': 'Xem ngày trống, báo giá theo gói, giữ chỗ.'},
    {'slug': 'nganh/spa-salon', 'name': 'Làm đẹp & spa', 'blurb': 'Tư vấn dịch vụ và ghi lịch hẹn đủ thông tin.'},
    {'slug': 'nganh/giao-duc', 'name': 'Giáo dục & đào tạo', 'blurb': 'Ghi danh test trình độ và học thử.'},
    {'slug': 'nganh/phan-mem', 'name': 'Công nghệ & phần mềm', 'blurb': 'Nhận yêu cầu demo, dùng thử; theo dõi MRR.'},
]
FEATURE_LINKS = [
    {'slug': 'tinh-nang/ban-hang-ai', 'name': 'Tư vấn & chốt đơn', 'blurb': 'Chốt đơn bằng nút xác nhận, không bịa giá.'},
    {'slug': 'tinh-nang/binh-luan-facebook', 'name': 'Tự động xử lý bình luận', 'blurb': 'Trả lời theo bài đăng, nhắn riêng, ẩn theo từ khóa.'},
    {'slug': 'tinh-nang/hop-thu', 'name': 'Tin nhắn đa kênh', 'blurb': 'Messenger, Instagram, website và bình luận chung một hộp thư.'},
    {'slug': 'tinh-nang/dao-tao-ai', 'name': 'Đào tạo Bot', 'blurb': 'Dạy bot như dạy nhân viên mới, chat thử trước khi bật.'},
    {'slug': 'tinh-nang/tro-ly-rapiz', 'name': 'Trợ lý & thống kê', 'blurb': 'Hỏi số liệu bằng tiếng Việt, nhận báo cáo theo lịch.'},
    {'slug': 'tinh-nang/khach-hang-thong-ke', 'name': 'Khách hàng, đơn hàng & lịch', 'blurb': 'Trạng thái khách theo ngành, đơn hàng, lịch và booking.'},
]
PLATFORM_LINK = {'slug': 'tich-hop', 'name': 'Tích hợp nền tảng & PMS', 'blurb': 'Kênh nhắn tin, KiotViet, API và webhook.'}
NAV_PLAIN = [('Tích hợp', 'tich-hop'), ('Bảng giá', 'bang-gia'), ('Về chúng tôi', 've-rapiz')]
COMPANY = {
    'name': 'Công ty TNHH Công nghệ Rapiz',
    'name_en': 'Rapiz Technology Company Limited',
    'short': 'RAPIZ TECH CO., LTD.',
    'email': 'support@rapiz.io',
}
FOOT_PLATFORM = [
    ('Tích hợp nền tảng & PMS', 'tich-hop', None),
    ('Bảo mật & dữ liệu', 'bao-mat', None),
    ('Bảng giá', 'bang-gia', None),
    ('Về Rapiz', 've-rapiz', None),
    ('Câu hỏi thường gặp', '#questions', None),
]
FOOT_ACCOUNT = [
    ('Đăng ký', SIGNUP_URL, None),
    ('Đăng nhập', LOGIN_URL, None),
    ('Đặt lịch demo', 'dat-lich-demo', None),
]

LINK_INDEX = {}
for _l in INDUSTRY_LINKS:
    LINK_INDEX[_l['slug']] = {**_l, 'group': 'Giải pháp'}
for _l in FEATURE_LINKS:
    LINK_INDEX[_l['slug']] = {**_l, 'group': 'Tính năng'}
LINK_INDEX['tich-hop'] = {**PLATFORM_LINK, 'group': 'Nền tảng'}
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
    'globe': _svg('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5S9.7 5.9 12 3.5Z"/>'),
    'file': _svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>'),
    'code': _svg('<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>'),
    'store': _svg('<path d="M4 9.5 5.5 4h13L20 9.5M4 9.5h16M4 9.5c0 1.7 1.3 3 3 3s2.7-1.3 2.7-3c0 1.7 1.3 3 2.3 3s2.3-1.3 2.3-3c0 1.7 1.3 3 2.7 3s3-1.3 3-3M5.5 12.5V20h13v-7.5"/>'),
    'megaphone': _svg('<path d="M4 10v4h3l7 4V6l-7 4z"/><path d="M7 14v4.5h3M17.5 9.5a3.5 3.5 0 0 1 0 5"/>'),
    'bell': _svg('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
}


# ---------- pricing ----------

TERMS = [('3', ''), ('6', ''), ('12', 'tiết kiệm nhất')]
PLANS = [
    {
        'code': 'free', 'name': 'Miễn phí', 'prices': None, 'cta': 'Chọn gói Miễn phí',
        'for': 'Một người, một fanpage. Đủ để thử bot với khách thật.',
        'ticks': ['1.000 lượt trả lời AI mỗi 14 ngày', '1 thành viên, tối đa 3 kênh', 'Tin nhắn đa kênh, Đào tạo Bot, chốt đơn trong chat', 'Trợ lý Rapiz cho chủ shop'],
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
    ('ban-le', 'Bán lẻ & thương mại điện tử'), ('villa-homestay', 'Lưu trú & nghỉ dưỡng'), ('spa-salon', 'Làm đẹp & spa'),
    ('giao-duc', 'Giáo dục & đào tạo'), ('phan-mem', 'Công nghệ & phần mềm'), ('khac', 'Ngành khác'),
]
FORM_PLANS = [('', 'Chưa chắc, cần tư vấn')] + [(p['code'], p['name']) for p in PLANS]
FORM_CHANNELS = ['Messenger', 'Bình luận Facebook', 'Instagram', 'Website', 'Zalo (sắp ra mắt)', 'TikTok (sắp ra mắt)']


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

def related(h2, *slugs):
    return {'kind': 'related', 'h2': h2, 'slugs': list(slugs)}


SHOT_NOTE = 'Ảnh chụp ứng dụng Rapiz với dữ liệu demo.'


def shot(img, kicker, h2, lead, alt, w=2400, h=1345):
    return {'kind': 'shot', 'kicker': kicker, 'h2': h2, 'lead': lead, 'img': img, 'alt': alt, 'w': w, 'h': h, 'caption': SHOT_NOTE}


PAGES = [{
    'slug': 've-rapiz', 'title': 'Về Rapiz · Sứ mệnh',
    'description': 'Rapiz xây nhân viên AI cho đội bán hàng và trợ lý riêng cho người chủ. Tìm hiểu sứ mệnh và tầm nhìn Business OS của Rapiz.',
}]

# ===== industries =====

PAGES.append({
    'slug': 'nganh/ban-le', 'group': 'Giải pháp · Bán lẻ & thương mại điện tử',
    'title': 'Bán lẻ & thương mại điện tử: tư vấn và chốt đơn trong chat | Rapiz',
    'description': 'Rapiz tra danh mục, giá và tồn kho của shop, gửi ảnh sản phẩm thật và gửi tóm tắt đơn để khách bấm xác nhận ngay trong Messenger.',
    'h1': 'Khách hỏi size.<br><em>Một chạm là lên đơn.</em>',
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
             ('order', {'rows': [('Áo thun cotton trắng · L', '× 2'), ('Tạm tính', '440.000đ'), ('Phí ship', '30.000đ')], 'total': ('Tổng', '470.000đ')}, 3),
             ('r', 'Khách đã bấm ✅ Đặt hàng · Đơn mang nhãn “Bot tạo”, giữ 2 áo trong kho, chờ nhân viên duyệt.', 4),
         ]},
        shot('ui-inbox-clean.jpg', 'MÀN HÌNH THẬT', 'Hội thoại và hồ sơ khách<br><em>trên cùng một màn hình.</em>',
             'Đây là Tin nhắn đa kênh trong app. Nhân viên đọc lại những gì bot đã trả lời, xem số điện thoại, trạng thái và nhãn của khách ở cột bên phải.',
             'Màn hình Tin nhắn đa kênh của Rapiz: bên trái là danh sách hội thoại có lọc Chưa đọc và Chờ trả lời, giữa là đoạn chat bot đang trả lời một khách trên website, bên phải là hồ sơ khách với số điện thoại, trạng thái và nhãn.'),
        {'kind': 'caps', 'kicker': 'BỘ VIỆC CỦA SHOP', 'h2': 'Những việc Rapiz<br><em>làm thay đội sale.</em>',
         'items': [
             {'icon': 'search', 'title': 'Tìm sản phẩm theo nhu cầu', 'text': 'Khách gõ không dấu, viết tắt hay chỉ tả màu và dáng, Rapiz vẫn ra đúng mẫu và biến thể.', 'proof': '“con mau den ko” → tra tồn theo màu'},
             {'icon': 'data', 'title': 'Giá và tồn từ dữ liệu shop', 'text': 'Giá, biến thể, tồn kho lấy từ danh mục của bạn trước khi trả lời. Không có dữ liệu thì bot nói chưa có.', 'link': 'tinh-nang/ban-hang-ai'},
             {'icon': 'calc', 'title': 'Tính tiền chính xác', 'text': 'Mọi phép tính đi qua máy tính, kể cả khi khách gõ 1,5 hay 500,000.', 'proof': '<span class="mono">2 × 880.000 = 1.760.000đ</span>'},
             {'icon': 'check', 'title': 'Chốt đơn bằng nút bấm', 'text': 'Bot gửi tóm tắt đơn. Đơn chỉ được tạo khi khách bấm ✅ Đặt hàng, nhân viên duyệt trước khi giao.', 'link': 'tinh-nang/ban-hang-ai'},
             {'icon': 'image', 'title': 'Gửi ảnh sản phẩm thật', 'text': 'Chỉ gửi ảnh có trong thư viện sản phẩm của bạn, không lấy ảnh lạ trên mạng.'},
             {'icon': 'comment', 'title': 'Bình luận dưới bài quảng cáo', 'text': 'Trả lời công khai theo đúng sản phẩm trong bài, nhắn riêng cho người bình luận, ẩn bình luận theo từ khóa.', 'link': 'tinh-nang/binh-luan-facebook'},
             {'icon': 'hand', 'title': 'Gọi nhân viên đúng lúc', 'text': 'Đổi địa chỉ sau khi chốt, khiếu nại, xin giảm giá: bot chuyển người kèm lý do và tóm tắt.', 'link': 'tinh-nang/hop-thu'},
             {'icon': 'plug', 'title': 'Đồng bộ KiotViet', 'status': 'Thử nghiệm', 'text': 'Lấy sản phẩm và tồn theo chi nhánh, đẩy đơn và khách hàng về KiotViet.', 'link': 'tich-hop'},
         ]},
        {'kind': 'faq', 'items': [
            ('Bot có tự tạo đơn khi khách chưa đồng ý không?', 'Không. Bot gửi tóm tắt đơn kèm nút ✅ Đặt hàng và nút sửa. Đơn chỉ được tạo khi khách bấm xác nhận, mang nhãn “Bot tạo” để nhân viên duyệt.'),
            ('Tồn kho được xử lý thế nào khi bot tạo đơn?', 'Đơn bot tạo giữ tồn kho cho các biến thể trong đơn. Nhân viên thấy nguồn đơn, trạng thái, có thể sửa món và tách tổng tiền với tiền phải thu.'),
            ('Shop tôi có nhiều màu, nhiều size?', 'Mỗi sản phẩm có biến thể, kho và tồn riêng. Bot tra theo đúng biến thể khách hỏi và báo khi một màu hoặc size đã hết.'),
            ('Nhập sản phẩm có mất nhiều thời gian không?', 'Bạn nhập từ Excel hoặc CSV kèm ảnh. Trợ lý Rapiz đọc tệp, đề xuất danh mục để bạn duyệt một lần là xong.'),
            ('Tôi đang dùng KiotViet, có cần nhập lại không?', 'Không cần. Tích hợp KiotViet đang chạy thử nghiệm với một số shop: đồng bộ sản phẩm, tồn theo chi nhánh, đẩy đơn và khách hàng. Sapo, Haravan và Pancake POS sắp ra mắt; hệ thống khác kết nối được qua API và webhook.'),
            FAQ_HANDOFF,
        ]},
        related('Đơn trong chat<br><em>còn cần gì nữa?</em>', 'tinh-nang/ban-hang-ai', 'tinh-nang/binh-luan-facebook', 'tich-hop'),
        {'kind': 'close', 'h2': 'Thử Rapiz với<br><em>danh mục của shop.</em>', 'demo_query': '?nganh=ban-le'},
    ],
})

PAGES.append({
    'slug': 'nganh/villa-homestay', 'group': 'Giải pháp · Lưu trú & nghỉ dưỡng',
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
        shot('ui-calendar-clean.jpg', 'MÀN HÌNH THẬT', 'Biết phòng nào trống<br><em>trước khi khách hỏi.</em>',
             'Lịch phòng xem theo 2 tuần, tháng, quý hoặc năm; ghi booking, khoá lịch và ghi chú cho từng đêm. Bot đọc đúng lịch này khi khách hỏi ngày trống.',
             'Màn hình Lịch của Rapiz cho một cụm villa: ô tìm theo ngày nhận, trả phòng và số khách, bảng hai tuần với giá từng đêm của mỗi căn, một đêm đang bị khoá và tỉ lệ lấp đầy ở hàng đầu.'),
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
        {'kind': 'faq', 'items': [
            ('Bot có tự chốt đặt phòng không?', 'Không. Bot tạo lượt giữ chỗ có thời hạn và báo nhân viên. Việc xác nhận và nhận cọc vẫn do đội của bạn làm.'),
            ('Giữ chỗ hết hạn thì sao?', 'Lượt giữ chỗ chưa được xác nhận sẽ tự hết hạn và đêm đó mở lại trên lịch, tránh giữ phòng ảo.'),
            ('Giá cuối tuần, ngày lễ khai báo thế nào?', 'Bạn đặt giá theo thứ trong tuần và theo khoảng ngày cho từng gói phòng. Bot tính đúng giá của đêm khách hỏi.'),
            ('Tôi có nhiều villa ở nhiều nơi?', 'Một tài khoản quản lý nhiều cơ sở. Mỗi cơ sở có lịch, bảng giá và bot riêng, xem chung trên một màn hình tổng quan.'),
            ('Khách hỏi ngoài lề như BBQ, thú cưng?', 'Bot trả lời theo sổ tay và câu hỏi thường gặp bạn soạn. Chưa có thông tin thì bot nói chưa có và mời nhân viên.'),
            FAQ_HANDOFF,
        ]},
        related('Lịch phòng<br><em>nối với những phần nào?</em>', 'tinh-nang/khach-hang-thong-ke', 'tinh-nang/ban-hang-ai', 'tinh-nang/tro-ly-rapiz'),
        {'kind': 'close', 'h2': 'Cho bot đọc<br><em>lịch phòng của bạn.</em>', 'demo_query': '?nganh=villa-homestay'},
    ],
})

PAGES.append({
    'slug': 'nganh/spa-salon', 'group': 'Giải pháp · Làm đẹp & spa',
    'title': 'Làm đẹp & spa: tư vấn dịch vụ và đặt lịch trong chat | Rapiz',
    'description': 'Rapiz tư vấn dịch vụ theo bảng giá của bạn, ghi lịch hẹn đủ dịch vụ, chi nhánh, ngày giờ, số người và chuyển lễ tân xác nhận.',
    'h1': 'Khách hỏi dịch vụ.<br><em>Lễ tân nhận lịch hẹn.</em>',
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
        shot('ui-contacts.jpg', 'MÀN HÌNH THẬT', 'Lễ tân thấy ngay<br><em>ai đang chờ xác nhận.</em>',
             'Danh sách Khách hàng của một spa đếm sẵn khách theo trạng thái: khách mới, đang tư vấn, yêu cầu đặt lịch, đã xác nhận lịch, đã đến. Khách bot vừa ghi nhận nằm ở cột Yêu cầu đặt lịch.',
             'Màn hình Khách hàng của Rapiz cho một spa: các ô đếm theo trạng thái Khách mới, Đang tư vấn, Yêu cầu đặt lịch, Đã xác nhận lịch, Đã đến, Không đến, Không quan tâm, và bảng khách với số điện thoại, nguồn Website và trạng thái Yêu cầu đặt lịch.',
             1600, 1000),
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
        {'kind': 'faq', 'items': [
            ('Bot có xác nhận lịch thay lễ tân không?', 'Bot ghi nhận yêu cầu hẹn với đủ thông tin và báo cho lễ tân. Lễ tân xác nhận lại với khách theo lịch thực tế của cơ sở.'),
            ('Khách nhắn “thứ 7” mà không nói ngày?', 'Bot quy đổi sang ngày cụ thể và nhắc lại để khách kiểm tra, không nhận ngày đã qua.'),
            ('Tôi có 3 chi nhánh, giá khác nhau?', 'Mỗi chi nhánh có thông tin, bảng giá và giờ làm việc riêng. Yêu cầu hẹn mang tên chi nhánh khách chọn.'),
            ('Khách hỏi về liệu trình, chống chỉ định?', 'Bot trả lời theo tài liệu bạn cung cấp. Câu hỏi cần chuyên môn sẽ được chuyển cho nhân viên tư vấn.'),
            FAQ_DATA,
            FAQ_HANDOFF,
        ]},
        related('Lễ tân dùng thêm<br><em>những màn hình này.</em>', 'tinh-nang/khach-hang-thong-ke', 'tinh-nang/binh-luan-facebook', 'tinh-nang/dao-tao-ai'),
        {'kind': 'close', 'h2': 'Xem bot hỏi đủ thông tin<br><em>cho một lịch hẹn spa.</em>', 'demo_query': '?nganh=spa-salon'},
    ],
})

PAGES.append({
    'slug': 'nganh/giao-duc', 'group': 'Giải pháp · Giáo dục & đào tạo',
    'title': 'Giáo dục & đào tạo: tư vấn lộ trình, ghi danh học thử | Rapiz',
    'description': 'Rapiz tư vấn chương trình, ghi danh test trình độ và học thử, nhận đăng ký phụ huynh làm cho con và chuyển hồ sơ cho tư vấn viên.',
    'h1': 'Phụ huynh hỏi lớp.<br><em>Con có buổi học thử.</em>',
    'deck': 'Rapiz tư vấn chương trình, ghi danh test trình độ hoặc học thử, nhận đăng ký phụ huynh làm cho con. Tư vấn viên nhận hồ sơ đủ thông tin để xếp lớp.',
    'demo_query': '?nganh=giao-duc',
    'points': ['Phụ huynh đăng ký cho con'],
    'visual': {'img': 'rapiz-education-class.webp', 'w': 840, 'h': 1050, 'alt': 'Lớp học nhỏ với học sinh và giáo viên',
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
        shot('ui-training-clean.jpg', 'MÀN HÌNH THẬT', 'Trung tâm tự dặn bot<br><em>cách nói với phụ huynh.</em>',
             'Trong Đào tạo Bot, bạn ghi nhiệm vụ của bot, cách xưng hô, độ dài câu và lời chào, rồi chat thử ở cột bên phải. Ảnh dưới là bot của một spa; trung tâm giáo dục điền theo cách tư vấn tuyển sinh của mình.',
             'Màn hình Đào tạo Bot của Rapiz, mục Hướng dẫn trả lời: ô nhiệm vụ của bot, chọn cách xưng hô, độ dài câu trả lời, giọng điệu và lời chào; bên phải là Đoạn chat thử nghiệm với các câu hỏi gợi ý.'),
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
        related('Hồ sơ tuyển sinh<br><em>đi tiếp tới đâu?</em>', 'tinh-nang/khach-hang-thong-ke', 'tinh-nang/dao-tao-ai', 'tinh-nang/hop-thu'),
        {'kind': 'close', 'h2': 'Để bot nhận<br><em>câu hỏi tuyển sinh.</em>', 'demo_query': '?nganh=giao-duc'},
    ],
})

PAGES.append({
    'slug': 'nganh/phan-mem', 'group': 'Giải pháp · Công nghệ & phần mềm',
    'title': 'Công nghệ & phần mềm: trả lời câu hỏi sản phẩm, nhận yêu cầu demo | Rapiz',
    'description': 'Rapiz trả lời câu hỏi sản phẩm từ tài liệu của bạn, nhận yêu cầu demo hoặc dùng thử kèm quy mô đội và nhu cầu, theo dõi gói, MRR và khách rời bỏ.',
    'h1': 'Khách hỏi tính năng.<br><em>Sale nhận yêu cầu demo.</em>',
    'deck': 'Rapiz trả lời câu hỏi sản phẩm từ tài liệu của bạn, nhận yêu cầu demo hoặc dùng thử kèm quy mô đội và nhu cầu, và giúp bạn theo dõi gói, MRR và khách rời bỏ.',
    'demo_query': '?nganh=phan-mem',
    'points': ['Khung chat trên website', 'Gọi API của bạn', 'Theo dõi gói và MRR'],
    'visual': {'img': 'rapiz-software-team.webp', 'w': 840, 'h': 1050, 'alt': 'Đội ngũ phần mềm làm việc trước màn hình',
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
        shot('ui-channels.jpg', 'MÀN HÌNH THẬT', 'Gắn khung chat<br><em>vào website của bạn.</em>',
             'Trong Tích hợp nền tảng, mỗi website có mã nhúng riêng và một bot được gán để trả lời. Sao chép mã, dán vào trang, bật công tắc là khung chat chạy.',
             'Màn hình Tích hợp nền tảng của Rapiz: cột trái lọc theo Facebook, Instagram, Zalo, Lazada, TikTok Business và Website; bên phải là một website đã kết nối, trạng thái Đang chạy, nút Sao chép mã nhúng và Hướng dẫn cài đặt.',
             1600, 1000),
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
        related('Cho đội sale<br><em>và đội kỹ thuật.</em>', 'tich-hop', 'tinh-nang/ban-hang-ai', 'tinh-nang/khach-hang-thong-ke'),
        {'kind': 'close', 'h2': 'Đặt bot lên<br><em>trang giá của bạn.</em>', 'demo_query': '?nganh=phan-mem'},
    ],
})


# ===== features =====

PAGES.append({
    'slug': 'tinh-nang/ban-hang-ai', 'group': 'Tính năng · Tư vấn & chốt đơn',
    'title': 'Tư vấn & chốt đơn: bot báo đúng giá, khách bấm Đặt hàng | Rapiz',
    'description': 'Bot tra giá và tồn kho trong danh mục của bạn, gửi tóm tắt đơn để khách bấm Đặt hàng. Đơn bot tạo mang nhãn Bot và chờ nhân viên duyệt.',
    'assets': ['feature-edition.css', 'sale-edition.css', 'image-lightbox.js', 'sale-demo.js'],
    'cover': {'h1': 'Bot báo giá,<br><em>khách tự chốt.</em>',
              'deck': 'Giá và tồn kho lấy từ danh mục của bạn. Đơn chỉ được tạo khi khách xác nhận tóm tắt đơn, rồi chờ nhân viên kiểm tra.',
              'cta': 'Thử chốt một đơn', 'demo': 'chot-don', 'scene': 'scene-ban-hang-ai.html'},
    'blocks': [
        {'kind': 'demo', 'template': 'demo-ban-hang-ai.html'},
        {'kind': 'inspect', 'kicker': 'GIAO DIỆN ĐƠN HÀNG', 'h2': 'Đơn bot tạo<br><em>chờ bạn kiểm tra.</em>',
         'img': 'ui-orders-list-2026.webp', 'w': 2000, 'h': 788, 'window': 'Đơn hàng › Danh sách đơn hàng',
         'alt': 'Danh sách đơn hàng của Rapiz với bốn đơn: ba đơn mang nhãn Bot, có đơn đã duyệt và đơn tạo trong Đoạn chat thử nghiệm mang nhãn Chat thử; một đơn từ Facebook do nhân viên tạo. Mỗi dòng ghi mã đơn, khách, sản phẩm, tiền cần thu, nguồn, người tạo, thời gian và trạng thái.',
         'notes': [('Đơn bot tạo', 'Mang nhãn Bot. Đơn tạo khi thử bot trong Đoạn chat thử nghiệm có thêm nhãn Chat thử; đơn nhân viên nhập ghi tên người tạo.'),
                   ('Sản phẩm và tiền', 'Mỗi đơn ghi mã đơn, khách, sản phẩm và số tiền cần thu, kể cả phần thu hộ khi giao.')],
         'caption': 'Đơn bot tạo nằm chung với đơn nhân viên nhập. Lọc cột Người tạo để xem riêng đơn của bot.'},
        {'kind': 'more', 'h2': 'Những điều<br><em>bot giữ đúng.</em>', 'items': [
            ('Bật chốt đơn và phí ship', 'Bật Bot chốt đơn và đặt Phí ship mặc định. Để trống thì tóm tắt ghi “Phí ship: shop báo sau”.', 'Đào tạo Bot › Cài đặt › Thiết lập bot › Cài đặt nâng cao'),
            ('Không chốt theo giá cũ', 'Tóm tắt đơn giữ trong 30 phút. Nếu giá đổi hoặc hết hàng trước khi khách xác nhận, đơn không được tạo theo số cũ.', 'Áp dụng cho mọi đơn bot tạo'),
            ('Gửi ảnh thật của sản phẩm', 'Khách hỏi mẫu, bot gửi ảnh có sẵn trong danh mục thay vì tả bằng lời.', 'Sản phẩm › ảnh của từng sản phẩm'),
            ('Gọi API riêng của bạn', 'Bot tra đơn hay lịch ở hệ thống khác. Thao tác ghi dữ liệu như đặt lịch chỉ chạy khi khách đồng ý.', 'Đào tạo Bot › Hành động API'),
        ]},
        {'kind': 'faq', 'h2': 'Trước khi<br><em>giao bot bán hàng.</em>', 'items': [
            ('Bot có tự đổi giá cho khách không?', 'Không. Giá trong tóm tắt đơn do hệ thống tính từ danh mục. Ưu đãi bot nói lấy từ ô Khuyến mãi đang chạy trong thông tin doanh nghiệp.'),
            ('Phí ship tính thế nào?', 'Bạn đặt Phí ship mặc định cho bot. Nếu để trống, tóm tắt đơn ghi “Phí ship: shop báo sau”.'),
            ('Đơn bot tạo khác đơn nhân viên nhập thế nào?', 'Đơn bot tạo mang nhãn Bot và Chờ duyệt. Nhân viên mở đơn, kiểm tra rồi bấm Duyệt đơn. Nếu bạn nối KiotViet (đang thử nghiệm), đơn chưa duyệt không được đẩy sang đó.'),
            ('Tôi sửa giá thì bot dùng giá nào?', 'Bot đọc giá mới ngay. Tóm tắt đã gửi theo giá cũ sẽ không thành đơn, khách cần xác nhận một tóm tắt mới.'),
        ]},
        {'kind': 'related', 'compact': True, 'slugs': ['tinh-nang/khach-hang-thong-ke', 'tinh-nang/dao-tao-ai', 'nganh/ban-le']},
        {'kind': 'close', 'h2': 'Để bot báo giá<br><em>bằng danh mục của bạn.</em>'},
    ],
})

PAGES.append({
    'slug': 'tinh-nang/binh-luan-facebook', 'group': 'Tính năng · Tự động xử lý bình luận',
    'title': 'Tự động xử lý bình luận Facebook theo bài đăng | Rapiz',
    'description': 'Rapiz đọc bài viết gốc để trả lời bình luận công khai, nhắn riêng cho người bình luận và ẩn bình luận khớp từ khóa bạn đặt. Ba việc bật tắt riêng cho từng fanpage.',
    'assets': ['feature-edition.css', 'comment-edition.css', 'comment-demo.js'],
    'cover': {'h1': 'Đáp bình luận<br><em>theo đúng bài.</em>',
              'deck': 'Rapiz đọc bài viết gốc để trả lời công khai, nhắn riêng cho người bình luận và ẩn bình luận khớp từ khóa bạn đặt. Ba việc bật tắt riêng.',
              'cta': 'Thử bật công tắc', 'demo': 'cong-tac', 'scene': 'scene-binh-luan-facebook.html', 'more_link': 'Xem nơi bật'},
    'blocks': [
        {'kind': 'demo', 'template': 'demo-binh-luan-facebook.html'},
        {'kind': 'more', 'kicker': 'BẬT Ở ĐÂU', 'h2': 'Một màn cài đặt<br><em>cho mỗi fanpage.</em>', 'items': [
            ('Ba công tắc, mặc định đều tắt', 'Trả lời công khai, nhắn riêng và ẩn theo từ khóa bật tắt độc lập. Bạn bật phần nào cần.', 'Tích hợp nền tảng › Bài viết và bình luận Facebook'),
            ('Chọn bài được tự động', 'Bật hoặc tắt tự động cho từng bài trong 50 bài viết gần nhất. Tắt một bài thì cả ẩn theo từ khóa cũng tắt cho bài đó.', 'Tích hợp nền tảng › Bài viết và bình luận Facebook'),
            ('Xử lý tiếp trong hộp thư', 'Xem bài gốc, trả lời công khai, nhắn riêng hoặc ẩn những bình luận cần người xem.', 'Tin nhắn đa kênh › Bình luận trên Facebook'),
            ('Hết lượt AI vẫn ẩn được', 'Khi hết lượt trả lời AI, bình luận mới chờ nhân viên. Ẩn theo từ khóa vẫn chạy.', 'Áp dụng cho mọi fanpage đã bật'),
        ]},
        {'kind': 'faq', 'h2': 'Trước khi<br><em>bật tự động.</em>', 'items': [
            ('Tính năng này có trong gói nào?', 'Từ gói Sales Smart trở lên.'),
            ('Rapiz ẩn những bình luận nào?', 'Chỉ bình luận khớp từ khóa bạn đặt, mỗi dòng một từ. Phản ánh khác vẫn hiển thị để nhân viên kiểm tra.'),
            ('Ẩn có xoá bình luận không?', 'Không. Bình luận chỉ bị ẩn khỏi bài và bấm Hiện lại là hiển thị trở lại.'),
            ('Tin nhắn riêng gửi được gì?', 'Một tin văn bản, cùng nội dung với câu trả lời, vào Messenger của người bình luận. Facebook chỉ cho gửi một tin trong 7 ngày kể từ bình luận.'),
        ]},
        {'kind': 'related', 'compact': True, 'slugs': ['tinh-nang/hop-thu', 'tinh-nang/ban-hang-ai', 'nganh/ban-le']},
        {'kind': 'close', 'h2': 'Bài quảng&nbsp;cáo lên<br><em>là có người trực bình luận.</em>'},
    ],
})

PAGES.append({
    'slug': 'tinh-nang/hop-thu', 'group': 'Tính năng · Tin nhắn đa kênh',
    'title': 'Tin nhắn đa kênh: bot và nhân viên làm chung | Rapiz',
    'description': 'Hộp thư đa kênh cho đội sale: bật tắt bot từng hội thoại, tiếp quản một chạm, hồ sơ khách và tạo đơn cạnh khung chat, thông báo đẩy trên điện thoại.',
    'assets': ['feature-edition.css', 'inbox-edition.css', 'handoff.css', 'image-lightbox.js', 'handoff.js'],
    'cover': {'h1': 'Biết khách nào<br><em>đang chờ bạn.</em>',
              'deck': 'Tin từ nhiều kênh về cùng một hộp thư. Khi khách cần người hỗ trợ, Rapiz gửi kèm lý do để bạn tiếp lời.',
              'cta': 'Thử tiếp quản', 'demo': 'handoff', 'scene': 'scene-hop-thu.html'},
    'blocks': [
        {'kind': 'demo', 'template': 'demo-hop-thu.html'},
        {'kind': 'inspect', 'kicker': 'GIAO DIỆN HỘP THƯ', 'h2': 'Đọc lại trước khi<br><em>tiếp lời.</em>',
         'img': 'ui-inbox-handoff-2026.webp', 'w': 4032, 'h': 2808, 'window': 'Hộp thư',
         'alt': 'Hộp thư Rapiz: danh sách hội thoại từ website bên trái; ở giữa khách báo đơn giao thiếu và bot chuyển cho nhân viên, thanh chế độ ghi nhân viên đang trả lời và bot bật lại sau vài phút; bên phải là trang khách vào, ô gắn khách hàng CRM, nhãn và ghi chú.',
         'notes': [('Cuộc trò chuyện', 'Khách báo đơn giao thiếu, bot chuyển cho nhân viên. Thanh trên cùng cho biết nhân viên đang trả lời và bot tự bật lại sau bao lâu.'),
                   ('Danh sách hội thoại', 'Chọn kênh và lọc Chưa đọc, Chờ trả lời hoặc Ưu tiên.'),
                   ('Hồ sơ khách', 'Xem khách vào từ trang nào, đang xem trang nào và đã để lại số điện thoại chưa.')],
         'caption': 'Danh sách hội thoại, cuộc trò chuyện và hồ sơ khách nằm trên cùng một màn.'},
        {'kind': 'more', 'h2': 'Những thứ<br><em>đội trực hay dùng.</em>', 'items': [
            ('Lọc việc cần làm', 'Một chạm để xem hội thoại Chưa đọc, Chờ trả lời hoặc Ưu tiên, trên mọi kênh.', 'Tin nhắn đa kênh › bộ lọc'),
            ('Bình luận chung một chỗ', 'Xem bài gốc rồi trả lời công khai, nhắn riêng hoặc ẩn bình luận ngay trong hộp thư.', 'Tin nhắn đa kênh › Bình luận trên Facebook'),
            ('Hồ sơ khách cạnh khung chat', 'Xem nguồn khách, số điện thoại, trạng thái và nhãn, mở hồ sơ đầy đủ khi cần.', 'Tin nhắn đa kênh › cột phải'),
            ('Phím tắt cho người trực', 'J và K đổi khách, R soạn tin, E đánh dấu xong, U đánh dấu chưa đọc.', 'Tin nhắn đa kênh'),
        ]},
        {'kind': 'faq', 'h2': 'Khi cả đội<br><em>cùng trực.</em>', 'items': [
            ('Nhân viên trả lời thì bot có dừng không?', 'Có. Bot dừng trong cuộc trò chuyện đó. Bạn có thể bật lại bằng tay hoặc đặt thời gian tự bật lại.'),
            ('Ai phụ trách khách mới?', 'Khách mới được chia theo quy tắc bạn đặt. Bạn cũng có thể giao một hội thoại cho một nhân viên cụ thể.'),
            ('Tôi có thể trực trên điện thoại không?', 'Có. Bạn có thể cài Rapiz như một ứng dụng và bật thông báo khi bot cần người tiếp quản.'),
        ]},
        {'kind': 'related', 'compact': True, 'slugs': ['tinh-nang/binh-luan-facebook', 'tinh-nang/khach-hang-thong-ke', 'tich-hop']},
        {'kind': 'close', 'h2': 'Cả đội và bot<br><em>chung một hộp thư.</em>'},
    ],
})

PAGES.append({
    'slug': 'tinh-nang/dao-tao-ai', 'group': 'Tính năng · Đào tạo Bot',
    'title': 'Đào tạo Bot: dặn bot bằng tiếng Việt, hỏi thử ngay | Rapiz',
    'description': 'Điền thông tin cửa hàng, dặn bot cách xử lý từng tình huống và hỏi thử ngay trong Đoạn chat thử nghiệm. Mọi lần sửa được ghi vào Lịch sử chỉnh sửa để khôi phục.',
    'assets': ['feature-edition.css', 'train-edition.css', 'image-lightbox.js', 'train-demo.js'],
    'cover': {'h1': 'Bot chưa rõ,<br><em>bạn dặn thêm.</em>',
              'deck': 'Điền thông tin cửa hàng, dặn cách xử lý từng tình huống, rồi hỏi thử ngay bên cạnh. Mỗi lần sửa đều được ghi lại để khôi phục.',
              'cta': 'Thử dặn bot', 'demo': 'day-bot', 'scene': 'scene-dao-tao-ai.html'},
    'blocks': [
        {'kind': 'demo', 'template': 'demo-dao-tao-ai.html'},
        {'kind': 'inspect', 'kicker': 'GIAO DIỆN ĐÀO TẠO BOT', 'h2': 'Sửa bên trái,<br><em>hỏi thử bên phải.</em>',
         'img': 'ui-training-rules-2026.webp', 'w': 2000, 'h': 1443, 'window': 'Đào tạo Bot › Hướng dẫn trả lời',
         'alt': 'Màn Hướng dẫn trả lời trong Đào tạo Bot của Rapiz, cửa hàng là một villa cho thuê: các tình huống nhóm Chung và Sau khi chốt đơn, mỗi tình huống ghi “Khi khách …” và việc Bot sẽ làm, kèm công tắc bật tắt; bên phải là Đoạn chat thử nghiệm với ba câu hỏi gợi ý.',
         'notes': [('Danh sách tình huống', 'Mỗi tình huống ghi rõ khi nào áp dụng và bot sẽ làm gì. Tắt một cái là bot thôi làm theo.'),
                   ('Đoạn chat thử nghiệm', 'Hỏi như khách thật, hoặc bấm câu hỏi gợi ý để xem bot trả lời ra sao.')],
         'caption': 'Sửa tình huống bên trái, hỏi lại ngay bên phải mà không cần mở Messenger.'},
        {'kind': 'more', 'h2': 'Còn gì<br><em>để dạy bot.</em>', 'items': [
            ('Ô thông tin theo ngành', 'Mỗi ngành có sẵn các ô như thanh toán, giao hàng, đổi trả. Bot đọc đúng những gì bạn ghi.', 'Đào tạo Bot › Thông tin doanh nghiệp'),
            ('Câu hỏi thường gặp từ tệp CSV', 'Nhập tối đa 100 câu hỏi và câu trả lời một lần, thêm vào danh sách đang có.', 'Đào tạo Bot › Thông tin doanh nghiệp'),
            ('Tin nhắn nhanh', 'Lưu sẵn câu hay dùng với từ viết tắt như /uudai để nhân viên gõ nhanh trong hộp thư.', 'Đào tạo Bot › Cài đặt › Tin nhắn nhanh'),
            ('Tool Ads Facebook', 'Tạo mã JSON cho mẫu tin nhắn của quảng cáo Click-to-Messenger, rồi dán vào Trình quản lý quảng cáo.', 'Đào tạo Bot › Tool Ads Facebook'),
        ]},
        {'kind': 'faq', 'h2': 'Trước khi<br><em>dạy bot.</em>', 'items': [
            ('Tôi không rành công nghệ, có tự dạy bot được không?', 'Được. Bạn điền biểu mẫu bằng tiếng Việt, bắt đầu từ mẫu của ngành. Trợ lý Rapiz có thể soạn sẵn nội dung thành đề xuất, bạn kiểm tra rồi bấm Áp dụng.'),
            ('Bot trả lời sai thì sửa ở đâu?', 'Hỏi lại trong Đoạn chat thử nghiệm và mở Các bước bot đã làm để xem bot đã tra gì. Sửa ô thông tin hoặc tình huống liên quan rồi hỏi lại.'),
            ('Lỡ sửa sai thì sao?', 'Mở Lịch sử chỉnh sửa và bấm Khôi phục ở lần sửa trước đó.'),
            ('Một tài khoản có nhiều bot được không?', 'Có. Mỗi bot có thông tin, tình huống và danh sách sản phẩm riêng, gắn với trang riêng.'),
        ]},
        {'kind': 'related', 'compact': True, 'slugs': ['tinh-nang/ban-hang-ai', 'tinh-nang/tro-ly-rapiz', 'tich-hop']},
        {'kind': 'close', 'h2': 'Soạn sổ tay một lần,<br><em>bot dùng mỗi ngày.</em>'},
    ],
})

PAGES.append({
    'slug': 'tinh-nang/tro-ly-rapiz', 'group': 'Tính năng · Trợ lý & thống kê',
    'title': 'Trợ lý & thống kê: hỏi số liệu bằng tiếng Việt, duyệt mọi thay đổi | Rapiz',
    'description': 'Trợ lý Rapiz đọc số liệu cửa hàng và trả lời bằng chữ, biểu đồ hoặc bảng; đặt lịch báo cáo; tìm lý do bot trả lời chưa tốt. Mọi thay đổi đều chờ chủ shop bấm Áp dụng.',
    'assets': ['feature-edition.css', 'assistant-edition.css', 'image-lightbox.js', 'assistant-demo.js'],
    'cover': {'h1': 'Tuần này<br><em>bao nhiêu đơn?</em>',
              'deck': 'Hỏi bằng tiếng Việt, Trợ lý Rapiz đọc số liệu cửa hàng rồi trả lời bằng chữ, biểu đồ hoặc bảng. Việc cần sửa thành đề xuất chờ bạn duyệt.',
              'cta': 'Thử hỏi trợ lý', 'demo': 'hoi-tro-ly', 'scene': 'scene-tro-ly-rapiz.html'},
    'blocks': [
        {'kind': 'demo', 'template': 'demo-tro-ly-rapiz.html'},
        {'kind': 'inspect', 'kicker': 'GIAO DIỆN THỐNG KÊ', 'h2': 'Hỏi ngay<br><em>cạnh con số.</em>',
         'img': 'ui-assistant-2026.webp', 'w': 4000, 'h': 3000, 'window': 'Thống kê',
         'alt': 'Màn Thống kê của Rapiz với các ô Hội thoại mới, Khách hàng mới, Số điện thoại thu được; bên phải là khung trợ lý đang trả lời câu hỏi số đơn 7 ngày qua bằng một biểu đồ cột và nút Xem bảng.',
         'notes': [('Câu trả lời của trợ lý', 'Trợ lý vẽ biểu đồ từ số liệu thật của cửa hàng, kèm nút Xem bảng để xem từng con số.')],
         'caption': 'Khung trợ lý mở được ở mọi màn trong app, cạnh số liệu bạn đang xem.'},
        {'kind': 'more', 'h2': 'Trợ lý còn<br><em>làm được gì.</em>', 'items': [
            ('Nhập sản phẩm từ Excel và ảnh', 'Gửi tệp Excel, CSV hoặc ảnh sản phẩm. Trợ lý soạn bản xem trước, bạn duyệt rồi mới tạo.', 'Khung trợ lý › Đính kèm tệp'),
            ('Cảnh báo khi cần', 'Đặt cảnh báo khách chờ trả lời quá lâu hay sản phẩm sắp hết hàng, gửi trong ứng dụng, email hoặc thông báo đẩy.', 'Khung trợ lý › Lịch báo cáo'),
            ('Nhớ điều bạn dặn', 'Trợ lý ghi nhớ cách bạn muốn làm việc. Bạn xem và xoá từng điều bất cứ lúc nào.', 'Khung trợ lý › Trợ lý nhớ gì'),
            ('Nhiều doanh nghiệp, một màn hình', 'Một tài khoản quản lý nhiều doanh nghiệp, xem số liệu chung rồi bấm vào từng nơi.', 'Tổng quan các business'),
        ]},
        {'kind': 'faq', 'h2': 'Trước khi<br><em>giao việc cho trợ lý.</em>', 'items': [
            ('Trợ lý có tự sửa bot hay dữ liệu không?', 'Không. Mọi thay đổi hiện thành thẻ đề xuất. Chỉ khi bạn bấm Áp dụng thì thay đổi mới có hiệu lực.'),
            ('Trợ lý xem được số liệu nào?', 'Số liệu của doanh nghiệp bạn đang quản lý, qua truy vấn chỉ đọc. Dữ liệu của mỗi doanh nghiệp được tách riêng.'),
            ('Báo cáo gửi qua kênh nào?', 'Trong ứng dụng, email hoặc thông báo đẩy trên điện thoại.'),
            ('Thống kê đếm những gì?', 'Hội thoại mới, khách hàng mới, số điện thoại thu được và tin nhắn khách gửi, xem theo ngày và lọc theo trang hoặc kênh.'),
        ]},
        {'kind': 'related', 'compact': True, 'slugs': ['tinh-nang/dao-tao-ai', 'tinh-nang/khach-hang-thong-ke', 'tinh-nang/ban-hang-ai']},
        {'kind': 'close', 'h2': 'Muốn sáng mai biết doanh thu?<br><em>Hẹn trợ lý gửi báo cáo.</em>'},
    ],
})

PAGES.append({
    'slug': 'tinh-nang/khach-hang-thong-ke', 'group': 'Tính năng · Khách hàng, đơn hàng & lịch',
    'title': 'Khách hàng, đơn hàng & lịch: trạng thái theo ngành, yêu cầu bot ghi nhận | Rapiz',
    'description': 'Mỗi khách có nguồn, trạng thái theo ngành, nhãn và người phụ trách. Bot ghi nhận yêu cầu đặt lịch hay học thử, nhân viên xác nhận; đơn hàng và lịch lưu trú nằm cùng một chỗ.',
    'assets': ['feature-edition.css', 'crm-edition.css', 'image-lightbox.js', 'crm-demo.js'],
    'cover': {'h1': 'Khách đang<br><em>ở bước nào?</em>',
              'deck': 'Mỗi khách có nguồn, trạng thái theo ngành, nhãn và người phụ trách. Bot ghi nhận yêu cầu, nhân viên làm các bước sau.',
              'cta': 'Thử theo một khách', 'demo': 'theo-khach', 'scene': 'scene-khach-hang-thong-ke.html'},
    'blocks': [
        {'kind': 'demo', 'template': 'demo-khach-hang-thong-ke.html'},
        {'kind': 'inspect', 'kicker': 'GIAO DIỆN KHÁCH HÀNG', 'h2': 'Đếm sẵn khách<br><em>ở từng bước.</em>',
         'img': 'ui-contacts-spa-2026.webp', 'w': 3978, 'h': 2028, 'window': 'Khách hàng',
         'alt': 'Màn Khách hàng của một spa trên Rapiz: các ô đếm Yêu cầu 7 ngày qua, Đang chờ xử lý và từng trạng thái; bảng bảy khách với số điện thoại, nguồn Website, Hotline, Facebook, Instagram và trạng thái Yêu cầu đặt lịch, Đã xác nhận lịch, Đã đến, Đang tư vấn.',
         'notes': [('Nguồn và trạng thái', 'Khách đặt lịch qua website được bot chuyển sang Yêu cầu đặt lịch. Nhân viên chuyển tiếp các bước sau.'),
                   ('Ô đếm theo trạng thái', 'Mỗi ngành có bộ trạng thái riêng. Bấm một ô để lọc danh sách.')],
         'caption': 'Tìm theo tên, số điện thoại hoặc email, lọc và chọn cột muốn xem.'},
        {'kind': 'more', 'h2': 'Đơn, lịch<br><em>và người phụ trách.</em>', 'items': [
            ('Đơn bot tạo chờ duyệt', 'Đơn khách xác nhận trong chat mang nhãn Bot. Lọc cột Người tạo để xem riêng đơn chờ duyệt.', 'Đơn hàng › Danh sách đơn'),
            ('Lịch và Booking cho lưu trú', 'Xem căn trống theo 2 tuần hoặc theo tháng. Giữ chỗ tự hết hạn sau số phút bạn đặt.', 'Lịch · Booking · Căn hộ'),
            ('Tự chia khách cho Sales', 'Khách mới từ mỗi nguồn được giao lần lượt cho các Sales theo tỉ lệ bạn đặt.', 'Cài đặt khách hàng › Phân chia khách'),
            ('Trạng thái và nhãn của riêng bạn', 'Sửa, thêm và sắp xếp trạng thái. Nhãn có thể kèm trường riêng, như hạng của khách VIP.', 'Cài đặt khách hàng › Trạng thái · Tag'),
        ]},
        {'kind': 'faq', 'h2': 'Trước khi<br><em>giao việc cho đội.</em>', 'items': [
            ('Bot có tự xác nhận lịch hẹn không?', 'Không. Bot chỉ ghi nhận yêu cầu và chuyển khách sang Yêu cầu đặt lịch. Nhân viên gọi xác nhận rồi mới chuyển sang Đã xác nhận lịch.'),
            ('Khách nhắn nhiều lần có bị trùng hồ sơ không?', 'Bot tìm khách theo số điện thoại. Cùng một số thì yêu cầu mới ghi vào hồ sơ cũ.'),
            ('Spa, trung tâm giáo dục có Lịch phòng không?', 'Lịch, Booking và Căn hộ dành cho lưu trú. Spa và giáo dục theo dõi lịch hẹn, học thử bằng trạng thái khách.'),
            ('Có gửi tin nhắn hàng loạt cho khách cũ không?', 'Chưa. Rapiz hiện tập trung vào trả lời, chốt đơn và theo dõi khách.'),
        ]},
        {'kind': 'related', 'compact': True, 'slugs': ['tinh-nang/ban-hang-ai', 'tinh-nang/hop-thu', 'nganh/spa-salon']},
        {'kind': 'close', 'h2': 'Một hồ sơ cho mỗi khách,<br><em>từ tin nhắn đầu tiên.</em>'},
    ],
})


# ===== platform =====

PAGES.append({
    'slug': 'tich-hop', 'group': 'Nền tảng · Tích hợp nền tảng & PMS',
    'title': 'Tích hợp nền tảng & PMS: Messenger, Instagram, website, KiotViet, API | Rapiz',
    'description': 'Rapiz kết nối Messenger, Instagram, bình luận Facebook và khung chat website; Zalo và TikTok sắp ra mắt. KiotViet đang thử nghiệm, Excel/CSV, API công khai, webhook có chữ ký và Tool Ads Facebook.',
    'h1': 'Trả lời trên kênh khách nhắn,<br><em>bằng dữ liệu bạn đang có.</em>',
    'deck': 'Hai mục giống hệt trong app: Tích hợp nền tảng cho các kênh khách nhắn tới, Tích hợp PMS cho phần mềm bán hàng và kho bạn đang dùng. Đội kỹ thuật có thêm API và webhook.',
    'blocks': [
        {'kind': 'catalog', 'id': 'channels', 'kicker': 'TÍCH HỢP NỀN TẢNG', 'h2': 'Kênh <em>nhắn tin.</em>',
         'lead': 'Kết nối từng trang hoặc tài khoản, rồi chọn bot trả lời cho trang đó. Trạng thái dưới đây khớp với app.',
         'items': [
             {'icon': 'comment', 'title': 'Facebook Messenger', 'text': 'Kết nối fanpage, bot trả lời tin nhắn và gửi tóm tắt đơn có nút xác nhận.', 'link': 'tinh-nang/hop-thu'},
             {'icon': 'comment', 'title': 'Bình luận Facebook', 'status': 'Gói Smart trở lên', 'text': 'Trả lời công khai theo bài đăng, nhắn riêng, ẩn bình luận theo từ khoá, loại trừ bài.', 'link': 'tinh-nang/binh-luan-facebook'},
             {'icon': 'image', 'title': 'Instagram DM', 'status': 'Beta', 'text': 'Trả lời tin nhắn Instagram của tài khoản chuyên nghiệp, ngay trong cùng hộp thư.'},
             {'icon': 'globe', 'title': 'Khung chat website', 'status': 'Gói Smart trở lên', 'text': 'Mã nhúng nhẹ, khoảng 9 KB. Khách chat ngay trên website và để lại số điện thoại.'},
             {'icon': 'comment', 'title': 'Zalo OA', 'status': 'Sắp ra mắt', 'text': 'Trả lời tin nhắn gửi tới Zalo Official Account của bạn.'},
             {'icon': 'phone', 'title': 'TikTok Business', 'status': 'Sắp ra mắt', 'text': 'Trả lời tin nhắn từ tài khoản TikTok doanh nghiệp.'},
             {'icon': 'comment', 'title': 'WhatsApp', 'status': 'Sắp ra mắt', 'text': 'Trả lời tin nhắn WhatsApp trong cùng hộp thư.'},
             {'icon': 'image', 'title': 'Bình luận Instagram', 'status': 'Sắp ra mắt', 'text': 'Trả lời bình luận dưới bài đăng Instagram như với Facebook.'},
         ]},
        shot('ui-channels.jpg', 'MÀN HÌNH THẬT', 'Mỗi trang một bot,<br><em>bật tắt riêng.</em>',
             'Màn hình Tích hợp nền tảng trong app. Cột trái lọc theo kênh, bên phải là danh sách trang đã kết nối với bot đang trả lời, mã nhúng và công tắc bật tắt.',
             'Màn hình Tích hợp nền tảng của Rapiz: cột trái gồm Tất cả, Chưa gán bot, Facebook, Instagram, Zalo, Lazada, TikTok Business, Website; bên phải là website đã kết nối với trạng thái Đang chạy, tên bot, nút Sao chép mã nhúng và Hướng dẫn cài đặt; bên dưới là khung Bài viết và bình luận Facebook.',
             1600, 1000),
        {'kind': 'catalog', 'id': 'pms', 'cls': 'tint', 'kicker': 'TÍCH HỢP PMS', 'h2': 'Phần mềm <em>bán hàng.</em>',
         'lead': 'Bot đọc sản phẩm và tồn kho từ phần mềm bạn đang dùng, rồi đẩy đơn và khách ngược về đó.',
         'items': [
             {'icon': 'plug', 'title': 'KiotViet', 'status': 'Beta', 'text': 'Lấy sản phẩm và tồn theo chi nhánh, đẩy đơn, đồng bộ khách hàng. Đang chạy với một số shop.'},
             {'icon': 'plug', 'title': 'Sapo', 'status': 'Sắp ra mắt', 'text': 'Đồng bộ sản phẩm, tồn kho và đơn hàng.'},
             {'icon': 'plug', 'title': 'Haravan', 'status': 'Sắp ra mắt', 'text': 'Đồng bộ sản phẩm, tồn kho và đơn hàng.'},
             {'icon': 'plug', 'title': 'Pancake POS', 'status': 'Sắp ra mắt', 'text': 'Đồng bộ sản phẩm, tồn kho và đơn hàng.'},
             {'icon': 'file', 'title': 'Excel, CSV và ảnh', 'text': 'Chưa dùng phần mềm nào thì nhập danh mục từ tệp. Trợ lý Rapiz đọc tệp, ghép biến thể và chờ bạn duyệt.'},
         ]},
        {'kind': 'duo', 'kicker': 'MỞ RỘNG', 'h2': 'Dành cho đội kỹ thuật<br><em>và người chạy quảng cáo.</em>',
         'cards': [
             {'kicker': 'DÀNH CHO ĐỘI KỸ THUẬT', 'title': 'API và webhook', 'text': 'Cho bot gọi hệ thống của bạn, hoặc kéo dữ liệu Rapiz về CRM và kho dữ liệu.',
              'chips': [('Hành động API', None), ('API công khai', 'Gói Pro, Neo'), ('Webhook có chữ ký', 'Gói Pro, Neo'), ('Tài liệu OpenAPI', None)],
              'ticks': ['Hành động API: bot tra đơn, kiểm tồn ở hệ thống của bạn, có bước xác nhận', 'Chặn gọi vào mạng nội bộ', 'Giới hạn 120 yêu cầu mỗi phút trên gói Pro và Neo'],
              'link': ('Xem hành động API', 'tinh-nang/ban-hang-ai')},
             {'kicker': 'QUẢNG CÁO', 'title': 'Tool Ads Facebook', 'text': 'Soạn sẵn đoạn JSON cho quảng cáo Click-to-Messenger: khách bấm quảng cáo là vào thẳng cuộc chat với bot bạn chọn.',
              'ticks': ['Nằm trong Đào tạo Bot, mục Tool Ads Facebook'],
              'link': ('Xem trong Đào tạo Bot', 'tinh-nang/dao-tao-ai')},
         ]},
        {'kind': 'steps', 'cls': 'tint', 'kicker': 'BẮT ĐẦU NHANH', 'h2': 'Bốn bước<br><em>để bot bắt đầu trả lời.</em>',
         'items': [
             ('Tạo tài khoản', 'Đăng ký bằng email và mã xác thực, chọn ngành cho doanh nghiệp đầu tiên.'),
             ('Kết nối kênh', 'Chọn fanpage Messenger hoặc tài khoản Instagram, bật bình luận, hoặc dán mã nhúng khung chat vào website.'),
             ('Đưa dữ liệu vào', 'Nhập danh mục từ Excel hoặc KiotViet (đang thử nghiệm), điền thông tin doanh nghiệp theo bộ mẫu ngành.'),
             ('Chat thử rồi bật', 'Thử như khách thật ở Đoạn chat thử nghiệm, rồi gán bot cho trang.'),
         ]},
        {'kind': 'faq', 'items': [
            ('Kết nối Messenger có ảnh hưởng fanpage không?', 'Rapiz kết nối qua quyền Meta cấp cho ứng dụng. Bạn vẫn dùng fanpage như bình thường và có thể tắt bot bất cứ lúc nào.'),
            ('Khi nào có Zalo và TikTok?', 'Các kênh này đang được hoàn thiện. Nhãn “Sắp ra mắt” sẽ được bỏ khi kết nối chạy thật.'),
            ('Tôi dùng phần mềm bán hàng khác KiotViet?', 'Bạn nhập danh mục qua Excel hoặc CSV, hoặc để đội kỹ thuật kết nối qua API và webhook. Kết nối Sapo, Haravan và Pancake POS sắp ra mắt.'),
            ('Webhook có chữ ký là gì?', 'Mỗi sự kiện Rapiz gửi đi kèm chữ ký để hệ thống của bạn kiểm tra đúng là từ Rapiz và không bị sửa trên đường truyền.'),
        ]},
        related('Trước khi kết nối,<br><em>nên xem thêm.</em>', 'tinh-nang/hop-thu', 'bao-mat', 'bang-gia'),
        {'kind': 'close', 'h2': 'Kể cho chúng tôi<br><em>hệ thống bạn đang dùng.</em>'},
    ],
})

PAGES.append({
    'slug': 'bao-mat', 'group': 'Nền tảng · Bảo mật & dữ liệu',
    'title': 'Bảo mật và dữ liệu: tách riêng, phân quyền, 2FA | Rapiz',
    'description': 'Dữ liệu mỗi doanh nghiệp tách riêng ở tầng cơ sở dữ liệu, mã hoá khi truyền và khi lưu, phân quyền thành viên, xác thực hai lớp, nhật ký thao tác, xuất toàn bộ dữ liệu ra tệp ZIP.',
    'h1': 'Bot làm nhanh.<br><em>Việc quan trọng có người duyệt.</em>',
    'deck': 'Bot làm việc trong phạm vi bạn cho phép. Dữ liệu mỗi doanh nghiệp tách riêng, thành viên có vai trò, thao tác quan trọng được ghi nhật ký và việc tốn tiền cần người xác nhận.',
    'blocks': [
        {'kind': 'caps', 'kicker': 'BẢO VỆ DỮ LIỆU', 'h2': 'Dữ liệu mỗi doanh nghiệp<br><em>nằm riêng.</em>',
         'items': [
             {'icon': 'data', 'title': 'Dữ liệu tách riêng', 'text': 'Mỗi doanh nghiệp có vùng dữ liệu riêng, được khoá ở tầng cơ sở dữ liệu bằng chính sách theo dòng.'},
             {'icon': 'shield', 'title': 'Mã hoá khi truyền và khi lưu', 'text': 'Dữ liệu đi qua kết nối mã hoá. Khoá kết nối kênh và khoá API được mã hoá trước khi lưu.'},
             {'icon': 'users', 'title': 'Vai trò và ghế', 'text': 'Mời thành viên bằng đường link, gán vai trò chủ, quản trị, sale, chăm sóc khách hàng hoặc phân tích. Số ghế theo gói, thu hồi quyền ngay khi cần.'},
             {'icon': 'check', 'title': 'Xác thực hai lớp', 'text': 'Bật 2FA cho tài khoản; đăng ký bằng mã xác thực email.'},
             {'icon': 'history', 'title': 'Nhật ký thao tác', 'text': 'Thay đổi quan trọng được ghi lại: ai làm, làm gì, lúc nào.'},
             {'icon': 'file', 'title': 'Xuất toàn bộ dữ liệu', 'text': 'Tải toàn bộ dữ liệu của doanh nghiệp về một tệp ZIP để lưu trữ hoặc chuyển sang hệ thống khác.'},
             {'icon': 'search', 'title': 'Nhật ký gỡ lỗi AI tự xoá', 'text': 'Bản ghi dùng để gỡ lỗi câu trả lời của bot tự xoá sau 30 ngày. Số điện thoại và email trong đó được che trước khi lưu.'},
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
            ('Tôi muốn lấy dữ liệu ra khỏi Rapiz?', 'Bạn xuất được toàn bộ dữ liệu ra một tệp ZIP để lưu trữ hoặc chuyển sang hệ thống khác.'),
            ('Có cam kết tuân thủ tiêu chuẩn nào không?', 'Trang này chỉ liệt kê những biện pháp đang chạy trong sản phẩm. Nếu doanh nghiệp bạn cần hồ sơ bảo mật cho thẩm định, hãy đặt lịch trao đổi với Rapiz.'),
        ]},
        related('Ai được làm gì<br><em>trong Rapiz?</em>', 'tinh-nang/tro-ly-rapiz', 'tich-hop', 'bang-gia'),
        {'kind': 'close', 'h2': 'Cần trao đổi<br><em>về bảo mật?</em>'},
    ],
})

PAGES.append({
    'slug': 'bang-gia', 'group': 'Nền tảng · Bảng giá',
    'title': 'Bảng giá | Rapiz',
    'description': 'Gói Miễn phí không thời hạn. Sales Smart từ 785.000đ, Sales Pro từ 974.000đ, Sales Neo từ 1.624.000đ mỗi tháng khi thanh toán 12 tháng. Chuyển khoản VietQR.',
    'h1': 'Bắt đầu miễn phí.<br><em>Trả khi đội lớn lên.</em>',
    'deck': 'Mọi gói đều có bot bán hàng, Tin nhắn đa kênh, Đào tạo Bot và Trợ lý Rapiz. Gói trả phí mở thêm thành viên, kênh, bình luận Facebook, khung chat website và API.',
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
