const request = require('supertest');
const { newDb } = require('pg-mem');
const { migrate } = require('../src/db');
const { createApp } = require('../src/app');

let pool, app;

beforeAll(async () => {
  const { Pool } = newDb().adapters.createPg();
  pool = new Pool();
  await migrate(pool);
  app = createApp({ pool });
});
afterAll(() => pool.end());

const post = (body) => request(app).post('/api/links').send(body);

test('A1: valid url without slug -> 201 with 7-char slug', async () => {
  const res = await post({ url: 'https://example.com/path?q=1' });
  expect(res.status).toBe(201);
  expect(res.body.slug).toMatch(/^[A-Za-z0-9]{7}$/);
  expect(res.body.url).toBe('https://example.com/path?q=1');
  expect(res.body.clicks).toBe(0);
  expect(res.body.createdAt).toBeTruthy();
  expect(res.body.shortUrl).toMatch(new RegExp(`/${res.body.slug}$`));
});

test('shortUrl uses BASE_URL when set', async () => {
  process.env.BASE_URL = 'https://sho.rt/';
  try {
    const res = await post({ url: 'http://a.com', slug: 'base-1' });
    expect(res.body.shortUrl).toBe('https://sho.rt/base-1');
  } finally {
    delete process.env.BASE_URL;
  }
});

test('A2: duplicate custom slug -> 409 SLUG_TAKEN', async () => {
  const a = await post({ url: 'http://a.com', slug: 'abc-1' });
  expect(a.status).toBe(201);
  expect(a.body.slug).toBe('abc-1');
  const b = await post({ url: 'http://b.com', slug: 'abc-1' });
  expect(b.status).toBe(409);
  expect(b.body).toEqual({ error: 'SLUG_TAKEN' });
});

// Lưu ý: pg-mem chạy đơn luồng nên không chứng minh được race thật trên Postgres;
// tính đúng đắn dựa vào ràng buộc UNIQUE (23505) của DB.
test('A2: 20 parallel requests with same slug -> exactly one 201', async () => {
  const results = await Promise.all(
    Array.from({ length: 20 }, () => post({ url: 'http://p.com', slug: 'race-1' }))
  );
  const codes = results.map((r) => r.status);
  expect(codes.filter((c) => c === 201)).toHaveLength(1);
  expect(codes.filter((c) => c === 409)).toHaveLength(19);
});

describe('A3: validation -> 400', () => {
  const cases = [
    ['ftp url', { url: 'ftp://x.com/f' }, 'INVALID_URL'],
    ['empty url', { url: '' }, 'INVALID_URL'],
    ['missing url', {}, 'INVALID_URL'],
    ['javascript url', { url: 'javascript:alert(1)' }, 'INVALID_URL'],
    ['not a url', { url: 'hello' }, 'INVALID_URL'],
    ['url too long', { url: 'http://a.com/' + 'a'.repeat(2048) }, 'INVALID_URL'],
    ['short slug', { url: 'http://a.com', slug: 'a' }, 'INVALID_SLUG'],
    ['bad chars slug', { url: 'http://a.com', slug: 'ab c!' }, 'INVALID_SLUG'],
    ['reserved slug', { url: 'http://a.com', slug: 'api' }, 'RESERVED_SLUG'],
    ['reserved slug case-insens', { url: 'http://a.com', slug: 'Admin' }, 'RESERVED_SLUG'],
  ];
  test.each(cases)('%s', async (_n, body, code) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: code });
  });
});

test('malformed JSON -> 400 INVALID_BODY', async () => {
  const res = await request(app)
    .post('/api/links')
    .set('Content-Type', 'application/json')
    .send('{"url": ');
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: 'INVALID_BODY' });
});

test('auto slug retries on collision then succeeds', async () => {
  const spy = jest.spyOn(require('crypto'), 'randomInt');
  await post({ url: 'http://a.com', slug: 'AAAAAAA' });
  let n = 0;
  spy.mockImplementation(() => (n++ < 7 ? 0 : 1)); // lần 1 "AAAAAAA" (trùng), lần 2 "BBBBBBB"
  const res = await post({ url: 'http://a.com' });
  spy.mockRestore();
  expect(res.status).toBe(201);
  expect(res.body.slug).toBe('BBBBBBB');
});
