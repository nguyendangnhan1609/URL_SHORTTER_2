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
  function el(tag, cls, key, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (key) { e.setAttribute('data-i18n', key); e.textContent = window.I18N ? window.I18N.t(key) : ''; }
    else if (text != null) e.textContent = text;
    return e;
  }
  function link(href, key, cls) {
    var a = el('a', cls || 'text-slate-600 hover:text-indigo-600', key);
    a.href = href;
    return a;
  }
  var BTN_GHOST = 'px-4 py-2 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-100 transition';
  var BTN_GRAD = 'px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 via-violet-600 to-cyan-500 shadow-md shadow-indigo-200 hover:opacity-90 transition';

  // Header chung: logo, menu, ngôn ngữ, khu vực tài khoản (#auth-nav).
  function renderHeader() {
    var host = document.getElementById('site-header');
    if (!host) return;
    var cur = location.pathname.replace(/\/+$/, '') || '/';
    function nav(href, key) {
      var on = cur === href;
      return link(href, key, 'px-3 py-2 rounded-lg text-sm font-medium transition ' +
        (on ? 'text-indigo-700 bg-indigo-50' : 'text-slate-600 hover:text-indigo-700 hover:bg-slate-100'));
    }
    host.className = 'sticky top-0 z-30 bg-white/80 backdrop-blur border-b border-slate-200';
    var bar = el('div', 'max-w-6xl mx-auto px-4 py-3 flex items-center gap-2');
    var logo = el('a', 'flex items-center gap-2 font-extrabold text-lg text-slate-900 mr-4');
    logo.href = '/';
    var mark = el('span', 'inline-flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 via-violet-500 to-cyan-400 text-white shadow-md', null, '\u2197');
    logo.appendChild(mark);
    logo.appendChild(el('span', null, 'app.name'));
    var menu = el('nav', 'hidden md:flex items-center gap-1');
    menu.id = 'main-menu';
    menu.appendChild(nav('/', 'nav.home'));
    menu.appendChild(nav('/dashboard', 'nav.dashboard'));
    var right = el('div', 'ml-auto flex items-center gap-2');
    var auth = el('span', 'hidden sm:flex items-center gap-2 text-sm');
    auth.id = 'auth-nav';
    var lab = el('label', 'text-sm');
    lab.appendChild(el('span', 'sr-only', 'nav.language'));
    var sel = el('select', 'border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700');
    sel.id = 'lang-select';
    lab.appendChild(sel);
    var burger = el('button', 'md:hidden p-2 rounded-lg hover:bg-slate-100', null, '\u2630');
    burger.type = 'button'; burger.id = 'menu-toggle';
    burger.setAttribute('aria-controls', 'mobile-panel'); burger.setAttribute('aria-expanded', 'false');
    var bsr = el('span', 'sr-only', 'nav.menu'); burger.appendChild(bsr);
    right.appendChild(auth); right.appendChild(lab); right.appendChild(burger);
    bar.appendChild(logo); bar.appendChild(menu); bar.appendChild(right);
    var panel = el('div', 'md:hidden hidden border-t border-slate-200 px-4 py-3 space-y-1');
    panel.id = 'mobile-panel';
    panel.appendChild(nav('/', 'nav.home')); panel.appendChild(nav('/dashboard', 'nav.dashboard'));
    var auth2 = el('div', 'flex items-center gap-2 pt-2 text-sm');
    auth2.id = 'auth-nav-mobile';
    panel.appendChild(auth2);
    burger.addEventListener('click', function () {
      var open = panel.classList.toggle('hidden') === false;
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    host.textContent = '';
    host.appendChild(bar); host.appendChild(panel);
  }

  function renderFooter() {
    var host = document.getElementById('site-footer');
    if (!host) return;
    host.className = 'mt-16 bg-slate-900 text-slate-300';
    var wrap = el('div', 'max-w-6xl mx-auto px-4 py-10 grid gap-8 sm:grid-cols-3');
    var c1 = el('div');
    c1.appendChild(el('p', 'font-extrabold text-white text-lg', 'app.name'));
    c1.appendChild(el('p', 'mt-2 text-sm text-slate-400', 'footer.tagline'));
    var c2 = el('div');
    c2.appendChild(el('p', 'font-semibold text-white mb-2', 'footer.product'));
    [['/', 'nav.home'], ['/dashboard', 'nav.dashboard']].forEach(function (x) {
      var p = el('p', 'text-sm'); p.appendChild(link(x[0], x[1], 'hover:text-white')); c2.appendChild(p);
    });
    var c3 = el('div');
    c3.appendChild(el('p', 'font-semibold text-white mb-2', 'footer.account'));
    [['/login', 'nav.login'], ['/register', 'nav.register']].forEach(function (x) {
      var p = el('p', 'text-sm'); p.appendChild(link(x[0], x[1], 'hover:text-white')); c3.appendChild(p);
    });
    wrap.appendChild(c1); wrap.appendChild(c2); wrap.appendChild(c3);
    var bottom = el('div', 'border-t border-slate-800 text-center text-xs text-slate-500 py-4');
    bottom.appendChild(document.createTextNode('\u00a9 ' + new Date().getFullYear() + ' '));
    bottom.appendChild(el('span', null, 'footer.rights'));
    host.textContent = '';
    host.appendChild(wrap); host.appendChild(bottom);
  }

  // Header: Đăng nhập/Đăng ký khi chưa đăng nhập, tên user + Đăng xuất khi đã đăng nhập.
  async function authNav() {
    var boxes = ['auth-nav', 'auth-nav-mobile'].map(function (id) { return document.getElementById(id); }).filter(Boolean);
    if (!boxes.length) return;
    var me = null;
    try { me = await api('/api/auth/me'); } catch (e) { /* khách */ }
    window.App.user = me ? me.user : null;
    boxes.forEach(function (box) {
      box.textContent = '';
      if (!me) {
        box.appendChild(link('/login', 'nav.login', BTN_GHOST));
        box.appendChild(link('/register', 'nav.register', BTN_GRAD));
        return;
      }
      var name = String(me.user.email || '').split('@')[0];
      var span = el('span', 'text-slate-600 font-medium max-w-[10rem] truncate', null, name);
      span.title = me.user.email;
      var b = el('button', BTN_GHOST, 'nav.logout'); b.type = 'button';
      b.addEventListener('click', async function () {
        try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { /* bỏ qua */ }
        location.href = '/';
      });
      box.appendChild(span); box.appendChild(b);
    });
    document.dispatchEvent(new CustomEvent('app:user', { detail: window.App.user }));
  }
  window.App = { errText: errText, copy: copy, api: api, user: null, userReady: null };
  renderHeader(); renderFooter();
  if (window.I18N) window.App.userReady = window.I18N.ready.then(authNav);
})();
