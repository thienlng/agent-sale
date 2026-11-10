// "Thử chốt một đơn" on tinh-nang/ban-hang-ai. Runs locally: the visitor plays the customer, the page plays
// the server tools (stock check, order summary, order creation) with the same wording the bot sends.
(() => {
  const desk = document.querySelector('[data-sale]');
  if (!desk) return;
  const PRICE = 880000, SHIP = 30000, CODE = 'DH000042';
  const STOCK = { S: 5, M: 4, L: 2, XL: 0 };
  const $ = s => desk.querySelector(s);
  const pick = $('[data-sl-pick]'), thread = $('[data-sl-thread]'), qtyOut = $('[data-sl-qty]');
  const status = $('[data-sl-status]'), empty = $('[data-sl-empty]'), order = $('[data-sl-order]');
  const badge = $('[data-sl-badge]'), approve = $('[data-sl-approve]'), reset = $('[data-sl-reset]');
  const announce = $('[data-sl-announce]');
  const vnd = n => n.toLocaleString('vi-VN') + 'đ';
  let qty = 1;
  const size = () => pick.querySelector('input:checked').value;

  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; }
  function msg(who, text) {
    const box = el('article', 'fe-msg' + (who === 'bot' ? ' is-bot' : ''));
    box.append(el('span', '', who === 'bot' ? 'Bot' : 'Mai Linh'), el('p', '', text));
    thread.append(box); return box;
  }
  function tool(name) { const t = el('p', 'fe-tool'); t.append('Gọi tool ', el('i', '', name)); thread.append(t); }

  function draft(quiet) {
    thread.replaceChildren();
    const s = size();
    msg('customer', `lay ${qty} bo do ngu lua size ${s} nha shop. gui Mai Linh 0912345678, 25 Nguyen Van Dau Binh Thanh`);
    tool('search_products');
    if (!STOCK[s]) {
      msg('bot', 'Dạ size XL bên em đang hết hàng ạ. Size L còn 2 bộ, chị muốn đổi sang size L không ạ?');
      setStatus('Hết hàng nên bot không lên đơn');
      if (!quiet) announce.textContent = 'Size XL hết hàng. Bot không lên đơn và gợi ý size L.';
      return;
    }
    tool('prepare_order');
    if (qty > STOCK[s]) {
      msg('bot', `Dạ size ${s} bên em chỉ còn ${STOCK[s]} bộ ạ. Chị lấy ${STOCK[s]} bộ được không ạ?`);
      setStatus('Không đủ hàng nên bot hỏi lại khách');
      if (!quiet) announce.textContent = `Size ${s} chỉ còn ${STOCK[s]} bộ. Bot hỏi lại khách.`;
      return;
    }
    const line = PRICE * qty;
    msg('bot', [
      'Dạ em tóm tắt đơn của mình ạ:',
      `• Bộ đồ ngủ lụa (${s}) ×${qty} — ${vnd(line)}`,
      `Phí ship: ${vnd(SHIP)}`,
      `Tổng: ${vnd(line + SHIP)}`,
      'Người nhận: Mai Linh · 0912 345 678',
      'Địa chỉ: 25 Nguyen Van Dau Binh Thanh',
    ].join('\n'));
    const replies = el('div', 'sl-replies');
    const ok = el('button', '', '✅ Đặt hàng'), edit = el('button', '', '✏️ Sửa thông tin');
    ok.type = edit.type = 'button';
    ok.addEventListener('click', confirm);
    edit.addEventListener('click', askEdit);
    replies.append(ok, edit);
    thread.append(replies);
    setStatus('Chờ khách xác nhận');
    if (!quiet) announce.textContent = `Bot gửi tóm tắt đơn: ${qty} bộ size ${s}, tổng ${vnd(line + SHIP)}. Chờ khách bấm Đặt hàng.`;
  }
  function setStatus(text) { status.textContent = text; }

  function confirm() {
    const s = size(), total = PRICE * qty + SHIP;
    thread.querySelector('.sl-replies')?.remove();
    msg('customer', '✅ Đặt hàng');
    tool('confirm_order');
    msg('bot', `Dạ em đã tạo đơn ${CODE} cho mình ạ. Shop sẽ kiểm tra và liên hệ xác nhận sớm ạ.`);
    pick.disabled = true;
    $('[data-sl-line]').textContent = `Bộ đồ ngủ lụa (${s}) ×${qty}`;
    $('[data-sl-total]').textContent = vnd(total);
    badge.textContent = 'Chờ duyệt';
    empty.hidden = true; order.hidden = false; approve.hidden = false; reset.hidden = false;
    desk.dataset.phase = 'ordered';
    setStatus('Đơn mới chờ nhân viên duyệt');
    announce.textContent = `Khách đã đặt hàng. Đơn ${CODE} vào danh sách với nhãn Bot, Chờ duyệt.`;
    approve.focus();
  }
  function askEdit() {
    thread.querySelector('.sl-replies')?.remove();
    msg('customer', '✏️ Sửa thông tin');
    msg('bot', 'Dạ chị muốn sửa size, số lượng hay thông tin người nhận ạ?');
    setStatus('Khách đang sửa: đổi size hoặc số lượng');
    pick.querySelector('input:checked').focus();
  }
  approve.addEventListener('click', () => {
    badge.textContent = 'Đã duyệt';
    approve.hidden = true;
    desk.dataset.phase = 'approved';
    setStatus('Đơn đã duyệt, sẵn sàng xử lý');
    announce.textContent = `Đã duyệt đơn ${CODE}.`;
    reset.focus();
  });
  reset.addEventListener('click', () => {
    pick.disabled = false;
    pick.querySelector('input[value=M]').checked = true;
    setQty(1);
    empty.hidden = false; order.hidden = true; reset.hidden = true;
    delete desk.dataset.phase;
    draft(true);
    announce.textContent = 'Đã làm lại demo.';
    pick.querySelector('input:checked').focus();
  });
  pick.addEventListener('change', () => draft());
  const steps = [...desk.querySelectorAll('[data-sl-step]')];
  function setQty(n) {
    qty = Math.min(5, Math.max(1, n));
    qtyOut.value = qtyOut.textContent = String(qty);
    steps.forEach(b => { b.disabled = (b.dataset.slStep < 0 && qty === 1) || (b.dataset.slStep > 0 && qty === 5); });
  }
  steps.forEach(b => b.addEventListener('click', () => { setQty(qty + Number(b.dataset.slStep)); draft(); }));
  // The controls ship disabled so the page reads as a static example without JS.
  pick.disabled = false;
  setQty(1);
  draft(true);
})();
