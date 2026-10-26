const fs = require('fs');
const path = require('path');

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

// Trang 404 HTML, dịch theo pickLang(req) (cookie -> Accept-Language -> en).
function renderNotFound(lang) {
  const dict = DICTS[lang] || DICTS.en;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(dict['notfound.title'])}</title></head><body><h1>404</h1><p>${esc(dict['notfound.body'])}</p><p><a href="/">${esc(dict['notfound.home'])}</a></p></body></html>`;
}

function renderGone(lang) {
  const dict = DICTS[lang] || DICTS.en;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>${esc(dict['gone.title'])}</title></head><body><h1>410</h1><p>${esc(dict['gone.body'])}</p><p><a href="/">${esc(dict['notfound.home'])}</a></p></body></html>`;
}

// Trang xem trước: hiển thị URL đích (đã escape) và nút tiếp tục qua /:slug (để áp dụng kiểm tra + đếm click).
function renderPreview(lang, slug, url) {
  const dict = DICTS[lang] || DICTS.en;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${esc(dict['preview.title'])}</title></head><body><h1>${esc(dict['preview.heading'])}</h1><p>${esc(dict['preview.destination'])}</p><p><code>${esc(url)}</code></p><p>${esc(dict['preview.warning'])}</p><p><a href="/${encodeURIComponent(slug)}" rel="nofollow noopener">${esc(dict['preview.continue'])}</a> <a href="/">${esc(dict['notfound.home'])}</a></p></body></html>`;
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
  router.get(['/login', '/login.html'], send('login.html'));
  router.get(['/register', '/register.html'], send('register.html'));
  return router;
}

module.exports = { pagesRouter, pickLang, renderPage, renderNotFound, renderGone, renderPreview, SUPPORTED };
