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

describe('client pickLang', () => {
  const sup = ['vi', 'en'];
  test('order', () => {
    expect(i18n.pickLang('vi', ['en'], sup)).toBe('vi');
    expect(i18n.pickLang('', ['fr-FR', 'vi-VN'], sup)).toBe('vi');
    expect(i18n.pickLang('xx', ['fr'], sup)).toBe('en');
    expect(i18n.pickLang(null, [], sup)).toBe('en');
  });
});
