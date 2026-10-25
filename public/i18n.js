/* i18n thuần: chọn ngôn ngữ, nạp bản dịch, gắn vào phần tử data-i18n. */
(function (root) {
  var FALLBACK = 'en';

  function normalize(tag) {
    return String(tag || '').toLowerCase().split(/[-_]/)[0];
  }

  // Thứ tự: đã lưu (localStorage/cookie) -> navigator.languages -> en.
  function pickLang(stored, languages, supported) {
    var s = normalize(stored);
    if (s && supported.indexOf(s) !== -1) return s;
    var list = languages || [];
    for (var i = 0; i < list.length; i++) {
      var l = normalize(list[i]);
      if (l && supported.indexOf(l) !== -1) return l;
    }
    return FALLBACK;
  }

  var api = { pickLang: pickLang, normalize: normalize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root || !root.document) return;

  var doc = root.document;
  var dict = {};
  var lang = FALLBACK;
  var listeners = [];

  function readCookie() {
    var m = doc.cookie.match(/(?:^|;\s*)lang=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }
  function readStored() {
    try { return root.localStorage.getItem('lang') || readCookie(); } catch (e) { return readCookie(); }
  }
  function store(code) {
    try { root.localStorage.setItem('lang', code); } catch (e) { /* bỏ qua */ }
    doc.cookie = 'lang=' + code + '; path=/; max-age=31536000; SameSite=Lax';
  }

  function t(key, params) {
    var s = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key;
    if (params) for (var k in params) s = s.split('{' + k + '}').join(params[k]);
    return s;
  }

  function apply() {
    doc.documentElement.lang = lang;
    doc.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    doc.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    listeners.forEach(function (fn) { fn(lang); });
  }

  function load(code) {
    return root.fetch('/locales/' + code + '.json').then(function (r) { return r.json(); }).then(function (d) {
      dict = d; lang = code; apply();
    });
  }

  function renderSwitcher(langs) {
    var sel = doc.getElementById('lang-select');
    if (!sel) return;
    sel.innerHTML = '';
    langs.forEach(function (l) {
      var o = doc.createElement('option');
      o.value = l.code; o.textContent = l.name;
      sel.appendChild(o);
    });
    sel.value = lang;
    sel.addEventListener('change', function () { store(sel.value); load(sel.value); });
  }

  var ready = root.fetch('/locales/index.json').then(function (r) { return r.json(); }).then(function (langs) {
    var codes = langs.map(function (l) { return l.code; });
    var code = pickLang(readStored(), root.navigator.languages || [root.navigator.language], codes);
    return load(code).then(function () { renderSwitcher(langs); });
  }).catch(function () { /* giữ nguyên văn bản mặc định do server render */ });

  root.I18N = {
    t: t,
    ready: ready,
    getLang: function () { return lang; },
    onChange: function (fn) { listeners.push(fn); },
    pickLang: pickLang
  };
})(typeof window !== 'undefined' ? window : this);
