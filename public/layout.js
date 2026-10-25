/* Tiện ích dùng chung: copy, hiển thị lỗi từ mã lỗi API. */
(function () {
  function errText(code) {
    var key = 'error.' + code;
    var s = window.I18N.t(key);
    return s === key ? window.I18N.t('error.UNKNOWN') : s;
  }
  function copy(text, btn) {
    var done = function () {
      btn.textContent = window.I18N.t('common.copied');
      setTimeout(function () { btn.textContent = window.I18N.t('common.copy'); }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done);
    else {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* bỏ qua */ }
      ta.remove();
    }
  }
  async function api(path, opts) {
    var r;
    try { r = await fetch(path, opts); } catch (e) { throw { code: 'NETWORK' }; }
    var body = null;
    try { body = await r.json(); } catch (e) { /* không phải JSON */ }
    if (!r.ok) throw { code: (body && body.error) || 'UNKNOWN' };
    return body;
  }
  window.App = { errText: errText, copy: copy, api: api };
})();
