const request = require('supertest');
const { newDb } = require('pg-mem');
const fs = require('fs');
const path = require('path');
const { migrate } = require('../src/db');
const { createApp } = require('../src/app');
const i18n = require('../public/i18n.js');

let pool, app, appAds;
beforeAll(async () => {
  const { Pool } = newDb().adapters.createPg();
  pool = new Pool();
  await migrate(pool);
  app = createApp({ pool, adsEnabled: false });
  appAds = createApp({ pool, adsEnabled: true });
});
afterAll(async () => {
  await app.locals.clicks.stop();
  await appAds.locals.clicks.stop();
});

const loc = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'locales', `${n}.json`), 'utf8'));

describe('pages', () => {
  test.each(['/', '/dashboard'])('%s 200 html', async (p) => {
    const r = await request(app).get(p);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/html/);
    expect(r.text).not.toMatch(/\{\{/);
  });
  test('vi', async () => {
    const r = await request(app).get('/').set('Accept-Language', 'vi-VN,vi;q=0.9,en;q=0.5');
    expect(r.text).toContain('<html lang="vi">');
    expect(r.text).toContain('Tạo link ngắn');
  });
  test('en', async () => {
    const r = await request(app).get('/dashboard').set('Accept-Language', 'en-US');
    expect(r.text).toContain('<html lang="en">');
    expect(r.text).toContain('Original URL');
  });
  test('unknown -> en', async () => {
    const r = await request(app).get('/').set('Accept-Language', 'fr');
    expect(r.text).toContain('<html lang="en">');
  });
  test('cookie beats Accept-Language', async () => {
    const r = await request(app).get('/').set('Cookie', 'lang=vi').set('Accept-Language', 'en');
    expect(r.text).toContain('<html lang="vi">');
  });
  test('ads off/on', async () => {
    expect((await request(app).get('/')).text).not.toContain('data-ad-slot');
    const on = (await request(appAds).get('/dashboard')).text;
    expect(on).toContain('data-ad-slot="top"');
    expect(on).toContain('id="ad-slot-top"');
  });
  test('cookie lang with markup is rejected, not reflected', async () => {
    const r = await request(app).get('/').set('Cookie', 'lang="><script>').set('Accept-Language', 'en-US');
    expect(r.status).toBe(200);
    expect(r.text).toContain('<html lang="en">');
    expect(r.text).not.toContain('"><script>');
    expect(r.text).not.toContain('lang=""');
  });
  test('ad slots present on GET / when ADS_ENABLED on', async () => {
    const on = (await request(appAds).get('/')).text;
    expect(on).toContain('data-ad-slot="top"');
    expect(on).toContain('data-ad-slot="bottom"');
    expect((await request(app).get('/')).text).not.toContain('data-ad-slot');
  });
  test('placeholder translated server-side', async () => {
    const vi = (await request(app).get('/').set('Accept-Language', 'vi')).text;
    expect(vi).toContain(`placeholder="${loc('vi')['create.urlPlaceholder']}"`);
    const en = (await request(app).get('/').set('Accept-Language', 'en')).text;
    expect(en).toContain(`placeholder="${loc('en')['create.urlPlaceholder']}"`);
  });
  test('404 html is localized by Accept-Language', async () => {
    const r = await request(app).get('/no-such-slug-vi').set('Accept', 'text/html').set('Accept-Language', 'vi-VN,vi;q=0.9');
    expect(r.status).toBe(404);
    expect(r.text).toContain('<html lang="vi">');
    expect(r.text).toContain(loc('vi')['notfound.body']);
    expect(r.text).toContain('Không tìm thấy');
  });
  test('404 json unchanged', async () => {
    const r = await request(app).get('/no-such-slug-json').set('Accept', 'application/json').set('Accept-Language', 'vi');
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: 'NOT_FOUND' });
  });
  test('redirect still works and locale served', async () => {
    await request(app).post('/api/links').send({ url: 'https://example.com/x', slug: 'ui-redir' });
    expect((await request(app).get('/ui-redir')).status).toBe(302);
    const r = await request(app).get('/locales/vi.json');
    expect(r.status).toBe(200);
    expect(r.body['create.submit']).toBeDefined();
  });
});

describe('locales', () => {
  const codes = ['INVALID_URL', 'INVALID_SLUG', 'RESERVED_SLUG', 'SLUG_TAKEN', 'INVALID_BODY', 'BODY_TOO_LARGE', 'BAD_REQUEST', 'INVALID_PAGINATION', 'SLUG_GENERATION_FAILED', 'INTERNAL_ERROR', 'NOT_FOUND', 'NETWORK'];
  test('same keys', () => {
    expect(Object.keys(loc('vi')).sort()).toEqual(Object.keys(loc('en')).sort());
  });
  test('error codes present in all languages', () => {
    const langs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'locales', 'index.json'), 'utf8'));
    for (const { code } of langs) for (const c of codes) expect(loc(code)[`error.${c}`]).toBeTruthy();
  });
  test('every data-i18n key used in html exists', () => {
    const keys = Object.keys(loc('en'));
    for (const f of ['index.html', 'dashboard.html', 'login.html', 'register.html']) {
      const html = fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
      for (const m of html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)) expect(keys).toContain(m[1]);
    }
  });
});

describe('homepage F6 (vi/en)', () => {
  const SECTIONS = ['hero', 'form', 'result', 'stats', 'features', 'how', 'faq', 'cta'];
  const FEATURES = ['custom', 'stats', 'qr', 'manage', 'bulk', 'preview'];
  test.each(['vi', 'en'])('%s has all sections, 6 features, 3 steps, >=5 faq, header/footer hooks', async (lang) => {
    const t = (await request(app).get('/').set('Accept-Language', lang)).text;
    expect(t).toContain(`<html lang="${lang}">`);
    for (const id of SECTIONS) expect(t).toContain(`id="${id}"`);
    for (const f of FEATURES) {
      expect(t).toContain(`data-feature="${f}"`);
      expect(t).toContain(loc(lang)[`features.${f}.title`]);
    }
    expect(t.match(/data-faq/g).length).toBeGreaterThanOrEqual(5);
    for (const i of [1, 2, 3]) expect(t).toContain(loc(lang)[`how.step${i}.title`]);
    expect(t).toContain('id="site-header"');
    expect(t).toContain('id="site-footer"');
    expect(t).toContain('id="stat-links"');
    expect(t).toContain('id="advanced"');
    expect(t).toContain('id="qr-download"');
    expect(t).toContain(loc(lang)['hero.subtitle']);
    expect(t).toContain(loc(lang)['cta.title']);
  });
  test('login/register pages localized with password toggle', async () => {
    for (const p of ['/login', '/register']) {
      for (const lang of ['vi', 'en']) {
        const t = (await request(app).get(p).set('Accept-Language', lang)).text;
        expect(t).toContain('id="toggle-pw"');
        expect(t).toContain(loc(lang)[p === '/login' ? 'auth.login.heading' : 'auth.register.heading']);
      }
    }
  });
  test('all keys used in html/js exist in both locales', () => {
    const vi = loc('vi'), en = loc('en');
    const dir = path.join(__dirname, '..', 'public');
    for (const f of ['index.html', 'login.html', 'register.html', 'dashboard.html', 'layout.js']) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      const keys = [...src.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)].map((m) => m[1]);
      keys.push(...[...src.matchAll(/I18N\.t\('([^']+)'\)/g)].map((m) => m[1]));
      keys.push(...[...src.matchAll(/(?:^|[ (,])el\('[a-z0-9]+', [^,]+, '([a-z][A-Za-z0-9.]+)'/g)].map((m) => m[1]));
      for (const k of keys) { expect(vi[k]).toBeDefined(); expect(en[k]).toBeDefined(); }
    }
  });
  test('no empty translations; vi and en key sets identical', () => {
    const vi = loc('vi'), en = loc('en');
    expect(Object.keys(vi).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(vi)) { expect(String(vi[k]).length).toBeGreaterThan(0); expect(String(en[k]).length).toBeGreaterThan(0); }
  });
  test('ads slots still hidden/shown on new homepage', async () => {
    expect((await request(app).get('/')).text).not.toContain('data-ad-slot');
    expect((await request(appAds).get('/')).text).toContain('data-ad-slot="bottom"');
  });
});

describe('GET /api/stats/public', () => {
  test('returns totals and is cached', async () => {
    const a = await request(app).get('/api/stats/public');
    expect(a.status).toBe(200);
    expect(a.body.totalLinks).toBeGreaterThanOrEqual(1);
    expect(typeof a.body.totalClicks).toBe('number');
    expect(a.headers['cache-control']).toMatch(/max-age=60/);
    await request(app).post('/api/links').send({ url: 'https://example.com/cache-check' });
    const b = await request(app).get('/api/stats/public');
    expect(b.body).toEqual(a.body); // vẫn trong 60s
  });
  test('cache expires after ttl', async () => {
    const express = require('express');
    const { statsRouter } = require('../src/routes/stats');
    let t = 1000;
    const mini = express();
    mini.locals.pool = pool;
    mini.use('/s', statsRouter(express, { ttlMs: 60000, now: () => t }));
    const a = await request(mini).get('/s/public');
    await request(app).post('/api/links').send({ url: 'https://example.com/ttl-check' });
    expect((await request(mini).get('/s/public')).body).toEqual(a.body);
    t += 60001;
    expect((await request(mini).get('/s/public')).body.totalLinks).toBe(a.body.totalLinks + 1);
  });
});

describe('qr.js', () => {
  const QR = require('../public/qr.js');
  test('matrix is square with finder patterns', () => {
    const m = QR.matrix('https://example.com/abc');
    expect(m.length).toBeGreaterThanOrEqual(21);
    for (const row of m) expect(row.length).toBe(m.length);
    const n = m.length;
    for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      expect(m[r][c]).toBe(true); expect(m[r + 3][c + 3]).toBe(true); expect(m[r + 1][c + 1]).toBe(false);
    }
  });
  test('different text gives different matrix', () => {
    expect(JSON.stringify(QR.matrix('https://a.io/1'))).not.toBe(JSON.stringify(QR.matrix('https://a.io/2')));
  });
});

describe('client pickLang', () => {
  const sup = ['vi', 'en'];
  test('order', () => {
    expect(i18n.pickLang('vi', ['en'], sup)).toBe('vi');
    expect(i18n.pickLang('', ['fr-FR', 'vi-VN'], sup)).toBe('vi');
    expect(i18n.pickLang('xx', ['fr'], sup)).toBe('en');
    expect(i18n.pickLang(null, [], sup)).toBe('en');
  });
});
