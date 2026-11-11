// "Tất cả kênh, một màn hình" on tich-hop: a click-through copy of the Rapiz app
// (Tích hợp nền tảng, Đào tạo Bot, Hộp thư). Everything runs locally on mock data; nothing is sent anywhere.
(() => {
  const root = document.querySelector('[data-chd]');
  if (!root) return;
  const app = root.querySelector('[data-chd-app]');
  const held = n => (root.querySelector(`[data-ic="${n}"]`) || { innerHTML: '' }).innerHTML;

  const P = {
    network: '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3M12 12V8"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    bot: '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4M9 14v1M15 14v1M2 14h2M20 14h2"/>',
    unplug: '<path d="m19 5 3-3M2 22l3-3M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4ZM7.5 13.5 10 11M10.5 16.5 13 14M12 6l6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    book: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    refresh: '<path d="M21 12a9 9 0 0 0-15-6.7L3 8M3 3v5h5M3 12a9 9 0 0 0 15 6.7L21 16M16 16h5v5"/>',
    panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    chart: '<path d="M3 3v18h18M8 17v-5M13 17V8M18 17v-9"/>',
    house: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
    pkg: '<path d="m7.5 4.3 9 5.2M21 8v8a2 2 0 0 1-1 1.7l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.7l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8zM3.3 7 12 12l8.7-5M12 22V12"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    ud: '<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.3-6.2 3.3L8 14.2 3 9.3l6.9-1z"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    clip: '<path d="m21.4 11-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
    like: '<path d="M7 10v12M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.5l-2.3 8a2 2 0 0 1-1.9 1.5H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7zM2 17l10 5 10-5M2 12l10 5 10-5"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"/>',
    heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/>',
    filter: '<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12M20 18h0M14 4v4M8 10v4M18 16v4"/>',
    wave: '<path d="M2 10v3M6 6v11M10 3v18M14 8v8M18 5v14M22 10v3"/>',
  };
  const ic = (n, cls) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${P[n]}</svg>`;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const initials = n => n.replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean).slice(-2).map(w => w[0].toUpperCase()).join('');

  // ---- mock data (Mailisa demo workspace) ----
  const BOTS = [
    { id: 'b1', name: 'Tư vấn Thẩm Mỹ Viện Mailisa', on: true, upd: '09/11/2026' },
    { id: 'b2', name: 'Chăm sóc sau điều trị', on: true, upd: '07/11/2026' },
    { id: 'b3', name: 'Đặt lịch Spa', on: false, upd: '04/11/2026' },
  ];
  const SEED_PAGES = [
    { id: 'p1', provider: 'facebook', name: 'Mailisa Beauty Center', ext: '104288771305', since: '04/11/2026', bot: 'b1', status: 'connected' },
    { id: 'p2', provider: 'facebook', name: 'Mailisa Spa Quận 7', ext: '108771420913', since: '06/11/2026', bot: 'b3', status: 'connected' },
    { id: 'p3', provider: 'facebook', name: 'Mailisa Outlet', ext: '109340118626', since: '09/11/2026', bot: null, status: 'connected' },
    { id: 'p4', provider: 'facebook', name: 'Mailisa Hà Nội', ext: '101552390874', since: '01/10/2026', bot: 'b1', status: 'reauth_required' },
    { id: 'p5', provider: 'instagram', name: 'mailisa.beauty', ext: '17841400912345678', since: '05/11/2026', bot: 'b1', status: 'connected' },
    { id: 'p6', provider: 'instagram', name: 'mailisa.outlet', ext: '17841400998877665', since: '09/11/2026', bot: null, status: 'connected' },
    { id: 'p7', provider: 'website', name: 'Website Mailisa (demo)', ext: 'demo.rapiz.io', since: '04/11/2026', bot: 'b1', status: 'connected', on: true, agent: 'Trợ lý Mailisa', greet: 'Chào bạn, Mailisa có thể giúp gì cho bạn?', color: '#ff7a45' },
  ];
  const DISCOVER = {
    facebook: [{ name: 'Mailisa Đà Nẵng', ext: '107210334455' }, { name: 'Mailisa Cần Thơ', ext: '102998776611' }],
    instagram: [{ name: 'mailisa.danang', ext: '17841400100200300' }],
  };
  const PLATFORMS = [
    { key: 'all', label: 'Tất cả' }, { key: 'pending', label: 'Chưa gán bot' }, { key: 'facebook', label: 'Facebook' },
    { key: 'instagram', label: 'Instagram' }, { key: 'zalo', label: 'Zalo' }, { key: 'lazada', label: 'Lazada', disabled: true },
    { key: 'tiktok', label: 'TikTok Business' }, { key: 'website', label: 'Website' },
  ];
  const STATUS = { connected: ['ok', 'Đã kết nối'], reauth_required: ['warn', 'Hết hạn'], disabled: ['off', 'Đang tắt'] };
  const GUIDE = {
    html: ['HTML', ['Mở tệp HTML của trang web.', 'Dán mã nhúng ngay trước thẻ </body>.', 'Lưu, tải lại trang và kiểm tra khung chat ở góc màn hình.']],
    wordpress: ['WordPress', ['Cài plugin chèn mã như WPCode (hoặc mở Giao diện > Trình chỉnh sửa tệp giao diện).', 'Dán mã nhúng vào phần Footer, trước thẻ </body>.', 'Lưu và tải lại trang để kiểm tra.']],
    ladipage: ['LadiPage', ['Mở trang trong LadiPage, vào Cài đặt > Mã tùy chỉnh.', 'Dán mã nhúng vào ô BODY (cuối trang), trước thẻ </body>.', 'Xuất bản lại trang.']],
    haravan: ['Haravan', ['Vào Website > Giao diện > Chỉnh sửa mã nguồn.', 'Mở tệp theme.liquid và dán mã nhúng trước thẻ </body>.', 'Lưu và tải lại cửa hàng.']],
    shopify: ['Shopify', ['Vào Online Store > Themes > Edit code.', 'Mở tệp theme.liquid và dán mã nhúng trước thẻ </body>.', 'Lưu và tải lại cửa hàng.']],
    wix: ['Wix', ['Vào Settings > Custom Code > Add Code (cần gói trả phí kết nối tên miền).', 'Dán mã nhúng, chọn vị trí Body - end và áp dụng cho All pages.', 'Bấm Apply rồi Publish.']],
    gtm: ['Google Tag Manager', ['Tạo thẻ mới (New Tag), loại Custom HTML.', 'Dán mã nhúng vào nội dung thẻ, chọn trigger All Pages.', 'Bấm Submit rồi Publish container.']],
  };
  const SPACE_NAV = [['home', 'Trang chủ', 'house'], ['products', 'Sản phẩm', 'pkg'], ['instructions', 'Hướng dẫn', 'book'], ['knowledge', 'Thông tin', 'info'], ['integrations', 'Tích hợp kênh', 'code'], ['actions', 'Hành động', 'zap']];
  const COLORS = ['#ff7a45', '#7c5cff', '#067647', '#1d4ed8', '#1f1f1f'];
  const CH = { messenger: 'Messenger', instagram: 'Instagram', website: 'Website', fbcomment: 'Bình luận Facebook' };
  const INBOX_TABS = [['all', 'Tất cả tin nhắn'], ['messenger', 'Messenger'], ['instagram', 'Instagram'], ['website', 'Website'], ['fbcomment', 'Bình luận trên Facebook'], ['wa', 'WhatsApp', 1], ['igc', 'Bình luận trên Instagram', 1]];
  const SEED_CONVS = [
    { id: 'c1', ch: 'website', name: 'Khách website 0ed9', src: 'Website Mailisa', time: '17:24', unread: 0, waiting: 0, phone: 0, staff: 1, msgs: [['in', 'minh nhan don hom qua bi thieu 1 bo do ngu, shop kiem tra giup minh voi', '17:24'], ['bot', 'Dạ, em đã chuyển cho nhân viên, anh/chị đợi một chút ạ.', '17:24']] },
    { id: 'c2', ch: 'messenger', name: 'Nguyễn Thu Hà', src: 'Mailisa Beauty Center', time: '17:02', unread: 2, waiting: 1, phone: 1, msgs: [['in', 'Bên mình có gói trị mụn cho da nhạy cảm không ạ?', '17:01'], ['bot', 'Dạ có ạ. Gói Trị mụn dịu nhẹ (6 buổi) giá 2.400.000đ, da nhạy cảm dùng được. Chị muốn em đặt lịch tư vấn miễn phí không ạ?', '17:01'], ['in', 'Có, chiều thứ 7 được không em?', '17:02']] },
    { id: 'c3', ch: 'instagram', name: 'lan.pham.92', src: 'mailisa.beauty', time: '16:48', unread: 1, waiting: 0, msgs: [['in', 'Shop ơi gói triệt lông nách giá bao nhiêu?', '16:47'], ['bot', 'Dạ gói triệt lông nách 5 buổi giá 1.500.000đ, đang giảm 20% tuần này ạ.', '16:48']] },
    { id: 'c4', ch: 'website', name: 'Khách website cf64', src: 'Website Mailisa', time: '17:02', unread: 3, tag: 'Số mới', phone: 1, msgs: [['in', 'cho minh dat lich cham soc da mat 9h sang mai', '17:00'], ['bot', 'Dạ em đã ghi nhận lịch 9h sáng mai. Anh/chị cho em xin số điện thoại để xác nhận ạ.', '17:01'], ['in', '0977 111 444', '17:02']] },
    { id: 'c5', ch: 'fbcomment', name: 'Trần Mỹ Linh', src: 'Mailisa Beauty Center · bài “Ưu đãi tháng 11”', time: '16:37', unread: 1, msgs: [['in', 'Giá này còn áp dụng đến hết tuần không shop?', '16:36'], ['bot', 'Dạ còn ạ, ưu đãi áp dụng đến hết 15/11. Em đã nhắn riêng chi tiết cho chị rồi ạ.', '16:37']] },
    { id: 'c6', ch: 'messenger', name: 'Lê Hoàng Yến', src: 'Mailisa Spa Quận 7', time: '16:20', unread: 0, msgs: [['in', 'Em muốn đổi lịch sang thứ 4 được không?', '16:18'], ['bot', 'Dạ được ạ, thứ 4 còn trống khung 14h và 16h. Chị chọn giúp em nhé.', '16:19']] },
  ];
  const TAGS = [['VIP', '#7c5cff'], ['Event', '#067647'], ['Ticket', '#f59e0b']];

  // ---- state ----
  let S;
  function fresh() {
    S = {
      screen: 'integrations', pages: SEED_PAGES.map(p => ({ ...p })), bots: BOTS.map(b => ({ ...b })),
      tab: 'all', q: '', botFilter: 'all', sel: new Set(), dlg: null, toast: '', copied: false,
      space: null, spaceNav: 'integrations',
      itab: 'all', ichip: '', iq: '', cid: 'c1', convs: SEED_CONVS.map(c => ({ ...c, msgs: c.msgs.map(m => m.slice()), tags: c.id === 'c1' ? ['VIP'] : [], notes: [], star: false })), handoff: { c1: true }, draft: '', note: '', side: true,
    };
  }
  let toastT;
  function toast(m) {
    S.toast = m;
    clearTimeout(toastT);
    toastT = setTimeout(() => { S.toast = ''; render(); }, 2600);
  }
  const botName = id => (S.bots.find(b => b.id === id) || {}).name || null;

  // ---- pieces ----
  function tile(k) {
    if (k === 'all') return `<span class="chd-tile is-all">${ic('network')}</span>`;
    if (k === 'pending') return `<span class="chd-tile is-soft">${ic('clock')}</span>`;
    if (k === 'facebook') return `<span class="chd-tile">${held('facebook')}</span>`;
    if (k === 'instagram') return `<span class="chd-tile">${held('instagram')}</span>`;
    if (k === 'zalo') return '<span class="chd-tile"><span class="zl">Zalo</span></span>';
    if (k === 'lazada') return `<span class="chd-tile is-gray">${ic('heart')}</span>`;
    if (k === 'tiktok') return `<span class="chd-tile is-dark">${held('tiktok')}</span>`;
    return `<span class="chd-tile">${held('globe')}</span>`;
  }
  const NAVS = [['stats', 'Thống kê', 'chart'], ['bots', 'Đào tạo Bot', 'bot'], ['inbox', 'Tin nhắn đa kênh', 'chat'], ['integrations', 'Tích hợp nền tảng', 'plug'], ['crm', 'Khách hàng', 'users', 1], ['svc', 'Dịch vụ', 'pkg'], ['team', 'Thành viên', 'user'], ['set', 'Cài đặt', 'gear']];
  const TITLES = { integrations: 'Tích hợp nền tảng', bots: 'Đào tạo Bot', inbox: 'Hộp thư' };
  function sidebar() {
    const items = NAVS.map(([k, l, i, chev]) => `<button type="button" class="chd-nav" data-a="nav" data-v="${k}"${S.screen === k ? ' aria-current="page"' : ''}>${ic(i)}<span>${l}</span>${chev ? ic('right', 'chev') : ''}</button>`).join('');
    return `<aside class="chd-side"><div class="chd-logo">${held('logo')}</div><div class="chd-ws"><span class="av">${held('symbol')}</span><span><small>Đang quản lý</small><b>Mailisa (demo)</b></span>${ic('ud')}</div><div class="chd-grp">BÁN HÀNG</div>${items}</aside>`;
  }
  function header() {
    return `<header class="chd-head"><button type="button" class="chd-ic" data-a="inert" aria-label="Thu gọn menu">${ic('panel')}</button><span class="t">${TITLES[S.screen] || ''}</span><span class="sp"></span><span class="act">${ic('download')} Cài ứng dụng</span><span class="act" style="color:var(--brand)">${ic('wave')}</span><button type="button" class="chd-ic" data-a="inert" aria-label="Thông báo">${ic('bell')}</button><span class="chd-av">RD</span></header>`;
  }
  const ck = (attrs, on, label) => `<label class="chd-ck"><input type="checkbox" ${attrs}${on ? ' checked' : ''}>${label || ''}</label>`;

  function visiblePages(forBot) {
    let list = S.pages.filter(p => p.status !== 'removed');
    if (forBot) {
      list = list.filter(p => p.bot === S.space);
    } else if (S.tab === 'pending') {
      list = list.filter(p => !p.bot);
    } else if (S.tab !== 'all') {
      list = list.filter(p => p.provider === S.tab);
    }
    if (!forBot && S.botFilter === 'unassigned') list = list.filter(p => !p.bot);
    else if (!forBot && S.botFilter !== 'all') list = list.filter(p => p.bot === S.botFilter);
    const q = S.q.trim().toLowerCase();
    if (q) list = list.filter(p => p.name.toLowerCase().includes(q) || p.ext.toLowerCase().includes(q));
    return list;
  }
  function card(p, showBot) {
    const [cls, lab] = p.provider === 'website' ? [p.on ? 'ok' : 'off', p.on ? 'Đang chạy' : 'Đang tắt'] : STATUS[p.status];
    const sel = S.sel.has(p.id);
    const web = p.provider === 'website';
    const avatar = web ? `<span class="chd-pav is-web">${held('globe')}</span>` : `<span class="chd-pav">${esc(initials(p.name))}</span>`;
    const meta = web ? `<p>Tên miền: ${esc(p.ext)}</p>` : `<p>ID: ${esc(p.ext)}</p>`;
    const prov = { facebook: 'facebook', instagram: 'instagram', website: 'globe' }[p.provider];
    const bot = showBot ? `<p class="m">${botName(p.bot) ? `Bot: ${esc(botName(p.bot))}` : 'Chưa gán bot'}</p>` : '';
    const reconnect = !web && p.status !== 'connected' ? `<button type="button" class="chd-ic pri" data-a="reconnect" data-id="${p.id}" title="Kết nối lại" aria-label="Kết nối lại: ${esc(p.name)}">${ic('refresh')}</button>` : '';
    const menu = !web ? `<button type="button" class="chd-ic" data-a="rm1" data-id="${p.id}" title="Gỡ trang" aria-label="Gỡ trang ${esc(p.name)}">${ic('more')}</button>` : '';
    const wact = web ? `<div class="chd-wact"><button type="button" class="chd-btn sm" data-a="copycode" data-id="${p.id}">${ic('copy')}${S.copied === p.id ? 'Đã chép' : 'Sao chép mã nhúng'}</button><button type="button" class="chd-btn sm" style="border-color:transparent" data-a="install" data-id="${p.id}">${ic('book')}Hướng dẫn cài đặt</button><button type="button" class="chd-btn sm" style="border-color:transparent" data-a="wset" data-id="${p.id}">${ic('gear')}Cài đặt</button><button type="button" class="chd-sw" role="switch" aria-checked="${!!p.on}" aria-label="Bật hoặc tắt chat trên ${esc(p.name)}" data-a="wtoggle" data-id="${p.id}"></button><button type="button" class="chd-ic bad" data-a="wdel" data-id="${p.id}" aria-label="Xóa kết nối">${ic('trash')}</button></div>` : '';
    return `<li class="chd-card${sel ? ' is-sel' : ''}">${ck(`data-a="sel" data-id="${p.id}" aria-label="Chọn ${esc(p.name)}"`, sel)}${avatar}<div class="chd-ci"><div class="chd-top"><p class="n">${esc(p.name)}</p><span class="chd-badge ${cls}">${lab}</span></div>${meta}<p class="m">${held(prov)}Tích hợp ngày ${p.since}</p>${bot}${wact}</div>${reconnect}${menu}</li>`;
  }
  function connectBtn() {
    const t = S.tab;
    if (t === 'facebook' || t === 'instagram') return `<button type="button" class="chd-btn pri" data-a="connect" data-v="${t}">Kết nối ${t === 'facebook' ? 'Facebook' : 'Instagram'}</button>`;
    if (t === 'website') return '<button type="button" class="chd-btn pri" data-a="wcreate">Thêm website</button>';
    return '';
  }
  function toolbar(forBot) {
    const list = visiblePages(forBot);
    const n = [...S.sel].filter(id => list.some(p => p.id === id)).length;
    const all = list.length > 0 && n === list.length;
    const assigned = list.some(p => S.sel.has(p.id) && p.bot);
    const removable = list.some(p => S.sel.has(p.id) && p.provider !== 'website');
    const search = `<div class="chd-input">${ic('search')}<input id="chd-q" type="search" placeholder="Tìm theo tên hoặc ID page..." aria-label="Tìm theo tên hoặc ID page" value="${esc(S.q)}" autocomplete="off"></div>`;
    const filter = forBot ? '' : `<div class="chd-row" style="justify-content:flex-start"><label for="chd-bf">Lọc theo bot</label><select id="chd-bf" class="chd-sel"><option value="all">Tất cả bot</option><option value="unassigned"${S.botFilter === 'unassigned' ? ' selected' : ''}>Chưa gán bot</option>${S.bots.map(b => `<option value="${b.id}"${S.botFilter === b.id ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div>`;
    const ind = n > 0 && !all;
    return `<div class="chd-row"><h2>${forBot ? 'Danh sách các trang đã kết nối với Bot' : 'Danh sách trang'}</h2>${search}</div>${filter}<div class="chd-row">${ck(`data-a="all"${list.length ? '' : ' disabled'}${ind ? ' data-ind="1"' : ''}`, all, 'Chọn tất cả')}<div class="chd-row" style="gap:8px"><button type="button" class="chd-btn" data-a="assign"${n || forBot ? '' : ' disabled'}>${forBot ? 'Chọn trang' : 'Gán bot'}${ic('bot')}</button>${forBot ? '' : '<button type="button" class="chd-btn" disabled title="Sắp có">Đồng bộ tin nhắn</button>'}<button type="button" class="chd-btn" data-a="unassign"${assigned ? '' : ' disabled'}>${ic('unplug')}Hủy gán bot</button>${forBot ? '' : `<button type="button" class="chd-btn bad" data-a="rmsel"${removable ? '' : ' disabled'}>${ic('trash')}Gỡ trang</button>`}</div></div>`;
  }
  function listBody(forBot) {
    const list = visiblePages(forBot);
    const t = S.tab;
    if (!forBot && (t === 'zalo' || t === 'tiktok')) {
      const name = t === 'zalo' ? 'Zalo' : 'TikTok Business';
      return `<div class="chd-empty"><b>${name} sắp có</b><p>Chúng tôi đang hoàn thiện tích hợp này. Hiện bạn có thể kết nối Facebook và Instagram.</p></div>`;
    }
    if (!list.length) {
      if (forBot && !S.pages.some(p => p.bot === S.space)) return '<div class="chd-empty"><b>Kết nối Trang đầu tiên cho Bot</b><p>Đây là bước đầu tiên: kết nối Trang Facebook hoặc tài khoản Instagram, Bot sẽ tự động tư vấn khách hàng nhắn tin vào Trang.</p><button type="button" class="chd-btn pri" data-a="assign">Chọn trang</button></div>';
      if (S.q || S.botFilter !== 'all' || forBot) return '<div class="chd-empty"><b>Không có trang phù hợp</b></div>';
      return `<div class="chd-empty"><b>Chưa có trang nào</b><p>Kết nối Trang Facebook hoặc tài khoản Instagram để bắt đầu nhận tin nhắn.</p>${connectBtn()}</div>`;
    }
    return `<ul class="chd-cards">${list.map(p => card(p, !forBot)).join('')}</ul>`;
  }
  function integrations() {
    const plat = PLATFORMS.map(p => `<li><button type="button" data-a="tab" data-v="${p.key}"${p.disabled ? ' disabled' : ''}${S.tab === p.key ? ' aria-current="true"' : ''}>${tile(p.key)}<span>${p.label}</span></button></li>`).join('');
    const cb = connectBtn();
    return `<h2 class="chd-t">Tích hợp nền tảng</h2><p class="sub">Kết nối Trang và chọn Bot trả lời cho từng Trang.</p><div class="chd-banner">Chúng tôi nên tích hợp nền tảng nào tiếp theo? <b>Hãy đóng góp và chia sẻ ý kiến của bạn với chúng tôi.</b></div><div class="chd-panel"><nav aria-label="Nền tảng"><ul class="chd-plat">${plat}</ul></nav><div class="chd-body">${toolbar(false)}${cb && visiblePages(false).length ? `<div>${cb}</div>` : ''}${listBody(false)}</div></div><p class="chd-note">Nhắn tin cần quyền ứng dụng Meta phù hợp và App Review để hỗ trợ khách hàng công khai.</p><section class="chd-fb"><h3>Bài viết và bình luận Facebook</h3><p>Trả lời dựa trên đúng bài viết gốc. Trả lời công khai, inbox riêng và kiểm duyệt bật/tắt độc lập, mặc định đều tắt.</p>${S.pages.some(p => p.provider === 'facebook' && p.status === 'connected') ? '<p style="color:var(--fg)">Chọn một fanpage đã kết nối để cấu hình bình luận.</p>' : '<p style="color:var(--fg)">Hãy kết nối fanpage Facebook trước.</p>'}</section>`;
  }
  function bots() {
    if (!S.space) {
      const cards = S.bots.map(b => `<div class="chd-bot"><div class="h"><b>${esc(b.name)}</b><button type="button" class="chd-sw" role="switch" aria-checked="${b.on}" aria-label="Bật hoặc tắt bot ${esc(b.name)}" data-a="bottoggle" data-id="${b.id}"></button></div><small>${b.on ? 'Đang bật' : 'Đang tắt'} · Cập nhật ${b.upd}</small><small>${S.pages.filter(p => p.bot === b.id && p.status !== 'removed').length} trang đang kết nối</small><button type="button" class="chd-btn sm" style="justify-self:start;margin-top:6px" data-a="openbot" data-id="${b.id}">Mở bot</button></div>`).join('');
      return `<h2 class="chd-t">Bot của bạn</h2><p class="sub">Mỗi bot trả lời khách thay bạn trên các kênh chat.</p><div class="chd-bots">${cards}</div>`;
    }
    const b = S.bots.find(x => x.id === S.space);
    const nav = SPACE_NAV.map(([k, l, i]) => `<button type="button" data-a="snav" data-v="${k}"${S.spaceNav === k ? ' aria-current="true"' : ''}>${ic(i)}${l}</button>`).join('');
    const body = S.spaceNav === 'integrations'
      ? `<h2 class="chd-t">Tích hợp kênh</h2><p class="sub">Kết nối Trang với Bot để tự động tư vấn và phản hồi khách hàng.</p><div class="chd-body" style="border:1px solid var(--bd);border-radius:12px">${toolbar(true)}${listBody(true)}</div>`
      : `<h2 class="chd-t">${(SPACE_NAV.find(x => x[0] === S.spaceNav) || [0, ''])[1]}</h2><p class="sub">Màn này không có trong bản dùng thử.</p><div class="chd-blank">Bấm “Tích hợp kênh” để xem trang kết nối của bot.</div>`;
    return `<div class="chd-space"><div class="chd-sn"><button type="button" class="back" data-a="botsback">${ic('right', 'flip')} Tất cả bot</button><b style="padding:4px 10px">${esc(b.name)}</b><hr>${nav}</div><div>${body}</div></div>`;
  }

  // ---- inbox ----
  function convList() {
    let l = S.convs.filter(c => S.itab === 'all' || c.ch === S.itab);
    if (S.ichip === 'unread') l = l.filter(c => c.unread);
    if (S.ichip === 'wait') l = l.filter(c => c.waiting);
    if (S.ichip === 'star') l = l.filter(c => c.star);
    const q = S.iq.trim().toLowerCase();
    if (q) l = l.filter(c => c.name.toLowerCase().includes(q) || c.msgs.some(m => m[1].toLowerCase().includes(q)));
    return l;
  }
  const last = c => { const m = c.msgs[c.msgs.length - 1]; return `${m[0] === 'in' ? '' : (m[0] === 'bot' ? 'Bot: ' : 'Bạn: ')}${esc(m[1])}`; };
  function inbox() {
    const tabs = INBOX_TABS.map(([k, l, dis]) => `<button type="button" data-a="itab" data-v="${k}"${dis ? ' disabled' : ''}${S.itab === k ? ' aria-pressed="true"' : ''}>${l}</button>`).join('');
    const unread = S.convs.filter(c => c.unread).length, wait = S.convs.filter(c => c.waiting).length;
    const chips = [['unread', `Chưa đọc ${unread}`], ['wait', `Chờ trả lời ${wait}`], ['star', 'Ưu tiên']].map(([k, l]) => `<button type="button" data-a="ichip" data-v="${k}"${S.ichip === k ? ' aria-pressed="true"' : ''}>${l}</button>`).join('');
    const l = convList();
    const items = l.map(c => `<li><button type="button" class="chd-conv${c.id === S.cid ? ' is-on' : ''}" data-a="conv" data-id="${c.id}"><span class="chd-pav">${esc(c.name[0])}${c.unread ? `<i class="bd">${c.unread}</i>` : ''}</span><span class="cb"><span class="r"><b>${esc(c.name)}</b>${c.tag ? `<em class="chd-pill">${c.tag}</em>` : ''}<small>${c.time}</small></span><span class="lm">${last(c)}</span><span class="chd-chp">${held(c.ch === 'website' ? 'globe' : c.ch === 'instagram' ? 'instagram' : 'facebook')}${CH[c.ch]}${c.phone ? ic('phone', 'ph') : ''}</span></span></button></li>`).join('');
    const c = S.convs.find(x => x.id === S.cid);
    return `<div class="chd-inbox"><div class="chd-itabs">${tabs}</div><div class="chd-icols${S.side ? '' : ' no-side'}"><section class="chd-ilist"><div class="chd-isearch"><div class="chd-input" style="width:100%">${ic('search')}<input id="chd-iq" type="search" placeholder="Tìm tên, số điện thoại, tin nhắn.." aria-label="Tìm hội thoại" value="${esc(S.iq)}" autocomplete="off"></div></div><div class="chd-chips">${chips}</div><ul class="chd-convs">${items || '<li class="chd-blank" style="border:0">Không có hội thoại phù hợp</li>'}</ul><p class="chd-keys">J/K: đổi khách · /: tìm · R: soạn · E: xong</p></section>${c ? thread(c) : '<section class="chd-thread"><div class="chd-blank" style="margin:20px">Chọn một hội thoại</div></section>'}${c && S.side ? aside(c) : ''}</div></div>`;
  }
  function thread(c) {
    const human = !!S.handoff[c.id];
    const msgs = c.msgs.map(m => {
      if (m[0] === 'in') return `<div class="chd-m in"><span class="chd-pav">${esc(c.name[0])}</span><p>${esc(m[1])}</p></div>`;
      return `<div class="chd-m out"><small>${m[0] === 'bot' ? `${ic('bot')} Bot` : 'Bạn'}</small><p class="${m[0]}">${esc(m[1])}</p><small>${m[2]} · ${m[0] === 'bot' ? 'Bot đã gửi' : 'Đã gửi'}</small></div>`;
    }).join('');
    return `<section class="chd-thread"><div class="chd-th"><span class="chd-pav">${esc(c.name[0])}</span><div><b>${esc(c.name)}</b> <small>${CH[c.ch]} · ${esc(c.src)}</small><div class="chd-as">Chỉ định cuộc trò chuyện này ${ic('down')}</div></div></div><div class="chd-tbar"><button type="button" class="chd-btn hand" data-a="handoff">${ic('user')}${human ? 'Nhân viên đang trả lời · bot bật lại sau 4:55' : 'Bot đang trả lời · bấm để tiếp quản'}${ic('down')}</button><button type="button" class="chd-ic sq" data-a="inert" aria-label="Báo cáo">${ic('alert')}</button><button type="button" class="chd-ic sq${c.star ? ' on' : ''}" data-a="star" aria-label="Ưu tiên" aria-pressed="${c.star}">${ic('star')}</button><button type="button" class="chd-ic sq" data-a="unread" aria-label="Đánh dấu chưa đọc">${ic('mail')}</button><button type="button" class="chd-ic sq" data-a="done" aria-label="Xong">${ic('check')}</button><button type="button" class="chd-ic sq" data-a="side" aria-label="Thông tin khách" style="margin-left:auto">${ic('panel')}</button></div><div class="chd-msgs"><p class="chd-day">${c.time} Thứ 3</p>${msgs}</div><div class="chd-comp"><textarea id="chd-draft" rows="2" placeholder="Trả lời trong ${CH[c.ch]}..." aria-label="Soạn tin trả lời">${esc(S.draft)}</textarea><div class="ct">${ic('filter')}${ic('clip')}${ic('chat')}${ic('smile')}${ic('pkg')}<button type="button" class="chd-ic pri" data-a="send" aria-label="Gửi">${ic('like')}</button></div></div></section>`;
  }
  function aside(c) {
    const web = c.ch === 'website';
    const tags = TAGS.map(([t, col]) => `<button type="button" class="chd-tg${c.tags.includes(t) ? ' on' : ''}" data-a="tag" data-v="${t}"><i style="background:${col}"></i>${t}</button>`).join('');
    const notes = c.notes.length ? c.notes.map(n => `<p class="chd-nt">${esc(n)}</p>`).join('') : '<p class="chd-mut">Chưa có ghi chú</p>';
    return `<aside class="chd-iside"><div class="chd-sh"><span class="chd-pav">${esc(c.name[0])}</span><div><b>${esc(c.name)}</b><small>${CH[c.ch]} · ${esc(c.src)}</small></div></div><div class="chd-sec2">${web ? `<h4>${ic('down')} Khách truy cập website</h4><dl><dt>Trang đầu tiên</dt><dd class="lk">demo.rapiz.io/lua-hien/</dd><dt>Trang đang xem</dt><dd>Lụa Hiên · Đồ lụa và linen</dd><dt>Nguồn truy cập</dt><dd>Truy cập trực tiếp</dd><dt>Số điện thoại</dt><dd>${c.phone ? '0977 111 444' : 'Chưa để lại số'}</dd></dl>` : `<h4>${ic('down')} Thông tin khách</h4><dl><dt>Kênh</dt><dd>${CH[c.ch]}</dd><dt>Trang</dt><dd>${esc(c.src)}</dd><dt>Số điện thoại</dt><dd>${c.phone ? '0912 345 678' : 'Chưa để lại số'}</dd></dl>`}</div><div class="chd-sec2"><h4>${ic('down')} Nhãn</h4><div class="chd-tags">${tags}</div></div><div class="chd-sec2"><h4>${ic('down')} Ghi chú</h4><textarea id="chd-note" rows="2" placeholder="Viết ghi chú cho ca sau... (Enter để lưu)" aria-label="Ghi chú">${esc(S.note)}</textarea>${notes}</div><div class="chd-sec2"><h4>${ic('down')} Đơn hàng</h4><p class="chd-mut">Chưa có đơn hàng</p></div></aside>`;
  }

  // ---- dialogs ----
  function dialog() {
    const d = S.dlg;
    if (!d) return '';
    const foot = (ok, okCls) => `<div class="foot"><button type="button" class="chd-btn" data-a="close">Hủy</button>${ok ? `<button type="button" class="chd-btn ${okCls || 'pri'}" data-a="${ok[0]}">${ok[1]}</button>` : ''}</div>`;
    let h = '';
    if (d.k === 'assign') {
      const forBot = !!S.space;
      if (forBot) {
        const rows = S.pages.filter(p => p.status === 'connected' && p.provider !== 'website').map(p => `<label class="chd-opt"><input type="checkbox" data-a="bpick" data-id="${p.id}"${d.pick.has(p.id) ? ' checked' : ''}>${esc(p.name)}<small>${p.bot && p.bot !== S.space ? `Đang gán: ${esc(botName(p.bot))}` : ''}</small></label>`).join('');
        h = `<h3>Trang kết nối với Bot</h3><p>Chọn các Trang sẽ do Bot này tự động trả lời.</p>${rows || '<p>Chưa có Trang nào đang hoạt động. Hãy kết nối Trang trước.</p>'}${foot(['bsave', 'Lưu'])}`;
      } else {
        const rows = S.bots.map(b => `<label class="chd-opt"><input type="radio" name="chd-bot" value="${b.id}"${d.bot === b.id ? ' checked' : ''} data-a="bpick1">${esc(b.name)}</label>`).join('');
        h = `<h3>Gán bot cho trang</h3><p>Áp dụng cho ${d.n} trang đã kết nối được chọn. Mỗi trang được gán một bot trả lời.</p><b style="font-size:13px">Bot trả lời</b>${rows}${foot(['asave', 'Lưu'])}`;
      }
    } else if (d.k === 'move') {
      h = `<h3>Chuyển trang sang Bot này?</h3><p>${d.n} trang đang do bot khác trả lời. Bot đó sẽ ngừng trả lời các trang này.</p>${foot(['bconfirm', 'Chuyển trang'])}`;
    } else if (d.k === 'unassign') {
      h = `<h3>Hủy gán bot cho ${d.n} trang?</h3><p>Bot sẽ ngừng trả lời các trang này. Kết nối nền tảng và lịch sử tin nhắn được giữ lại.</p>${foot(['uconfirm', 'Hủy gán bot'])}`;
    } else if (d.k === 'remove') {
      h = `<h3>${d.ids.length === 1 ? `Gỡ ${esc(S.pages.find(p => p.id === d.ids[0]).name)} khỏi Rapiz?` : `Gỡ ${d.ids.length} trang khỏi Rapiz?`}</h3><p>Bot sẽ ngừng trả lời và Rapiz không nhận tin nhắn mới từ ${d.ids.length === 1 ? 'trang' : 'các trang'} này. Lịch sử hội thoại vẫn được giữ. Bạn có thể kết nối lại bất cứ lúc nào.</p>${foot(['rconfirm', 'Gỡ trang'], 'bad')}`;
    } else if (d.k === 'discover') {
      const rows = DISCOVER[d.p].filter(a => !S.pages.some(p => p.ext === a.ext)).map(a => `<label class="chd-opt"><input type="checkbox" data-a="dpick" data-id="${a.ext}"${d.pick.has(a.ext) ? ' checked' : ''}>${esc(a.name)}<small>ID: ${a.ext}</small></label>`).join('');
      h = `<h3>Chọn tài khoản</h3><p>Chọn tài khoản cần kết nối. Access token được giữ an toàn trên máy chủ.</p>${rows || '<p>Không còn tài khoản nào để kết nối.</p>'}${foot(['dsave', 'Lưu kết nối'])}`;
    } else if (d.k === 'install') {
      const p = S.pages.find(x => x.id === d.id);
      const g = GUIDE[d.g];
      h = `<h3>Cài đặt chat cho ${esc(p.name)}</h3><p>Dán mã này vào mọi trang bạn muốn hiện khung chat, ngay trước thẻ &lt;/body&gt;.</p><div class="chd-code">${esc(code(p))}</div><b style="font-size:13px">Cài đặt trên nền tảng của bạn</b><div class="chd-tabs">${Object.keys(GUIDE).map(k => `<button type="button" data-a="gtab" data-v="${k}" aria-pressed="${d.g === k}">${GUIDE[k][0]}</button>`).join('')}</div><ol>${g[1].map(s => `<li>${esc(s)}</li>`).join('')}</ol>${foot(['close', 'Xong'])}`;
    } else if (d.k === 'wset') {
      const p = S.pages.find(x => x.id === d.id);
      const o = d.v;
      h = `<h3>Cài đặt ${esc(p.name)}</h3><div class="chd-sets"><div style="display:grid;gap:12px;align-content:start"><label class="chd-field">Tên trợ lý<input type="text" id="chd-wn" value="${esc(o.agent)}" maxlength="30"></label><label class="chd-field">Lời chào<input type="text" id="chd-wg" value="${esc(o.greet)}" maxlength="90"></label><div class="chd-field">Màu chủ đạo<div class="chd-sw-c">${COLORS.map(c => `<button type="button" data-a="wcolor" data-v="${c}" aria-pressed="${o.color === c}" aria-label="${c}" style="background:${c}"></button>`).join('')}</div></div></div><figure style="margin:0"><div class="chd-pv"><div class="pn"><div class="ph"><span class="pa" style="background:${o.color};color:${o.color === '#ff7a45' ? '#1f1f1f' : '#fff'}">${esc(initials(o.agent) || 'R')}</span>${esc(o.agent)}</div><div class="pm"><span>${esc(o.greet)}</span></div></div><span class="pb" style="background:${o.color};color:${o.color === '#ff7a45' ? '#1f1f1f' : '#fff'}">${ic('chat')}</span></div></figure></div>${foot(['wsave', 'Lưu'])}`;
    } else if (d.k === 'wcreate') {
      h = `<h3>Thêm website</h3><p>Nhập tên và tên miền của website. Sau khi tạo, bạn nhận mã nhúng để dán vào trang.</p><label class="chd-field">Tên website<input type="text" id="chd-cn" placeholder="Ví dụ: Cửa hàng hoa Lan"></label><label class="chd-field">Tên miền<input type="text" id="chd-cd" placeholder="shop.vn, www.shop.vn"></label>${d.err ? `<p style="color:var(--bad);margin:0">${d.err}</p>` : ''}${foot(['wnew', 'Tạo website'])}`;
    } else if (d.k === 'wdel') {
      h = `<h3>Xóa kết nối website?</h3><p>Khung chat sẽ ngừng hiển thị trên website này. Lịch sử hội thoại được giữ lại.</p>${foot(['wdelok', 'Xóa kết nối'], 'bad')}`;
    }
    return `<div class="chd-ov" data-a="ovl"><div class="chd-dlg${d.k === 'install' || d.k === 'wset' ? ' wide' : ''}" role="dialog" aria-modal="true">${h}</div></div>`;
  }
  const code = p => `<script src="https://cdn.rapiz.io/widget.js"\n  data-site="${p.id}-demo" async></script>`;

  // ---- render ----
  function render() {
    const keep = app.querySelector('.chd-scroll');
    const top = keep ? keep.scrollTop : 0;
    const act = document.activeElement;
    const aid = act && root.contains(act) ? act.id : '';
    const pos = aid && act.selectionStart != null ? act.selectionStart : null;
    let body = integrations();
    if (S.screen === 'bots') body = bots();
    if (S.screen === 'inbox') body = '';
    const main = S.screen === 'inbox'
      ? `<div class="chd-scroll is-inbox">${inbox()}</div>`
      : `<div class="chd-scroll">${body}</div>`;
    app.classList.toggle('is-inbox', S.screen === 'inbox');
    app.innerHTML = `${sidebar()}<div class="chd-main">${header()}${main}</div><span class="chd-fab" aria-hidden="true">${held('symbol')}</span>${dialog()}${S.toast ? `<div class="chd-toast" role="status">${esc(S.toast)}</div>` : ''}`;
    const sc = app.querySelector('.chd-scroll');
    if (sc) sc.scrollTop = top;
    app.querySelectorAll('input[data-ind]').forEach(i => { i.indeterminate = true; });
    const t = aid && app.querySelector(`#${aid}`);
    if (t) {
      t.focus();
      if (pos != null) t.setSelectionRange(pos, pos);
    }
  }

  // ---- actions ----
  const selIds = () => visiblePages(!!S.space).filter(p => S.sel.has(p.id)).map(p => p.id);
  const A = {
    nav(v) {
      if (v === 'integrations' || v === 'bots' || v === 'inbox') {
        S.screen = v; S.dlg = null; S.sel = new Set(); S.q = ''; S.tab = v === 'integrations' ? S.tab : 'all';
        if (v === 'bots') S.space = null;
      } else {
        toast('Màn này không có trong bản dùng thử.');
      }
    },
    inert() { toast('Màn này không có trong bản dùng thử.'); },
    tab(v) { S.tab = v; S.sel = new Set(); },
    sel(_v, el) { if (el.checked) S.sel.add(el.dataset.id); else S.sel.delete(el.dataset.id); },
    all(_v, el) {
      const ids = visiblePages(!!S.space).map(p => p.id);
      if (el.checked) ids.forEach(i => S.sel.add(i)); else ids.forEach(i => S.sel.delete(i));
    },
    assign() {
      if (S.space) S.dlg = { k: 'assign', pick: new Set(S.pages.filter(p => p.bot === S.space).map(p => p.id)) };
      else S.dlg = { k: 'assign', n: selIds().length, bot: S.bots[0].id };
    },
    bpick1(_v, el) { S.dlg.bot = el.value; },
    asave() {
      selIds().forEach(id => { S.pages.find(p => p.id === id).bot = S.dlg.bot; });
      S.dlg = null; S.sel = new Set(); toast('Đã gán bot cho các trang đã chọn.');
    },
    bpick(_v, el) { if (el.checked) S.dlg.pick.add(el.dataset.id); else S.dlg.pick.delete(el.dataset.id); },
    bsave() {
      const moved = [...S.dlg.pick].filter(id => { const b = S.pages.find(p => p.id === id).bot; return b && b !== S.space; });
      if (moved.length) { S.dlg = { k: 'move', n: moved.length, pick: S.dlg.pick }; return; }
      A.bconfirm();
    },
    bconfirm() {
      const pick = S.dlg.pick;
      S.pages.forEach(p => {
        if (pick.has(p.id)) p.bot = S.space;
        else if (p.bot === S.space) p.bot = null;
      });
      S.dlg = null; toast('Đã cập nhật các trang của bot.');
    },
    unassign() { S.dlg = { k: 'unassign', n: selIds().filter(id => S.pages.find(p => p.id === id).bot).length }; },
    uconfirm() {
      selIds().forEach(id => { S.pages.find(p => p.id === id).bot = null; });
      S.dlg = null; S.sel = new Set(); toast('Đã hủy gán bot.');
    },
    rmsel() { S.dlg = { k: 'remove', ids: selIds().filter(id => S.pages.find(p => p.id === id).provider !== 'website') }; },
    rm1(_v, el) { S.dlg = { k: 'remove', ids: [el.dataset.id] }; },
    rconfirm() {
      S.pages = S.pages.filter(p => !S.dlg.ids.includes(p.id));
      S.dlg = null; S.sel = new Set(); toast('Đã gỡ trang.');
    },
    reconnect(_v, el) { S.pages.find(p => p.id === el.dataset.id).status = 'connected'; toast('Đã kết nối lại trang.'); },
    connect(v) { S.dlg = { k: 'discover', p: v, pick: new Set() }; },
    dpick(_v, el) { if (el.checked) S.dlg.pick.add(el.dataset.id); else S.dlg.pick.delete(el.dataset.id); },
    dsave() {
      DISCOVER[S.dlg.p].filter(a => S.dlg.pick.has(a.ext)).forEach((a, i) => {
        S.pages.push({ id: `n${Date.now()}${i}`, provider: S.dlg.p, name: a.name, ext: a.ext, since: '10/11/2026', bot: null, status: 'connected' });
      });
      S.dlg = null; toast('Đã kết nối. Hãy gán bot cho trang mới.');
    },
    copycode(_v, el) { S.copied = el.dataset.id; setTimeout(() => { S.copied = false; render(); }, 1800); },
    install(_v, el) { S.dlg = { k: 'install', id: el.dataset.id, g: 'html' }; },
    gtab(v) { S.dlg.g = v; },
    wset(_v, el) { const p = S.pages.find(x => x.id === el.dataset.id); S.dlg = { k: 'wset', id: p.id, v: { agent: p.agent, greet: p.greet, color: p.color } }; },
    wcolor(v) { sync(); S.dlg.v.color = v; },
    wsave() { sync(); const p = S.pages.find(x => x.id === S.dlg.id); Object.assign(p, S.dlg.v); S.dlg = null; toast('Đã lưu cài đặt website.'); },
    wtoggle(_v, el) { const p = S.pages.find(x => x.id === el.dataset.id); p.on = !p.on; },
    wcreate() { S.dlg = { k: 'wcreate' }; },
    wnew() {
      const n = (app.querySelector('#chd-cn').value || '').trim();
      const d = (app.querySelector('#chd-cd').value || '').trim();
      if (!n) { S.dlg.err = 'Nhập tên website.'; return; }
      if (!d || /[/:\s]/.test(d.split(',')[0].trim())) { S.dlg.err = 'Nhập tên miền hợp lệ, ví dụ shop.vn.'; return; }
      const id = `w${Date.now()}`;
      S.pages.push({ id, provider: 'website', name: n, ext: d.split(',')[0].trim(), since: '10/11/2026', bot: null, status: 'connected', on: true, agent: 'Trợ lý Mailisa', greet: 'Chào bạn, mình có thể giúp gì cho bạn?', color: '#ff7a45' });
      S.dlg = { k: 'install', id, g: 'html' }; toast('Đã tạo website. Dán mã nhúng vào trang để bắt đầu.');
    },
    wdel(_v, el) { S.dlg = { k: 'wdel', id: el.dataset.id }; },
    wdelok() { S.pages = S.pages.filter(p => p.id !== S.dlg.id); S.dlg = null; toast('Đã xóa kết nối website.'); },
    bottoggle(_v, el) { const b = S.bots.find(x => x.id === el.dataset.id); b.on = !b.on; toast(b.on ? 'Đã bật bot' : 'Đã tắt bot'); },
    openbot(_v, el) { S.space = el.dataset.id; S.spaceNav = 'integrations'; S.sel = new Set(); S.q = ''; },
    botsback() { S.space = null; S.sel = new Set(); },
    snav(v) { S.spaceNav = v; S.sel = new Set(); },
    close() { S.dlg = null; },
    ovl(_v, el, ev) { if (ev.target === el) S.dlg = null; },
    itab(v) { S.itab = v; },
    ichip(v) { S.ichip = S.ichip === v ? '' : v; },
    conv(_v, el) { S.cid = el.dataset.id; const c = S.convs.find(x => x.id === S.cid); c.unread = 0; S.draft = ''; S.note = ''; },
    handoff() { S.handoff[S.cid] = !S.handoff[S.cid]; toast(S.handoff[S.cid] ? 'Bạn đang trả lời. Bot tạm dừng.' : 'Bot đã được bật lại.'); },
    star() { const c = S.convs.find(x => x.id === S.cid); c.star = !c.star; },
    unread() { const c = S.convs.find(x => x.id === S.cid); c.unread = 1; toast('Đã đánh dấu chưa đọc.'); },
    done() { const c = S.convs.find(x => x.id === S.cid); c.waiting = 0; c.unread = 0; toast('Đã đánh dấu xong.'); },
    side() { S.side = !S.side; },
    tag(v) { const c = S.convs.find(x => x.id === S.cid); c.tags = c.tags.includes(v) ? c.tags.filter(t => t !== v) : [...c.tags, v]; },
    send() {
      const text = (app.querySelector('#chd-draft').value || '').trim();
      if (!text) return;
      const c = S.convs.find(x => x.id === S.cid);
      c.msgs.push(['staff', text, '17:30']); c.time = '17:30'; c.waiting = 0; S.handoff[S.cid] = true; S.draft = '';
    },
  };
  function sync() {
    const n = app.querySelector('#chd-wn'), g = app.querySelector('#chd-wg');
    if (n) S.dlg.v.agent = n.value;
    if (g) S.dlg.v.greet = g.value;
  }

  app.addEventListener('click', ev => {
    const el = ev.target.closest('[data-a]');
    if (!el || el.tagName === 'INPUT' || el.disabled) return;
    const fn = A[el.dataset.a];
    if (!fn) return;
    if (el.dataset.a === 'ovl' && ev.target !== el) return;
    fn(el.dataset.v, el, ev);
    render();
  });
  app.addEventListener('change', ev => {
    const el = ev.target;
    if (el.id === 'chd-bf') { S.botFilter = el.value; render(); return; }
    if (el.tagName === 'INPUT' && el.dataset.a && A[el.dataset.a]) { A[el.dataset.a](el.dataset.v, el, ev); render(); }
  });
  app.addEventListener('input', ev => {
    const el = ev.target;
    if (el.id === 'chd-q') { S.q = el.value; render(); }
    if (el.id === 'chd-iq') { S.iq = el.value; render(); }
    if (el.id === 'chd-draft') S.draft = el.value;
    if (el.id === 'chd-note') S.note = el.value;
  });
  app.addEventListener('keydown', ev => {
    const el = ev.target;
    if (ev.key === 'Enter' && !ev.shiftKey && el.id === 'chd-draft') { ev.preventDefault(); A.send(); render(); }
    if (ev.key === 'Enter' && !ev.shiftKey && el.id === 'chd-note') {
      ev.preventDefault();
      const text = el.value.trim();
      if (text) { S.convs.find(x => x.id === S.cid).notes.push(text); S.note = ''; render(); }
    }
    if (ev.key === 'Escape' && S.dlg) { S.dlg = null; render(); }
  });

  fresh();
  app.hidden = false;
  render();
})();
