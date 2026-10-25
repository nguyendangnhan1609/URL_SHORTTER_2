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

function renderPage(file, lang, adsEnabled) {
  if (!TEMPLATES[file]) TEMPLATES[file] = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
  const dict = DICTS[lang] || DICTS.en;
  return TEMPLATES[file]
    .replace(/(<[a-z0-9]+\b[^>]*\bdata-i18n="([^"]+)"[^>]*>)[^<]*/gi, (m, tag, key) =>
      Object.prototype.hasOwnProperty.call(dict, key) ? tag + esc(dict[key]) : m)
    .replace('{{LANG}}', lang)
    .replace('{{AD_TOP}}', adsEnabled ? adSlot('top') : '')
    .replace('{{AD_BOTTOM}}', adsEnabled ? adSlot('bottom') : '');
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
  return router;
}

module.exports = { pagesRouter, pickLang, renderPage, SUPPORTED };
