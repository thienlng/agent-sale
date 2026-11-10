// Opens screenshots in a popup instead of a new tab. Links keep their href, so without JS they still open the image.
// Wide screenshots fit the screen first; tapping the image shows it at full size to scroll around.
(() => {
  const links = document.querySelectorAll('a[data-lightbox]');
  if (!links.length || !window.HTMLDialogElement) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'lightbox';
  dialog.setAttribute('aria-label', 'Ảnh màn hình cỡ lớn');
  dialog.innerHTML = '<div class="lightbox-bar"><p class="lightbox-note"></p><button type="button" class="lightbox-close">Đóng <span aria-hidden="true">✕</span></button></div>'
    + '<div class="lightbox-stage"><button type="button" class="lightbox-zoom" aria-pressed="false"><img alt=""></button></div>'
    + '<p class="lightbox-hint">Bấm vào ảnh để xem cỡ thật</p>';
  document.body.append(dialog);
  const img = dialog.querySelector('img'), zoom = dialog.querySelector('.lightbox-zoom');
  const note = dialog.querySelector('.lightbox-note'), hint = dialog.querySelector('.lightbox-hint');

  function setActual(on) {
    dialog.classList.toggle('is-actual', on);
    zoom.setAttribute('aria-pressed', String(on));
    zoom.setAttribute('aria-label', on ? 'Thu ảnh vừa màn hình' : 'Xem ảnh cỡ thật');
    hint.textContent = on ? 'Bấm vào ảnh để thu lại' : 'Bấm vào ảnh để xem cỡ thật';
  }
  links.forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    const source = link.closest('figure, article')?.querySelector('img') || link.querySelector('img');
    img.src = link.href;
    img.alt = source?.alt || '';
    // Screenshots are captured at 2x or more; "full size" shows them at 2x so text matches the app.
    const width = +(source?.getAttribute('width')) || 0;
    dialog.style.setProperty('--actual', width ? width / 2 + 'px' : 'auto');
    note.textContent = link.dataset.lightbox || '';
    setActual(false);
    dialog.showModal();
    dialog.querySelector('.lightbox-close').focus();
  }));
  zoom.addEventListener('click', () => setActual(!dialog.classList.contains('is-actual')));
  dialog.querySelector('.lightbox-close').addEventListener('click', () => dialog.close());
  // A click on the dark area around the image closes the popup.
  dialog.addEventListener('click', event => { if (event.target === dialog || event.target.classList.contains('lightbox-stage')) dialog.close(); });
})();
