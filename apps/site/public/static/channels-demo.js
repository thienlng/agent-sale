// "Tất cả kênh, một màn hình" on tich-hop: a click-through copy of the Tích hợp nền tảng screen.
// Everything runs locally on the sample data below; nothing is sent anywhere.
(() => {
  const root = document.querySelector('[data-chd]');
  if (!root) return;
  const $ = s => root.querySelector(s), $$ = s => [...root.querySelectorAll(s)];
  const BOTS = ['Tư vấn bán hàng', 'Chăm sóc sau mua', 'Đặt lịch spa'];
  const SEED = [
    { id: 'fb1', platform: 'facebook', name: 'Minh Châu Beauty', info: 'ID trang: 104 288 771 305', since: '04/11/2026', bot: BOTS[0], on: true },
    { id: 'fb2', platform: 'facebook', name: 'Minh Châu Spa Quận 7', info: 'ID trang: 108 771 420 913', since: '06/11/2026', bot: BOTS[2], on: true },
    { id: 'fb3', platform: 'facebook', name: 'Minh Châu Outlet', info: 'ID trang: 109 340 118 626', since: '09/11/2026', bot: null, on: false },
    { id: 'ig1', platform: 'instagram', name: '@minhchau.beauty', info: 'Tài khoản chuyên nghiệp', since: '05/11/2026', bot: BOTS[0], on: true, beta: true },
    { id: 'ig2', platform: 'instagram', name: '@minhchau.outlet', info: 'Tài khoản chuyên nghiệp', since: '09/11/2026', bot: null, on: false, beta: true },
    { id: 'web1', platform: 'website', name: 'Website Minh Châu (demo)', info: 'Tên miền: demo.rapiz.io', since: '04/11/2026', bot: BOTS[0], on: true },
  ];
  const TITLES = { all: 'Danh sách trang', unassigned: 'Chưa gán bot', facebook: 'Facebook', instagram: 'Instagram', zalo: 'Zalo', tiktok: 'TikTok Business', website: 'Website' };
  const SOON = { zalo: ['Zalo OA', 'Trả lời tin nhắn gửi tới Zalo Official Account của bạn.'], tiktok: ['TikTok Business', 'Trả lời tin nhắn từ tài khoản TikTok doanh nghiệp.'] };
  const GUIDE = ['Sao chép mã nhúng ở trên.', 'Dán mã vào trước thẻ đóng </body> của website.', 'Tải lại website, khung chat sẽ hiện ở góc phải.'];

  let pages, tab, query, botFilter, selected, guideOpen, timer;
  const tabIcon = p => $(`[data-chd-tab="${p}"] .chd-ic svg`).cloneNode(true);

  function reset() {
    pages = SEED.map(p => ({ ...p })); tab = 'all'; query = ''; botFilter = ''; selected = new Set(); guideOpen = new Set();
    $('[data-chd-search]').value = ''; $('[data-chd-bot]').value = '';
    say(''); closeMenu(); draw();
  }
  function say(msg) { const el = $('[data-chd-live]'); el.textContent = msg; clearTimeout(timer); if (msg) timer = setTimeout(() => { el.textContent = ''; }, 3200); }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function shown() {
    const q = query.trim().toLowerCase();
    return pages.filter(p => (tab === 'all' || (tab === 'unassigned' ? !p.bot : p.platform === tab))
      && (!botFilter || p.bot === botFilter) && (!q || p.name.toLowerCase().includes(q) || p.info.toLowerCase().includes(q)));
  }
  function status(p) { return !p.bot ? ['Chưa gán bot', 'is-none'] : p.on ? ['Đang chạy', ''] : ['Đã tắt', 'is-off']; }

  function card(p) {
    const c = el('article', 'chd-card' + (selected.has(p.id) ? ' is-selected' : ''));
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = selected.has(p.id); cb.setAttribute('aria-label', 'Chọn ' + p.name);
    cb.addEventListener('change', () => { if (cb.checked) selected.add(p.id); else selected.delete(p.id); draw(); });
    const ic = el('span', 'chd-ic'); ic.setAttribute('aria-hidden', 'true'); ic.append(tabIcon(p.platform));
    const [label, cls] = status(p);
    const head = el('div', 'chd-head'), name = el('strong', '', p.name);
    if (p.beta) name.append(el('span', 'chd-beta', 'BETA'));
    head.append(name, el('span', 'chd-badge ' + cls, label));
    const meta = el('ul', 'chd-meta');
    [[p.info], ['Tích hợp ngày ' + p.since], p.bot ? ['Bot: ', p.bot] : ['Bot: ', 'chưa gán']].forEach(([a, b]) => {
      const li = el('li'); if (b) { li.append(a, el('b', '', b)); } else li.textContent = a; meta.append(li);
    });
    const acts = el('div', 'chd-acts');
    if (p.platform === 'website') {
      const copy = el('button', 'chd-btn', 'Sao chép mã nhúng'); copy.type = 'button';
      copy.addEventListener('click', () => { copy.textContent = 'Đã sao chép (minh họa)'; setTimeout(() => { copy.textContent = 'Sao chép mã nhúng'; }, 1800); });
      const guide = el('button', 'chd-btn', 'Hướng dẫn cài đặt'); guide.type = 'button';
      guide.setAttribute('aria-expanded', String(guideOpen.has(p.id)));
      guide.addEventListener('click', () => { if (guideOpen.has(p.id)) guideOpen.delete(p.id); else guideOpen.add(p.id); draw(); });
      acts.append(copy, guide);
    }
    const sw = el('div', 'chd-switch'), btn = el('button'); btn.type = 'button'; btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-checked', String(!!(p.bot && p.on))); btn.setAttribute('aria-label', 'Bật bot cho ' + p.name); btn.disabled = !p.bot;
    btn.addEventListener('click', () => { p.on = !p.on; say(p.on ? `Bot đã bật cho ${p.name}.` : `Bot đã tắt cho ${p.name}.`); draw(); });
    sw.append(el('span', '', 'Bot'), btn); acts.append(sw);
    const body = el('div'); body.append(head, meta, acts);
    c.append(cb, ic, body);
    if (guideOpen.has(p.id)) { const ol = el('ol', 'chd-guide'); GUIDE.forEach(t => ol.append(el('li', '', t))); c.append(ol); }
    return c;
  }

  function draw() {
    for (const t of Object.keys(TITLES)) {
      const n = t === 'all' ? pages.length : t === 'unassigned' ? pages.filter(p => !p.bot).length : pages.filter(p => p.platform === t).length;
      $(`[data-chd-count="${t}"]`).textContent = n || '';
    }
    $$('[data-chd-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.chdTab === tab)));
    $('[data-chd-title]').textContent = TITLES[tab];
    const list = $('[data-chd-list]'), rows = shown();
    selected = new Set([...selected].filter(id => rows.some(p => p.id === id)));
    if (SOON[tab]) {
      const e = el('div', 'chd-empty'); e.append(el('strong', '', SOON[tab][0] + ' · Sắp ra mắt'), SOON[tab][1] + ' Nhãn này sẽ được bỏ khi kết nối chạy thật.');
      list.replaceChildren(e);
    } else if (!rows.length) {
      const e = el('div', 'chd-empty'); e.append(el('strong', '', 'Không có trang nào'), 'Thử đổi kênh, bot hoặc từ khóa tìm kiếm.');
      list.replaceChildren(e);
    } else list.replaceChildren(...rows.map(card));
    const all = $('[data-chd-all]'); all.checked = !!rows.length && rows.every(p => selected.has(p.id)); all.disabled = !rows.length;
    $('[data-chd-assign]').disabled = !selected.size;
    $('[data-chd-unassign]').disabled = ![...selected].some(id => pages.find(p => p.id === id).bot);
    $('[data-chd-fb]').hidden = !['all', 'facebook'].includes(tab);
  }
  function closeMenu() { $('[data-chd-menu]').hidden = true; $('[data-chd-assign]').setAttribute('aria-expanded', 'false'); }
  function setBot(ids, bot) {
    ids.forEach(id => { const p = pages.find(x => x.id === id); p.bot = bot; p.on = !!bot; });
    say(bot ? `Đã gán bot “${bot}” cho ${ids.length} trang.` : `Đã hủy gán bot cho ${ids.length} trang.`);
    draw();
  }

  const filterSel = $('[data-chd-bot]'), menu = $('[data-chd-menu]');
  BOTS.forEach(b => {
    filterSel.append(Object.assign(el('option', '', b), { value: b }));
    const li = el('li'), btn = el('button', '', b); btn.type = 'button';
    btn.addEventListener('click', () => { closeMenu(); setBot([...selected], b); });
    li.append(btn); menu.append(li);
  });
  $$('[data-chd-tab]').forEach(b => b.addEventListener('click', () => { tab = b.dataset.chdTab; selected.clear(); closeMenu(); draw(); }));
  $('[data-chd-search]').addEventListener('input', e => { query = e.target.value; draw(); });
  filterSel.addEventListener('change', e => { botFilter = e.target.value; draw(); });
  $('[data-chd-all]').addEventListener('change', e => { shown().forEach(p => { if (e.target.checked) selected.add(p.id); else selected.delete(p.id); }); draw(); });
  $('[data-chd-assign]').addEventListener('click', () => { const open = menu.hidden; menu.hidden = !open; $('[data-chd-assign]').setAttribute('aria-expanded', String(open)); if (open) menu.querySelector('button').focus(); });
  $('[data-chd-unassign]').addEventListener('click', () => setBot([...selected].filter(id => pages.find(p => p.id === id).bot), null));
  $('[data-chd-reset]').addEventListener('click', reset);
  document.addEventListener('click', e => { if (!e.target.closest('.chd-assign')) closeMenu(); });
  root.addEventListener('keydown', e => { if (e.key === 'Escape') { closeMenu(); $('[data-chd-assign]').focus(); } });

  $('[data-chd-body]').hidden = false;
  root.querySelector('noscript')?.remove();
  reset();
})();
