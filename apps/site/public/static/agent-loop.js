/* Illustrative local runs. No product, customer or account data leaves the page. */
(() => {
  const section = document.getElementById('core-ai');
  if (!section) return;
  const modes = {
    shop: {
      speaker: 'Khách hỏi', agent: 'Shop Bot', request: '“Hai chiếc size M thì bao nhiêu shop?”',
      frames: [
        ['context', 'Đọc lại mẫu áo khách vừa chọn', 'Sơ mi trắng đã chọn ở tin trước', 'Đối chiếu biến thể size M', 'Số lượng khách cần: 2', 'Đã nhận ra mẫu áo khách đang hỏi.'],
        ['tool', 'Tra đúng biến thể trong kho', 'Sơ mi trắng · Size M', 'product_details', 'Còn 3 chiếc · 350.000đ/chiếc', 'Kho còn đủ hai chiếc size M.'],
        ['result', 'Dùng giá vừa tra để tính tổng', '350.000đ/chiếc × 2', 'calculate · 350000 * 2', '700.000đ', 'Đã tính tổng hai chiếc theo giá trong kho.'],
        ['reply', 'Trả lời bằng kết quả đã kiểm tra', 'Đúng mẫu · Đúng size', 'Tra tồn kho → tính tổng', '2 chiếc · 700.000đ', '“Dạ, hai áo size M là 700.000đ. Shop còn đủ cả hai chiếc ạ.”'],
      ],
      // [frame, clock, step, action ('@name' = tool call), result, spec note]
      trace: [
        [0, '+0,0s', 'Tin đến', 'Khách nhắn qua Messenger', '', ''],
        [0, '+0,7s', 'Gom tin', 'Khách ngừng gõ, Rapiz bắt đầu xử lý', '', 'chờ 0,7 giây, lâu nhất 4 giây'],
        [0, '+0,8s', 'Ngữ cảnh', 'Đọc lại hội thoại', 'khách đang hỏi sơ mi trắng', 'nhớ nguyên văn 12 lượt gần nhất'],
        [1, '+1,2s', 'Vòng 1', '@product_details', 'size M còn 3 chiếc, 350.000đ/chiếc', ''],
        [2, '+1,8s', 'Vòng 2', '@calculate', '350.000đ × 2 = 700.000đ', 'tính chính xác tới 64 chữ số'],
        [3, '+2,3s', 'Trả lời', 'Gửi 1 tin cho khách', 'giá và số lượng lấy từ vòng 1 và 2', 'không có nguồn thì không nêu số'],
      ],
    },
    owner: {
      speaker: 'Chủ yêu cầu', agent: 'Account Bot', request: '“Mỗi sáng 8 giờ, báo tôi số đơn hôm qua nhé.”',
      frames: [
        ['context', 'Xác định việc chủ muốn theo dõi', 'Doanh nghiệp chủ được xem', 'Báo số đơn ngày trước', '08:00 mỗi sáng', 'Đã xác định cửa hàng và kỳ báo cáo.'],
        ['tool', 'Soạn lịch để chủ kiểm tra', 'Báo cáo đơn mới', 'schedule · create', 'Đề xuất đang chờ duyệt', '“Mình đã soạn lịch báo lúc 8 giờ. Bạn duyệt để bắt đầu nhé.”'],
        ['memory', 'Giữ mạch khi phiên trò chuyện dài', 'Các lượt đầu và cuối phiên', 'Tóm tắt phần giữa khi cần', 'Giữ đề xuất chưa duyệt', 'Lần trao đổi sau vẫn có thông tin về lịch đang chờ.'],
        ['learn', 'Xem lại cách chủ thường giao việc', 'Khi bật chế độ xem lại', 'Ghi nhớ sở thích hữu ích', 'Kỹ năng mới cần chủ duyệt', 'Một quy trình lặp lại có thể trở thành kỹ năng sau khi chủ duyệt.'],
      ],
      trace: [
        [0, '+0,0s', 'Chủ nhắn', 'Chủ nhắn trong khung Trợ lý Rapiz', '', ''],
        [0, '+0,3s', 'Ngữ cảnh', 'Xác định cửa hàng cần báo', '', 'chỉ đọc doanh nghiệp tài khoản được xem'],
        [1, '+1,4s', 'Vòng 1', '@schedule', 'soạn lịch báo đơn mới lúc 8:00', 'việc ghi thành đề xuất, chủ duyệt mới chạy'],
        [2, 'lượt 30', 'Thu gọn', 'Phiên trò chuyện đã dài', 'giữ phần đầu và cuối, tóm tắt phần giữa', ''],
        [3, 'chạy nền', 'Xem lại', 'Rà lại cách chủ giao việc', 'lưu sở thích, đề xuất kỹ năng mới', 'kỹ năng mới chờ chủ duyệt'],
      ],
    },
    handoff: {
      speaker: 'Khách nhắn', agent: 'Shop Bot', request: '“Mình muốn gặp nhân viên để đổi ngày nhận phòng.”',
      frames: [
        ['context', 'Đọc yêu cầu mới nhất', 'Khách muốn đổi ngày nhận phòng', 'Đọc lại hội thoại đặt phòng', 'Cần nhân viên xử lý', 'Khách đang yêu cầu gặp người phụ trách.'],
        ['tool', 'Chuyển đúng hội thoại', 'Yêu cầu đổi ngày', 'handoff', 'Kèm lý do bàn giao', 'Yêu cầu đổi ngày được chuyển cùng hội thoại.'],
        ['reply', 'Dừng lượt để nhân viên tiếp lời', 'Bàn giao thành công', 'Bot dừng trả lời', 'Nhân viên tiếp quản', 'Nhân viên có thể đọc trao đổi trước đó và trả lời ngay trong hộp thư.'],
      ],
      trace: [
        [0, '+0,0s', 'Tin đến', 'Khách nhắn qua website', '', ''],
        [0, '+0,7s', 'Ngữ cảnh', 'Đọc lại hội thoại', 'khách muốn đổi ngày nhận phòng', ''],
        [1, '+1,1s', 'Vòng 1', '@handoff', 'chuyển hội thoại cho nhân viên, kèm lý do', 'lượt kết thúc ngay'],
        [2, '+1,4s', 'Trả lời', 'Báo khách đã có nhân viên nhận', '', 'bot im lặng tới khi nhân viên trả lại'],
        [2, '+1,4s', 'Hộp thư', 'Nhân viên đọc lại trao đổi', 'trả lời ngay trong hộp thư', ''],
      ],
    },
  };
  const field = name => section.querySelector('[data-' + name + ']');
  const toggle = field('playback');
  const buttons = Array.from(section.querySelectorAll('button[data-mode]'));
  const trace = section.querySelector('.al-trace');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const still = () => reduced.matches || new URLSearchParams(location.search).get('motion') === 'static';
  let mode = 'shop', frame = 0, inView = false, paused = false, timer;
  let remaining = 4800, startedAt = 0;
  function render() {
    const scene = modes[mode];
    const [phase, caption, , , , answer] = scene.frames[frame];
    section.dataset.phase = phase;
    section.dataset.modeActive = mode;
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
    field('speaker').textContent = scene.speaker;
    field('agent').textContent = scene.agent + (phase === 'reply' ? ' · Kết quả' : ' · Đang xử lý');
    field('request').textContent = scene.request;
    field('answer').textContent = answer;
    field('caption').textContent = caption;
    // Lines of later frames stay dimmed so the log fills in as the run advances.
    trace.replaceChildren(...scene.trace.map(([at, clock, step, action, result, note]) => {
      const line = document.createElement('li');
      line.dataset.state = at < frame ? 'done' : at === frame ? 'active' : 'pending';
      const text = document.createElement('p');
      if (action.startsWith('@')) text.append('Gọi tool ', Object.assign(document.createElement('i'), { textContent: action.slice(1) }));
      else text.append(action);
      if (result) text.append(Object.assign(document.createElement('em'), { textContent: result }));
      line.append(Object.assign(document.createElement('span'), { textContent: clock }),
        Object.assign(document.createElement('b'), { textContent: step }), text);
      if (note) line.append(Object.assign(document.createElement('small'), { textContent: note }));
      return line;
    }));
    // Re-introduce only the changed captions, leaving the moving diagram uninterrupted.
    if (!still() && inView && !paused && !document.hidden) {
      for (const el of section.querySelectorAll('.al-response, .al-loghead strong, .al-trace [data-state=active]')) {
        el.animate([{ opacity: .35, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], {
          duration: 360, easing: 'ease-out'
        });
      }
    }
  }
  function stopClock() {
    if (timer !== undefined) {
      clearTimeout(timer);
      remaining = Math.max(100, remaining - (performance.now() - startedAt));
      timer = undefined;
    }
    section.dataset.running = 'false';
  }
  function sync() {
    stopClock();
    toggle.hidden = still();
    toggle.dataset.action = paused ? 'play' : 'pause';
    toggle.textContent = paused ? 'Phát tiếp' : 'Tạm dừng';
    if (still() || paused || !inView || document.hidden) return;
    section.dataset.running = 'true';
    startedAt = performance.now();
    timer = setTimeout(() => {
      timer = undefined;
      if (++frame === modes[mode].frames.length) {
        mode = buttons[(buttons.findIndex(b => b.dataset.mode === mode) + 1) % buttons.length].dataset.mode;
        frame = 0;
      }
      remaining = frame === modes[mode].frames.length - 1 ? 6500 : 4800;
      render();
      sync();
    }, remaining);
  }
  function select(next) {
    stopClock();
    mode = next;
    frame = still() ? modes[mode].frames.length - 1 : 0;
    remaining = 4800;
    render();
    sync();
  }
  function linkedMode() {
    if (['#handoff', '#handoff-desk'].includes(location.hash)) select('handoff');
  }
  section.querySelector('.al-modes').hidden = false;
  for (const button of buttons) button.addEventListener('click', () => select(button.dataset.mode));
  toggle.addEventListener('click', () => { paused = !paused; sync(); });
  reduced.addEventListener('change', () => select(mode));
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('hashchange', linkedMode);
  select(mode);
  linkedMode();
  const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; sync(); }, {threshold: 0.12});
  observer.observe(section.querySelector('.al-stage'));
})();
