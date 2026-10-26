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
    opts = opts || {};
    opts.headers = Object.assign({ 'X-Requested-With': 'fetch' }, opts.headers);
    opts.credentials = 'same-origin';
    try { r = await fetch(path, opts); } catch (e) { throw { code: 'NETWORK' }; }
    var body = null;
    try { body = await r.json(); } catch (e) { /* không phải JSON */ }
    if (!r.ok) throw { code: (body && body.error) || 'UNKNOWN' };
    return body;
  }
  function link(href, key, cls) {
    var a = document.createElement('a');
    a.href = href; a.className = cls || 'text-slate-600 hover:text-blue-600';
    a.setAttribute('data-i18n', key); a.textContent = window.I18N.t(key);
    return a;
  }
  // Header: Đăng nhập/Đăng ký khi chưa đăng nhập, email + Đăng xuất khi đã đăng nhập.
  async function authNav() {
    var box = document.getElementById('auth-nav');
    if (!box) return;
    var me = null;
    try { me = await api('/api/auth/me'); } catch (e) { /* khách */ }
    box.textContent = '';
    if (!me) { box.appendChild(link('/login', 'nav.login')); box.appendChild(link('/register', 'nav.register')); return; }
    var span = document.createElement('span'); span.className = 'text-slate-500'; span.textContent = me.user.email;
    var b = document.createElement('button'); b.type = 'button'; b.className = 'text-slate-600 hover:text-blue-600';
    b.setAttribute('data-i18n', 'nav.logout'); b.textContent = window.I18N.t('nav.logout');
    b.addEventListener('click', async function () {
      try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { /* bỏ qua */ }
      location.href = '/';
    });
    box.appendChild(span); box.appendChild(b);
  }
  if (window.I18N) window.I18N.ready.then(authNav);
  window.App = { errText: errText, copy: copy, api: api };
})();
