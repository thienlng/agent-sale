// "Thử bật từng công tắc" on tinh-nang/binh-luan-facebook. Runs locally with the app's own labels: one AI
// text goes to the public reply and the private message alike; hiding only follows the keywords.
(() => {
  const desk = document.querySelector('[data-comments]');
  if (!desk) return;
  const $ = s => desk.querySelector(s);
  const on = { public: false, private: false, hide: false };
  let unhidden = false;
  const WAIT = 'Chờ nhân viên xem trong Hộp thư', REVIEW = 'Cần nhân viên xem · đã dừng tự trả lời';
  const switches = [...desk.querySelectorAll('[data-cm-switch]')];
  const item = key => $(`[data-cm="${key}"]`);
  const state = (key, text) => { item(key).querySelector('[data-cm-state]').textContent = text; };

  function render() {
    const auto = on.public || on.private;
    // Thu Hà asks about price: the bot answers from the post and the catalog.
    $('[data-cm-public]').hidden = !on.public;
    state('ask', on.public && on.private ? 'Trả lời công khai và nhắn riêng cùng nội dung'
      : on.public ? 'Trả lời công khai · đã gửi'
      : on.private ? 'Nhắn riêng · đã gửi vào Messenger của Thu Hà'
      : WAIT);
    // The spam matches a keyword: hidden, never deleted.
    const hidden = on.hide && !unhidden;
    item('spam').dataset.hidden = String(hidden);
    $('[data-cm-unhide]').hidden = !hidden;
    // Hiding never skips staff: the hidden comment still waits for review. Not hidden, the bot answers it like any other.
    state('spam', hidden ? 'Đang ẩn · Khớp từ khóa: quà free · chờ nhân viên xem' : on.hide ? 'Đã hiện lại' : auto ? 'Bot cũng trả lời bình luận này. Bật ẩn theo từ khóa để chặn.' : WAIT);
    // A late delivery needs a person: the bot stops and leaves it for staff.
    state('late', auto ? REVIEW : WAIT);
    item('ask').dataset.done = String(auto);
    const parts = [];
    if (on.public || on.private) parts.push('1 bình luận được trả lời');
    if (hidden) parts.push('1 đang ẩn');
    const review = (auto ? 1 : 0) + (hidden ? 1 : 0);
    if (review) parts.push(`${review} cần nhân viên`);
    $('[data-cm-status]').textContent = parts.length ? parts.join(' · ') : 'Chưa bật xử lý tự động';
    return parts.join(', ') || 'Chưa bật xử lý tự động';
  }

  switches.forEach(button => button.addEventListener('click', () => {
    const key = button.dataset.cmSwitch;
    on[key] = !on[key];
    if (key === 'hide') unhidden = false;
    button.setAttribute('aria-checked', String(on[key]));
    $('[data-cm-announce]').textContent = `${button.textContent.trim()}: ${on[key] ? 'bật' : 'tắt'}. ${render()}.`;
  }));
  $('[data-cm-unhide]').addEventListener('click', () => {
    unhidden = true;
    $('[data-cm-announce]').textContent = `Đã hiện lại bình luận. ${render()}.`;
    switches[2].focus();
  });
  // The switches ship disabled so the page reads as a static example without JS.
  switches.forEach(button => { button.disabled = false; });
  render();
})();
