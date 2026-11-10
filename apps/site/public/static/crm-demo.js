// "Theo một khách đến cuối" on tinh-nang/khach-hang-thong-ke. Runs locally with each industry's built-in
// statuses: the bot's request moves the customer, every later step is a staff action.
(() => {
  const desk = document.querySelector('[data-crm]');
  if (!desk) return;
  const $ = s => desk.querySelector(s);
  const CASES = {
    spa: {
      name: 'Ngọc Trâm', meta: 'Website · 0938 111 222 · Sales: Lan', visitor: 'Khách website 2391',
      ask: 'goi dau duong sinh 60p thu 7 nay 10h, 1 nguoi. Ngoc Tram 0938111222',
      reply: 'Dạ em đã ghi nhận yêu cầu đặt lịch Gội đầu dưỡng sinh 60 phút lúc 10:00, Thứ Bảy 14/11/2026, cho 1 người. Nhân viên sẽ gọi xác nhận lịch cho chị ạ.',
      note: 'Bot AI · Đặt lịch (bot ghi nhận)',
      lines: ['Dịch vụ: Gội đầu dưỡng sinh 60 phút', 'Ngày: Thứ Bảy 14/11/2026', 'Giờ: 10:00', 'Số người: 1'],
      statuses: ['Khách mới', 'Đang tư vấn', 'Yêu cầu đặt lịch', 'Đã xác nhận lịch', 'Đã đến', 'Không đến', 'Không quan tâm'],
      start: 2, steps: [['Xác nhận lịch', 3], ['Ghi nhận khách đã đến', 4]],
    },
    edu: {
      name: 'Minh Anh', meta: 'Website · 0903 222 333 · Sales: Hoa', visitor: 'Khách website 2394',
      ask: 'cho be Bo 9 tuoi hoc thu tieng Anh giao tiep, toi thu 3 duoc ko a. Minh Anh 0903222333',
      reply: 'Dạ em đã ghi nhận đăng ký học thử Tiếng Anh giao tiếp cho bé Bo, 9 tuổi, buổi tối thứ Ba. Tư vấn viên sẽ gọi hẹn lịch cho anh/chị ạ.',
      note: 'Bot AI · Đăng ký học thử (bot ghi nhận)',
      lines: ['Học viên: Bo, 9 tuổi', 'Khóa học: Tiếng Anh giao tiếp', 'Thời gian mong muốn: tối thứ Ba'],
      statuses: ['Lead mới', 'Đang tư vấn', 'Đăng ký test / học thử', 'Đã hẹn test / học thử', 'Đã test / học thử', 'Đã đăng ký học', 'Không theo học'],
      start: 2, steps: [['Hẹn lịch học thử', 3], ['Ghi nhận đã học thử', 4], ['Ghi nhận đăng ký học', 5]],
    },
  };
  const tabs = [...desk.querySelectorAll('[data-kh-tab]')];
  const next = $('[data-kh-next]'), reset = $('[data-kh-reset]'), pipe = $('[data-kh-pipe]'), log = $('[data-kh-log]');
  const status = $('[data-kh-status]'), announce = $('[data-kh-announce]');
  let c, at, step;

  function li(html) { const n = document.createElement('li'); n.innerHTML = html; return n; }
  function text(sel, value) { $(sel).textContent = value; }
  function drawPipe() {
    pipe.replaceChildren(...c.statuses.map((name, i) => {
      const n = document.createElement('li');
      n.textContent = name;
      if (i < at && i <= c.steps.at(-1)[1]) n.className = 'is-done';
      if (i > c.steps.at(-1)[1]) n.className = 'is-exit';
      if (i === at) n.setAttribute('aria-current', 'step');
      return n;
    }));
  }
  function load(key) {
    c = CASES[key]; at = c.start; step = 0;
    tabs.forEach(t => t.setAttribute('aria-pressed', String(t.dataset.khTab === key)));
    text('[data-kh-name]', c.name); text('[data-kh-meta]', c.meta); text('[data-kh-note-title]', c.note);
    $('[data-kh-note]').replaceChildren(...c.lines.map(line => Object.assign(document.createElement('li'), { textContent: line })));
    const [ask, , reply] = $('[data-kh-thread]').children;
    ask.querySelector('span').textContent = c.visitor; ask.querySelector('p').textContent = c.ask;
    reply.querySelector('p').textContent = c.reply;
    log.replaceChildren(li(`Bot AI chuyển trạng thái sang <b>${c.statuses[at]}</b>`));
    next.textContent = c.steps[0][0]; next.hidden = false; reset.hidden = true;
    status.textContent = 'Bot vừa chuyển trạng thái';
    drawPipe();
  }
  next.addEventListener('click', () => {
    const [label, to] = c.steps[step];
    at = to; step += 1;
    log.append(li(`Bạn chuyển trạng thái sang <b>${c.statuses[at]}</b>`));
    drawPipe();
    status.textContent = step < c.steps.length ? 'Nhân viên đang xử lý' : 'Đã xong việc của khách này';
    announce.textContent = `${label}. Trạng thái mới: ${c.statuses[at]}.`;
    if (step < c.steps.length) next.textContent = c.steps[step][0];
    else { next.hidden = true; reset.hidden = false; reset.focus(); }
  });
  reset.addEventListener('click', () => {
    load(tabs.find(t => t.getAttribute('aria-pressed') === 'true').dataset.khTab);
    announce.textContent = 'Đã làm lại.';
    next.focus();
  });
  tabs.forEach(t => {
    t.addEventListener('click', () => { load(t.dataset.khTab); announce.textContent = `Ngành ${t.textContent}: ${c.name}, trạng thái ${c.statuses[at]}.`; });
  });
  // The tabs and the step button ship hidden or disabled so the page reads as a static example without JS.
  $('[data-kh-tabs]').hidden = false;
  next.disabled = false;
  load('spa');
})();
