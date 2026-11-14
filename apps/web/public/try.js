/* global window, document, URLSearchParams */
// Loads the website chat widget of the site key in `?key=` (try.html): a page that stands in for
// the shop's own website, so a channel can be tried without one. The channel must allow this domain.
(function () {
  var key = new URLSearchParams(window.location.search).get('key') || '';
  var status = document.getElementById('try-status');
  if (!/^wk_[A-Za-z0-9_-]{8,64}$/.test(key)) {
    if (status) status.textContent = 'Thiếu mã kênh website (?key=wk_…).';
    return;
  }
  var script = document.createElement('script');
  script.src = '/widget.js?key=' + encodeURIComponent(key);
  script.async = true;
  document.body.appendChild(script);
})();
