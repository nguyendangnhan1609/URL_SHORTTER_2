const request = require('supertest');
const { newDb } = require('pg-mem');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { migrate } = require('../src/db');
const { createApp } = require('../src/app');

const H = { 'X-Requested-With': 'test' };
const PUB = path.join(__dirname, '..', 'public');
const loc = (n) => JSON.parse(fs.readFileSync(path.join(PUB, 'locales', `${n}.json`), 'utf8'));
let pool, app, A, B;

async function login(email) {
  const ag = request.agent(app);
  await ag.post('/api/auth/register').set(H).send({ email, password: 'password123' }).expect(201);
  return ag;
}

beforeAll(async () => {
  const { Pool } = newDb().adapters.createPg();
  pool = new Pool();
  await migrate(pool);
  app = createApp({ pool, adsEnabled: false });
  A = await login('t9a@example.com');
  B = await login('t9b@example.com');
  await A.post('/api/links').set(H).send({ url: 'https://example.com/a', slug: 'mine-1', title: '<script>alert(1)</script>' }).expect(201);
  await request(app).post('/api/links').set(H).send({ url: 'https://example.com/guest', slug: 'guest-1' }).expect(201);
});
afterAll(async () => {
  await app.locals.clicks.stop();
  await pool.end();
});

describe('GET /dashboard/links/:slug', () => {
  test('not logged in -> redirect to /login', async () => {
    const r = await request(app).get('/dashboard/links/mine-1');
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe('/login');
  });
  test.each(['vi', 'en'])('owner -> 200 with all sections (%s)', async (lang) => {
    const r = await A.get('/dashboard/links/mine-1').set('Accept-Language', lang);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/html/);
    expect(r.text).not.toMatch(/\{\{/);
    expect(r.text).toContain(`<html lang="${lang}">`);
    for (const id of ['site-header', 'site-footer', 'info', 'qr-card', 'totals', 'chart-card', 'bars-ref', 'bars-dev', 'bars-br']) {
      expect(r.text).toContain(`id="${id}"`);
    }
    for (const k of ['detail.title', 'detail.info', 'detail.total', 'detail.last7', 'detail.chart', 'detail.referrers', 'detail.devices', 'detail.browsers']) {
      expect(r.text).toContain(loc(lang)[k]);
    }
    // thông tin link do client nạp qua API, không nhúng dữ liệu người dùng vào HTML
    expect(r.text).not.toContain('<script>alert(1)</script>');
  });
  test('another user -> 404 html', async () => {
    const r = await B.get('/dashboard/links/mine-1').set('Accept-Language', 'en');
    expect(r.status).toBe(404);
    expect(r.text).toContain(loc('en')['notfound.body']);
  });
  test('missing, invalid and guest links -> 404', async () => {
    for (const s of ['nope-123', 'guest-1', 'a%20b', 'x']) expect((await A.get(`/dashboard/links/${s}`)).status).toBe(404);
  });
  test('owner can fetch data the page needs', async () => {
    const info = await A.get('/api/links/mine-1').expect(200);
    expect(info.body.shortUrl).toMatch(/\/mine-1$/);
    expect(info.body.status).toBe('active');
    const st = await A.get('/api/links/mine-1/stats').expect(200);
    expect(st.body.byDay).toHaveLength(30);
    await B.get('/api/links/mine-1/stats').expect(404);
  });
  test('list returns summary of own links', async () => {
    const r = await A.get('/api/links').expect(200);
    expect(r.body.summary).toEqual({ totalLinks: 1, totalClicks: 0 });
  });
});

describe('dashboard page', () => {
  test.each(['vi', 'en'])('has main sections (%s)', async (lang) => {
    const r = await request(app).get('/dashboard').set('Accept-Language', lang);
    expect(r.status).toBe(200);
    for (const s of ['id="site-header"', 'id="site-footer"', 'id="q"', 'id="status"', 'id="rows"', 'id="sum-links"', 'id="sum-clicks"', 'id="bulk-open"', 'id="prev"', 'id="next"']) {
      expect(r.text).toContain(s);
    }
    for (const k of ['dashboard.totalLinks', 'dashboard.totalClicks', 'bulk.open', 'status.active', 'status.disabled', 'status.expired']) {
      expect(r.text).toContain(loc(lang)[k]);
    }
  });
});

describe('error and preview pages share the new style', () => {
  beforeAll(async () => {
    await A.patch('/api/links/mine-1').set(H).send({ isActive: false }).expect(200);
    await A.post('/api/links').set(H).send({ url: 'https://example.com/p?x=%3Cscript%3E&y="><b>', slug: 'prev-1' }).expect(201);
  });
  test.each(['vi', 'en'])('404 (%s)', async (lang) => {
    const r = await request(app).get('/zzz-none').set('Accept', 'text/html').set('Accept-Language', lang);
    expect(r.status).toBe(404);
    expect(r.text).toContain(loc(lang)['notfound.body']);
    expect(r.text).toContain('id="site-header"');
    expect(r.text).toContain('bg-gradient-to-br');
    expect(r.text).toContain(`<html lang="${lang}">`);
  });
  test.each(['vi', 'en'])('410 (%s)', async (lang) => {
    const r = await request(app).get('/mine-1').set('Accept', 'text/html').set('Accept-Language', lang);
    expect(r.status).toBe(410);
    expect(r.text).toContain(loc(lang)['gone.body']);
    expect(r.text).toContain('id="site-footer"');
    expect(r.text).toContain('noindex');
  });
  test.each(['vi', 'en'])('preview (%s) escapes URL and keeps status', async (lang) => {
    const r = await request(app).get('/preview/prev-1').set('Accept', 'text/html').set('Accept-Language', lang);
    expect(r.status).toBe(200);
    expect(r.text).toContain(loc(lang)['preview.heading']);
    expect(r.text).toContain('id="site-header"');
    expect(r.text).toContain('href="/prev-1"');
    expect(r.text).not.toContain('"><b>');
    expect(r.text).not.toContain('<script>alert');
    expect(r.headers['cache-control']).toBe('no-store');
  });
  test('gone / preview of disabled link', async () => {
    expect((await request(app).get('/preview/mine-1').set('Accept', 'text/html')).status).toBe(410);
    expect((await request(app).get('/preview/none-xx').set('Accept', 'text/html')).status).toBe(404);
  });
});

describe('XSS hygiene on the client', () => {
  test('client code never writes HTML from data', () => {
    for (const f of ['dashboard.html', 'link.html', 'linkui.js', 'layout.js']) {
      const src = fs.readFileSync(path.join(PUB, f), 'utf8');
      expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
    }
  });
  test('title with <script> is stored verbatim as JSON (rendered only via textContent)', async () => {
    const r = await A.get('/api/links/mine-1').expect(200);
    expect(r.body.title).toBe('<script>alert(1)</script>');
    expect(r.headers['content-type']).toMatch(/application\/json/);
  });
  test('LinkUI keys exist in both locales', () => {
    const src = fs.readFileSync(path.join(PUB, 'linkui.js'), 'utf8') + fs.readFileSync(path.join(PUB, 'link.html'), 'utf8');
    const keys = [...src.matchAll(/(?:i18nEl\('[a-z0-9]+', [^,]+, |b\()'([a-z][A-Za-z0-9.-]+)'(?! \+)/g)].map((m) => m[1]);
    keys.push(...[...src.matchAll(/(?:titleKey|modal\()'([a-z][A-Za-z0-9.]+)'/g)].map((m) => m[1]));
    keys.push(...[...src.matchAll(/(?:row\(dl, |I18N\.t\()'([a-z][A-Za-z0-9.]+)'/g)].map((m) => m[1]));
    expect(keys.length).toBeGreaterThan(10);
    for (const k of keys) { expect(loc('vi')[k]).toBeDefined(); expect(loc('en')[k]).toBeDefined(); }
    for (const k of ['status.active', 'status.disabled', 'status.expired', 'device.desktop', 'device.mobile', 'device.tablet', 'device.bot-unknown', 'browser.other']) {
      expect(loc('vi')[k]).toBeDefined(); expect(loc('en')[k]).toBeDefined();
    }
  });
  test('every API error code has a translation', () => {
    const codes = new Set();
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else for (const m of fs.readFileSync(p, 'utf8').matchAll(/AppError\('([A-Z_]+)'/g)) codes.add(m[1]);
    });
    walk(path.join(__dirname, '..', 'src'));
    for (const c of codes) { expect(loc('vi')[`error.${c}`]).toBeDefined(); expect(loc('en')[`error.${c}`]).toBeDefined(); }
  });
  test('qrSvg produces a valid standalone SVG', () => {
    const win = { QR: require('../public/qr.js') };
    vm.runInNewContext(fs.readFileSync(path.join(PUB, 'linkui.js'), 'utf8'), { window: win, document: {} });
    const svg = win.LinkUI.qrSvg('https://example.com/abc');
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"/);
    expect(svg).toContain('<path d="M');
    expect(svg.endsWith('</svg>')).toBe(true);
  });
});
