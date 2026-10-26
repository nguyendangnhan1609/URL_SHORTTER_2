const request = require('supertest');
const { newDb } = require('pg-mem');
const { migrate } = require('../src/db');
const { createApp } = require('../src/app');
const { parseUserAgent, parseReferrerHost } = require('../src/ua');

const H = { 'X-Requested-With': 'test' };
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
let pool, app, A, B;

async function login(email) {
  const ag = request.agent(app);
  await ag.post('/api/auth/register').set(H).send({ email, password: 'password123' }).expect(201);
  return ag;
}
const mk = (ag, body) => ag.post('/api/links').set(H).send(body);

beforeAll(async () => {
  const { Pool } = newDb().adapters.createPg();
  pool = new Pool();
  await migrate(pool);
  app = createApp({ pool });
  A = await login('sa@example.com');
  B = await login('sb@example.com');
});
afterAll(async () => {
  await app.locals.clicks.stop();
  await pool.end();
});

describe('user agent / referrer parsing', () => {
  test('devices and browsers', () => {
    expect(parseUserAgent(CHROME)).toEqual({ device: 'desktop', browser: 'chrome' });
    expect(parseUserAgent(IPHONE)).toEqual({ device: 'mobile', browser: 'safari' });
    expect(parseUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0) AppleWebKit/605 Version/17 Safari/604')).toEqual({ device: 'tablet', browser: 'safari' });
    expect(parseUserAgent('Mozilla/5.0 (Android 13; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0')).toEqual({ device: 'mobile', browser: 'firefox' });
    expect(parseUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537 Edg/120')).toEqual({ device: 'desktop', browser: 'edge' });
    expect(parseUserAgent('Googlebot/2.1').device).toBe('bot-unknown');
    expect(parseUserAgent(undefined).device).toBe('bot-unknown');
  });
  test('referrer hostname only', () => {
    expect(parseReferrerHost('https://News.Example.com/a/b?q=1#x')).toBe('news.example.com');
    expect(parseReferrerHost('')).toBe('direct');
    expect(parseReferrerHost(undefined)).toBe('direct');
    expect(parseReferrerHost('not a url')).toBe('direct');
    expect(parseReferrerHost('javascript:alert(1)')).toBe('direct');
  });
});

describe('GET /api/links/:slug/stats', () => {
  test('stats aggregate N simulated clicks; ignores HEAD/prefetch', async () => {
    await mk(A, { url: 'https://example.com/s', slug: 'stat-1' }).expect(201);
    const hit = (ua, ref) => {
      const r = request(app).get('/stat-1').set('User-Agent', ua);
      return (ref ? r.set('Referer', ref) : r).expect(302);
    };
    for (let i = 0; i < 3; i++) await hit(CHROME, 'https://twitter.com/post/1');
    for (let i = 0; i < 2; i++) await hit(IPHONE, 'https://facebook.com/');
    await hit(CHROME);
    await request(app).head('/stat-1').set('User-Agent', CHROME).expect(302);
    await request(app).get('/stat-1').set('Purpose', 'prefetch').expect(302);
    const r = await A.get('/api/links/stat-1/stats').expect(200);
    const today = new Date().toISOString().slice(0, 10);
    expect(r.body.total).toBe(6);
    expect(r.body.last7days).toBe(6);
    expect(r.body.byDay).toHaveLength(30);
    expect(r.body.byDay[29]).toEqual({ date: today, count: 6 });
    expect(r.body.byDay.slice(0, 29).every((d) => d.count === 0)).toBe(true);
    expect(r.body.byReferrer).toEqual([
      { referrer: 'twitter.com', count: 3 },
      { referrer: 'facebook.com', count: 2 },
      { referrer: 'direct', count: 1 },
    ]);
    expect(r.body.byDevice).toEqual([{ device: 'desktop', count: 4 }, { device: 'mobile', count: 2 }]);
    expect(r.body.byBrowser).toEqual([{ browser: 'chrome', count: 4 }, { browser: 'safari', count: 2 }]);
  });

  test('byDay buckets older clicks; last7days excludes older than 7 days; no IP stored', async () => {
    await mk(A, { url: 'https://example.com/s', slug: 'stat-2' }).expect(201);
    const id = (await pool.query("SELECT id FROM links WHERE slug='stat-2'")).rows[0].id;
    const ago = (d) => new Date(Date.now() - d * 86400e3);
    for (const d of [0, 2, 2, 10, 40]) {
      await pool.query("INSERT INTO link_clicks (link_id, clicked_at, referrer_host, device, browser) VALUES ($1,$2,'direct','desktop','chrome')", [id, ago(d)]);
    }
    const r = await A.get('/api/links/stat-2/stats').expect(200);
    expect(r.body.byDay.reduce((a, d) => a + d.count, 0)).toBe(4); // 40 ngày trước nằm ngoài cửa sổ 30 ngày
    expect(r.body.last7days).toBe(3);
    const key = (d) => ago(d).toISOString().slice(0, 10);
    expect(r.body.byDay.find((x) => x.date === key(2)).count).toBe(2);
    expect(r.body.byDay.find((x) => x.date === key(10)).count).toBe(1);
    const cols = (await pool.query("SELECT * FROM link_clicks WHERE link_id=$1 LIMIT 1", [id])).fields.map((f) => f.name);
    expect(cols.join(',')).not.toMatch(/ip|agent/);
  });

  test('byReferrer limited to top 10', async () => {
    await mk(A, { url: 'https://example.com/s', slug: 'stat-3' }).expect(201);
    const id = (await pool.query("SELECT id FROM links WHERE slug='stat-3'")).rows[0].id;
    for (let i = 0; i < 12; i++) {
      await pool.query("INSERT INTO link_clicks (link_id, referrer_host, device, browser) VALUES ($1,$2,'desktop','other')", [id, `h${i}.com`]);
    }
    const r = await A.get('/api/links/stat-3/stats').expect(200);
    expect(r.body.byReferrer).toHaveLength(10);
  });

  test('empty link -> zeros; access control', async () => {
    await mk(A, { url: 'https://example.com/s', slug: 'stat-4' }).expect(201);
    const r = await A.get('/api/links/stat-4/stats').expect(200);
    expect(r.body).toMatchObject({ total: 0, last7days: 0, byReferrer: [], byDevice: [], byBrowser: [] });
    expect(r.body.byDay).toHaveLength(30);
    await B.get('/api/links/stat-4/stats').expect(404);
    await request(app).get('/api/links/stat-4/stats').expect(401);
    await A.get('/api/links/nope-nope/stats').expect(404);
    await request(app).post('/api/links').set(H).send({ url: 'https://example.com/g', slug: 'stat-guest' }).expect(201);
    await A.get('/api/links/stat-guest/stats').expect(404);
  });

  test('deleting the link cascades link_clicks', async () => {
    await mk(A, { url: 'https://example.com/s', slug: 'stat-5' }).expect(201);
    await request(app).get('/stat-5').set('User-Agent', CHROME).expect(302);
    await app.locals.clicks.flush();
    const id = (await pool.query("SELECT id FROM links WHERE slug='stat-5'")).rows[0].id;
    expect(Number((await pool.query('SELECT COUNT(*) c FROM link_clicks WHERE link_id=$1', [id])).rows[0].c)).toBe(1);
    await A.delete('/api/links/stat-5').set(H).expect(204);
    expect(Number((await pool.query('SELECT COUNT(*) c FROM link_clicks WHERE link_id=$1', [id])).rows[0].c)).toBe(0);
  });

  test('limited link: details recorded too', async () => {
    await mk(A, { url: 'https://example.com/s', slug: 'stat-6', maxClicks: 5 }).expect(201);
    await request(app).get('/stat-6').set('User-Agent', IPHONE).expect(302);
    const r = await A.get('/api/links/stat-6/stats').expect(200);
    expect(r.body.byDevice).toEqual([{ device: 'mobile', count: 1 }]);
  });
});

describe('max_clicks is atomic under concurrency', () => {
  test('30 parallel requests on maxClicks=5 -> exactly 5 redirects, rest 410, clicks=5', async () => {
    await mk(A, { url: 'https://example.com/m', slug: 'race-1', maxClicks: 5 }).expect(201);
    const rs = await Promise.all(Array.from({ length: 30 }, () => request(app).get('/race-1')));
    expect(rs.filter((r) => r.status === 302)).toHaveLength(5);
    expect(rs.filter((r) => r.status === 410)).toHaveLength(25);
    await app.locals.clicks.flush();
    const row = (await pool.query("SELECT clicks FROM links WHERE slug='race-1'")).rows[0];
    expect(Number(row.clicks)).toBe(5);
  });
});

describe('POST /api/links/bulk', () => {
  test('per-row results; bad rows do not break others', async () => {
    const r = await A.post('/api/links/bulk').set(H).send({
      urls: ['https://example.com/1', 'ftp://bad', 'https://example.com/3', 42, 'https://www.sho.rt./x'],
    }).set('Host', 'sho.rt').expect(200);
    expect(r.body.created).toBe(2);
    expect(r.body.failed).toBe(3);
    const [a, b, c, d, e] = r.body.results;
    expect(a).toMatchObject({ index: 0, ok: true });
    expect(a.link.slug).toMatch(/^[A-Za-z0-9]{7}$/);
    expect(a.link.shortUrl).toContain(`/${a.link.slug}`);
    expect(b).toEqual({ index: 1, ok: false, error: 'INVALID_URL' });
    expect(c.ok).toBe(true);
    expect(d).toEqual({ index: 3, ok: false, error: 'INVALID_URL' });
    expect(e).toEqual({ index: 4, ok: false, error: 'SELF_REFERENCE' });
    const owned = await A.get('/api/links?pageSize=100').expect(200);
    expect(owned.body.items.some((l) => l.slug === a.link.slug)).toBe(true);
    await request(app).get(`/${a.link.slug}`).expect(302);
  });

  test('limits, auth, csrf', async () => {
    const many = Array.from({ length: 51 }, (_, i) => `https://example.com/${i}`);
    await A.post('/api/links/bulk').set(H).send({ urls: many }).expect(400).expect({ error: 'BULK_TOO_MANY' });
    const fifty = await A.post('/api/links/bulk').set(H).send({ urls: many.slice(0, 50).map((u) => u + '/' + 'a'.repeat(1900)) }).expect(200);
    expect(fifty.body.created).toBe(50);
    await A.post('/api/links/bulk').set(H).send({ urls: [] }).expect(400).expect({ error: 'INVALID_BODY' });
    await A.post('/api/links/bulk').set(H).send({ urls: 'x' }).expect(400).expect({ error: 'INVALID_BODY' });
    await A.post('/api/links/bulk').set(H).send({}).expect(400);
    await request(app).post('/api/links/bulk').set(H).send({ urls: ['https://example.com/'] }).expect(401);
    await A.post('/api/links/bulk').send({ urls: ['https://example.com/'] }).expect(403).expect({ error: 'CSRF' });
  });

  test('locale strings exist for new error codes', () => {
    for (const l of ['vi', 'en']) {
      expect(require(`../public/locales/${l}.json`)['error.BULK_TOO_MANY']).toBeTruthy();
    }
  });
});
