// "Thử hỏi trợ lý" on tinh-nang/tro-ly-rapiz. Runs locally. The three first answers are the assistant's
// own replies on the demo shop; the follow-up FAQ card shows the same proposal flow.
(() => {
  const desk = document.querySelector('[data-assistant]');
  if (!desk) return;
  const $ = s => desk.querySelector(s);
  const thread = $('[data-as-thread]'), status = $('[data-as-status]'), announce = $('[data-as-announce]');
  const DAYS = [['04/11', 0], ['05/11', 1], ['06/11', 0], ['07/11', 1], ['08/11', 1], ['09/11', 1], ['10/11', 4]];
  const done = { schedule: null, faq: null };

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  function answer(...parts) { const a = el('div', 'as-a'); parts.forEach(p => a.append(typeof p === 'string' ? el('p', '', p) : p)); thread.append(a); return a; }

  function chart() {
    const box = el('figure', 'as-chart');
    const cap = el('figcaption', '', 'Lụa Hiên · Số đơn theo ngày 04–10/11/2026');
    const bars = el('div', 'as-bars');
    bars.setAttribute('role', 'img');
    bars.setAttribute('aria-label', 'Số đơn từ 04/11 đến 10/11: ' + DAYS.map(([d, n]) => `${d} ${n}`).join(', ') + '.');
    DAYS.forEach(([d, n]) => { const b = el('span'); b.style.setProperty('--n', n); b.dataset.day = d; b.dataset.n = n; bars.append(b); });
    const table = el('table', 'as-table'); table.hidden = true;
    table.innerHTML = '<thead><tr><th scope="col">Ngày</th><th scope="col">Số đơn</th></tr></thead>';
    const body = el('tbody'); DAYS.forEach(([d, n]) => { const r = el('tr'); r.append(el('td', '', d), el('td', '', String(n))); body.append(r); }); table.append(body);
    const toggle = el('button', 'as-link', 'Xem bảng'); toggle.type = 'button';
    toggle.addEventListener('click', () => { table.hidden = !table.hidden; bars.hidden = !table.hidden; toggle.textContent = table.hidden ? 'Xem bảng' : 'Xem biểu đồ'; });
    box.append(cap, toggle, bars, table);
    return box;
  }

  // A proposal card: nothing changes until the owner presses Áp dụng.
  function card(key, title, rows, onApply) {
    const c = el('div', 'as-card');
    c.append(el('small', '', title));
    const dl = el('dl'); rows.forEach(([k, v]) => { const d = el('div'); d.append(el('dt', '', k), el('dd', '', v)); dl.append(d); }); c.append(dl);
    const actions = el('div', 'as-card-actions');
    const state = el('p', 'as-card-state');
    if (done[key]) { state.textContent = done[key]; c.append(state); return c; }
    const apply = el('button', 'fe-btn', 'Áp dụng'), skip = el('button', 'fe-reset', 'Bỏ');
    apply.type = skip.type = 'button';
    // The buttons disappear once decided, so focus moves to the line that says what happened.
    state.tabIndex = -1;
    const decide = (text) => { done[key] = text; actions.replaceWith(Object.assign(state, { textContent: text })); state.focus(); };
    apply.addEventListener('click', () => { decide('Đã áp dụng'); onApply(); });
    skip.addEventListener('click', () => { decide('Đã bỏ'); announce.textContent = 'Đã bỏ đề xuất. Không có gì thay đổi.'; });
    actions.append(apply, skip); c.append(actions);
    return c;
  }
  function addTo(list, text) {
    const ul = $(list); ul.querySelector('.as-empty')?.remove(); ul.append(el('li', '', text));
  }

  const ASK = {
    chart() {
      answer('Em đã vẽ biểu đồ số đơn theo ngày từ 04 đến 10/11/2026, tính đến 17:24 hôm nay. Tổng cộng 8 đơn. Ngày nhiều đơn nhất là 10/11 với 4 đơn. Số liệu tính theo ngày đặt đơn, gồm mọi trạng thái đơn.', chart());
      return 'Trợ lý trả lời: tổng 8 đơn, ngày 10/11 nhiều nhất với 4 đơn. Có biểu đồ và bảng.';
    },
    schedule() {
      answer('Em đã tạo đề xuất gửi doanh thu hôm qua của Lụa Hiên, vào 8:00 mỗi sáng qua thông báo trong ứng dụng. Anh/chị duyệt thẻ đề xuất để Rapiz kích hoạt lịch nhé.',
        card('schedule', 'Tạo lịch', [['Tên lịch', 'Doanh thu hôm qua lúc 8h'], ['Nội dung', 'Doanh thu'], ['Lịch gửi', 'Hằng ngày lúc 08:00'], ['Gửi qua', 'Trong ứng dụng']], () => {
          addTo('[data-as-schedules]', 'Doanh thu hôm qua lúc 8h · Hằng ngày lúc 08:00 · Trong ứng dụng');
          status.textContent = 'Bạn vừa áp dụng một lịch báo cáo';
          announce.textContent = 'Đã áp dụng. Lịch báo cáo doanh thu hôm qua lúc 8h đã bật.';
        }));
      return 'Trợ lý đề xuất lịch báo cáo doanh thu lúc 8 giờ sáng. Chờ bạn bấm Áp dụng hoặc Bỏ.';
    },
    doctor() {
      const follow = el('button', 'as-follow', 'Có, tặng hộp quà miễn phí khi mua khăn lụa');
      follow.type = 'button';
      follow.addEventListener('click', () => {
        follow.remove();
        thread.append(el('p', 'as-q', follow.textContent));
        answer('Em soạn đề xuất thêm câu hỏi thường gặp này cho bot để anh/chị duyệt nhé.',
          card('faq', 'Thêm câu hỏi thường gặp', [['Cho', 'Lụa Hiên'], ['Câu hỏi', 'Khăn lụa có kèm hộp quà không?'], ['Trả lời', 'Dạ có ạ, shop tặng hộp quà miễn phí khi mua khăn lụa.']], () => {
            addTo('[data-as-changes]', 'Thêm câu hỏi thường gặp: Khăn lụa có kèm hộp quà không?');
            status.textContent = 'Bạn vừa áp dụng một thay đổi cho bot';
            announce.textContent = 'Đã áp dụng. Bot đã có câu trả lời về hộp quà.';
          }));
        announce.textContent = 'Trợ lý đề xuất thêm một câu hỏi thường gặp. Chờ bạn bấm Áp dụng hoặc Bỏ.';
        (thread.querySelector('.as-card-actions .fe-btn') || thread.querySelector('.as-card-state'))?.focus();
      });
      answer('Bot đã trả lời lúc 16:37 nhưng chưa giải đáp chuyện hộp quà: “Em chưa có thông tin về hộp quà kèm khăn ạ.”',
        'Nguyên nhân: bot không tìm được câu hỏi thường gặp nào về hộp quà. Các câu tìm thấy chỉ nói về đổi size và giặt lụa.',
        'Cách sửa: bổ sung thông tin hộp quà. Khăn lụa có kèm hộp quà miễn phí, bán riêng hay không có hộp ạ?', follow);
      return 'Trợ lý chỉ ra nguyên nhân: bot thiếu thông tin hộp quà, và hỏi lại bạn để soạn đề xuất.';
    },
  };
  const asks = [...desk.querySelectorAll('[data-as-ask]')];
  asks.forEach(b => b.addEventListener('click', () => {
    asks.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    thread.replaceChildren(el('p', 'as-q', b.textContent));
    announce.textContent = ASK[b.dataset.asAsk]();
  }));
  // The questions ship hidden so the page reads as a static example without JS.
  $('[data-as-asks]').hidden = false;
  thread.replaceChildren(el('p', 'as-q', asks[0].textContent));
  asks[0].setAttribute('aria-pressed', 'true');
  asks.slice(1).forEach(b => b.setAttribute('aria-pressed', 'false'));
  ASK.chart();
})();
