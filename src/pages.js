const fs = require('fs');
const path = require('path');
const { loadUser } = require('./auth');
const { SLUG_RE, getLink } = require('./links');

const PUBLIC = path.join(__dirname, '..', 'public');
const SUPPORTED = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'locales', 'index.json'), 'utf8')).map((l) => l.code);
const DICTS = {};
for (const code of SUPPORTED) {
  DICTS[code] = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'locales', `${code}.json`), 'utf8'));
}
const TEMPLATES = {};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function parseCookie(header, name) {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(header || '');
  if (!m) return '';
  try { return decodeURIComponent(m[1]); } catch { return ''; }
}

const norm = (t) => String(t || '').trim().toLowerCase().split(/[-_]/)[0];

// Cookie `lang` trước, rồi Accept-Language (theo q), cuối cùng en.
function pickLang(req) {
  const c = norm(parseCookie(req.headers.cookie, 'lang'));
  if (SUPPORTED.includes(c)) return c;
  const items = String(req.headers['accept-language'] || '')
    .split(',')
    .map((p, i) => {
      const [tag, ...params] = p.trim().split(';');
      const q = params.map((x) => /^\s*q=([\d.]+)/.exec(x)).find(Boolean);
      return { code: norm(tag), q: q ? Number(q[1]) : 1, i };
    })
    .filter((x) => x.code && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const it of items) if (SUPPORTED.includes(it.code)) return it.code;
  return 'en';
}

function adSlot(name) {
  return `<div id="ad-slot-${name}" data-ad-slot="${name}" class="max-w-4xl mx-auto px-4 my-2"></div>`;
}

// Gắn thuộc tính placeholder đã dịch vào thẻ có data-i18n-placeholder.
function setPlaceholder(tag, value) {
  const base = tag.replace(/\splaceholder="[^"]*"/i, '');
  return base.replace(/(\s*\/?>)$/, ` placeholder="${esc(value)}"$1`);
}

function renderPage(file, lang, adsEnabled) {
  if (!TEMPLATES[file]) TEMPLATES[file] = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
  const dict = DICTS[lang] || DICTS.en;
  const has = (key) => Object.prototype.hasOwnProperty.call(dict, key);
  return TEMPLATES[file]
    .replace(/(<[a-z0-9]+\b[^>]*\bdata-i18n="([^"]+)"[^>]*>)[^<]*/gi, (m, tag, key) =>
      has(key) ? tag + esc(dict[key]) : m)
    .replace(/<[a-z0-9]+\b[^>]*\bdata-i18n-placeholder="([^"]+)"[^>]*>/gi, (tag, key) =>
      has(key) ? setPlaceholder(tag, dict[key]) : tag)
    .replace('{{LANG}}', lang)
    .replace('{{AD_TOP}}', adsEnabled ? adSlot('top') : '')
    .replace('{{AD_BOTTOM}}', adsEnabled ? adSlot('bottom') : '');
}

// Khung chung cho trang lỗi/xem trước: nền gradient, card, header/footer dùng layout.js.
function shell(lang, { title, robots, referrer, code, heading, body, actions }) {
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${robots ? '<meta name="robots" content="noindex">' : ''}${referrer ? '<meta name="referrer" content="no-referrer">' : ''}<title data-i18n="${title.key}">${esc(title.text)}</title><script src="https://cdn.tailwindcss.com"></script>`;
  return `<!doctype html><html lang="${lang}"><head>${head}</head>`
    + '<body class="bg-slate-50 text-slate-800 min-h-screen flex flex-col"><div id="site-header"></div>'
    + '<main class="flex-1 relative overflow-hidden bg-gradient-to-br from-indigo-600 via-violet-600 to-cyan-500 flex items-center justify-center px-4 py-12">'
    + '<div class="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-pink-500/30 blur-3xl"></div>'
    + '<div class="absolute -bottom-32 -left-24 w-96 h-96 rounded-full bg-orange-400/30 blur-3xl"></div>'
    + `<section class="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl p-6 sm:p-8 text-center"><p class="text-6xl font-extrabold bg-gradient-to-r from-indigo-600 via-violet-600 to-cyan-500 bg-clip-text text-transparent">${esc(code)}</p>`
    + `${heading}${body}<div class="mt-6 flex flex-wrap justify-center gap-3">${actions}</div></section></main><div id="site-footer"></div>`
    + '<script src="/i18n.js"></script><script src="/layout.js"></script></body></html>';
}
const BTN_PRIMARY = 'px-5 py-3 rounded-2xl font-bold text-white bg-gradient-to-r from-indigo-600 via-violet-600 to-cyan-500 shadow-lg shadow-indigo-200 hover:opacity-90 transition';
const BTN_SECOND = 'px-5 py-3 rounded-2xl font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition';
const homeLink = (dict) => `<a href="/" class="${BTN_PRIMARY}" data-i18n="notfound.home">${esc(dict['notfound.home'])}</a>`;

// Trang 404 HTML, dịch theo pickLang(req) (cookie -> Accept-Language -> en).
function renderNotFound(lang) {
  const dict = DICTS[lang] || DICTS.en;
  return shell(lang, {
    title: { key: 'notfound.title', text: dict['notfound.title'] }, code: '404',
    heading: '',
    body: `<p class="mt-3 text-slate-600" data-i18n="notfound.body">${esc(dict['notfound.body'])}</p>`,
    actions: homeLink(dict),
  });
}

function renderGone(lang) {
  const dict = DICTS[lang] || DICTS.en;
  return shell(lang, {
    title: { key: 'gone.title', text: dict['gone.title'] }, robots: true, code: '410',
    heading: '',
    body: `<p class="mt-3 text-slate-600" data-i18n="gone.body">${esc(dict['gone.body'])}</p>`,
    actions: homeLink(dict),
  });
}

// Trang xem trước: hiển thị URL đích (đã escape) và nút tiếp tục qua /:slug (để áp dụng kiểm tra + đếm click).
function renderPreview(lang, slug, url) {
  const dict = DICTS[lang] || DICTS.en;
  return shell(lang, {
    title: { key: 'preview.title', text: dict['preview.title'] }, robots: true, referrer: true, code: '\u2197',
    heading: `<h1 class="mt-2 text-2xl font-extrabold" data-i18n="preview.heading">${esc(dict['preview.heading'])}</h1>`,
    body: `<p class="mt-3 text-sm text-slate-500" data-i18n="preview.destination">${esc(dict['preview.destination'])}</p>`
      + `<p class="mt-2 p-3 rounded-2xl bg-slate-100 text-left break-all"><code>${esc(url)}</code></p>`
      + `<p class="mt-3 text-sm text-amber-700 bg-amber-50 rounded-2xl p-3" data-i18n="preview.warning">${esc(dict['preview.warning'])}</p>`,
    actions: `<a href="/${encodeURIComponent(slug)}" rel="nofollow noopener" class="${BTN_PRIMARY}" data-i18n="preview.continue">${esc(dict['preview.continue'])}</a>`
      + `<a href="/" class="${BTN_SECOND}" data-i18n="notfound.home">${esc(dict['notfound.home'])}</a>`,
  });
}

function pagesRouter(express, adsOption) {
  const router = express.Router();
  const ads = () => (adsOption !== undefined ? !!adsOption : String(process.env.ADS_ENABLED).toLowerCase() === 'true');
  const send = (file) => (req, res) => {
    res.set('Vary', 'Accept-Language, Cookie');
    res.type('html').send(renderPage(file, pickLang(req), ads()));
  };
  router.get(['/', '/index.html'], send('index.html'));
  router.get(['/dashboard', '/dashboard.html'], send('dashboard.html'));
  // Chi tiết link: chỉ chủ link. Chưa đăng nhập -> /login; link không có/không phải của mình -> 404.
  router.get('/dashboard/links/:slug', async (req, res, next) => {
    try {
      res.set('Vary', 'Accept-Language, Cookie');
      res.set('Cache-Control', 'no-store');
      const lang = pickLang(req);
      await loadUser(req.app.locals.pool)(req, res, () => {});
      if (!req.user) return res.redirect(302, '/login');
      const { slug } = req.params;
      const link = SLUG_RE.test(slug) ? await getLink(req.app.locals.pool, slug) : null;
      if (!link || link.userId == null || String(link.userId) !== String(req.user.id)) {
        return res.status(404).type('html').send(renderNotFound(lang));
      }
      res.type('html').send(renderPage('link.html', lang, ads()));
    } catch (e) { next(e); }
  });
  router.get(['/login', '/login.html'], send('login.html'));
  router.get(['/register', '/register.html'], send('register.html'));
  return router;
}

module.exports = { pagesRouter, pickLang, renderPage, renderNotFound, renderGone, renderPreview, SUPPORTED };
