// "Thử dặn bot một dòng" on tinh-nang/dao-tao-ai. Runs locally. Answer A is what the real bot replied
// after the same line was added to its Đổi trả field; answer B follows the same pattern for the other line.
(() => {
  const desk = document.querySelector('[data-train]');
  if (!desk) return;
  const $ = s => desk.querySelector(s);
  const pick = $('[data-td-pick]'), save = $('[data-td-save]'), reset = $('[data-td-reset]');
  const added = $('[data-td-added]'), thread = $('[data-td-thread]'), history = $('[data-td-history]');
  const restore = $('[data-td-restore]'), status = $('[data-td-status]'), announce = $('[data-td-announce]');
  const QUESTION = 'shop co doi size ko a, mac roi thi sao';
  const BEFORE = 'Dạ Lụa Hiên hỗ trợ đổi size trong 7 ngày kể từ khi nhận hàng, sản phẩm còn tem mác và chưa giặt.\nVới đồ đã mặc, em chưa rõ có được đổi không ạ.';
  const AFTER = {
    a: 'Dạ Lụa Hiên hỗ trợ đổi size trong 7 ngày kể từ khi nhận hàng, sản phẩm còn tem mác và chưa giặt.\nĐồ đã mặc hoặc đã giặt không đổi được, trừ khi có lỗi từ nhà sản xuất ạ.',
    b: 'Dạ Lụa Hiên hỗ trợ đổi size trong 7 ngày kể từ khi nhận hàng.\nĐồ chị đã mặc thử vẫn đổi được nếu còn tem mác và chưa giặt ạ.',
  };
  const initial = thread.innerHTML;
  const line = () => pick.querySelector('input:checked');

  function p(cls, text) { const n = document.createElement('p'); n.className = cls; n.textContent = text; thread.append(n); return n; }
  // The real bot answers in short bubbles and names the FAQ it used.
  function ask(label, answer) {
    p('td-divider', label);
    p('td-msg td-customer', QUESTION);
    answer.split('\n').forEach(line => p('td-msg td-bot', line));
    p('td-source', 'Trả lời từ FAQ: Shop có đổi size không?');
    thread.lastElementChild.scrollIntoView({ block: 'nearest' });
  }

  save.addEventListener('click', () => {
    const chosen = line();
    const text = chosen.nextElementSibling.textContent;
    added.textContent = text;
    added.hidden = false;
    $('[data-td-new]').textContent = '…chưa giặt. ' + text;
    history.hidden = false;
    restore.hidden = false;
    pick.disabled = true;
    save.hidden = true;
    reset.hidden = false;
    ask('Hỏi lại sau khi lưu', AFTER[chosen.value]);
    status.textContent = 'Đã lưu, bot dùng ngay';
    announce.textContent = 'Đã lưu. Bot trả lời lại: ' + AFTER[chosen.value].replace('\n', ' ');
    restore.focus();
  });
  restore.addEventListener('click', () => {
    added.hidden = true;
    restore.hidden = true;
    $('.td-change').textContent = 'Đã khôi phục Đổi trả về bản trước';
    ask('Hỏi lại sau khi khôi phục', BEFORE);
    status.textContent = 'Đã khôi phục bản trước';
    announce.textContent = 'Đã khôi phục. Bot lại trả lời là chưa rõ.';
    reset.focus();
  });
  reset.addEventListener('click', () => {
    thread.innerHTML = initial;
    added.hidden = true;
    history.hidden = true;
    $('.td-change').innerHTML = 'Chỉnh sửa <b>Đổi trả</b> <span>…chưa giặt.</span> → <span data-td-new></span>';
    pick.disabled = false;
    save.hidden = false;
    reset.hidden = true;
    status.textContent = 'Bot chưa có thông tin này';
    announce.textContent = 'Đã làm lại demo.';
    line().focus();
  });
  // The controls ship disabled so the page reads as a static example without JS.
  pick.disabled = false;
  save.disabled = false;
})();
