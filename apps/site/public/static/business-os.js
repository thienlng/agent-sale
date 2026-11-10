/* Local illustration. A customer confirmation creates one order in this sample only. */
const confirmOrder = document.getElementById('os-confirm');
if (confirmOrder) {
  let confirmed = false;
  const count = document.getElementById('os-count');
  confirmOrder.hidden = false;
  confirmOrder.addEventListener('click', () => {
    confirmed = !confirmed;
    confirmOrder.closest('.os-spread').classList.toggle('os-confirmed', confirmed);
    document.getElementById('os-order-state').textContent = confirmed
      ? 'Đơn SM04 · Khách đã xác nhận' : 'Bản tóm tắt · Chờ khách xác nhận';
    confirmOrder.firstChild.textContent = confirmed ? 'Thử lại tình huống ' : 'Khách xác nhận đơn ';
    count.textContent = confirmed ? '4' : '3';
    document.getElementById('os-ledger').textContent = confirmed
      ? 'Gồm đơn SM04 · 1 áo sơ mi trắng vừa được xác nhận.' : 'Phiếu đang chờ khách nên chưa được tính.';
    document.getElementById('os-announcement').textContent = confirmed
      ? 'Khách đã xác nhận đơn SM04. Shop có 4 đơn mới trong ngày.' : 'Đã đặt lại ví dụ. Shop có 3 đơn mới trong ngày.';
  });
}
