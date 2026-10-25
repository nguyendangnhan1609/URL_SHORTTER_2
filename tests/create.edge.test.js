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
const postRaw = (raw) =>
  request(app).post('/api/links').set('Content-Type', 'application/json').send(raw);

describe('URL boundaries', () => {
  const base = 'https://a.com/';
  const urlOfLength = (n) => base + 'a'.repeat(n - base.length);

  test('url of exactly 2048 chars -> 201', async () => {
    const res = await post({ url: urlOfLength(2048) });
    expect(res.status).toBe(201);
  });

  test('url of 2049 chars -> 400 INVALID_URL', async () => {
    const res = await post({ url: urlOfLength(2049) });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'INVALID_URL' });
  });

  test.each([
    ['uppercase javascript scheme', 'JavaScript:alert(1)'],
    ['scheme only', 'https://'],
    ['number instead of string', 12],
    ['array instead of string', ['https://a.com']],
  ])('%s -> 400 INVALID_URL', async (_n, url) => {
    const res = await post({ url });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'INVALID_URL' });
  });
});

describe('slug boundaries', () => {
  test('slug of exactly 32 chars -> 201', async () => {
    const slug = 'b'.repeat(32);
    const res = await post({ url: 'https://a.com/x', slug });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe(slug);
  });

  test('slug of 33 chars -> 400 INVALID_SLUG', async () => {
    const res = await post({ url: 'https://a.com/x', slug: 'c'.repeat(33) });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'INVALID_SLUG' });
  });

  test.each([
    ['with space', 'ab c'],
    ['unicode letters', 'héllo'],
    ['slash', 'ab/cd'],
    ['numeric type', 12345],
  ])('slug %s -> 400 INVALID_SLUG', async (_n, slug) => {
    const res = await post({ url: 'https://a.com/x', slug });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'INVALID_SLUG' });
  });

  test.each([
    ['empty string', ''],
    ['null', null],
  ])('slug %s is treated as absent -> 201 with 7-char auto slug', async (_n, slug) => {
    const res = await post({ url: 'https://a.com/x', slug });
    expect(res.status).toBe(201);
    expect(res.body.slug).toMatch(/^[A-Za-z0-9]{7}$/);
  });

  test.each(['healthz', 'links', 'LINKS'])(
    'reserved slug %s -> 400 RESERVED_SLUG',
    async (slug) => {
      const res = await post({ url: 'https://a.com/x', slug });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'RESERVED_SLUG' });
    }
  );

  test('slug differing only by case from an existing slug is a distinct slug (observed behaviour)', async () => {
    const a = await post({ url: 'https://a.com/1', slug: 'Case-1' });
    expect(a.status).toBe(201);
    const b = await post({ url: 'https://a.com/2', slug: 'case-1' });
    expect(b.status).toBe(201);
  });
});

describe('body handling', () => {
  test('JSON array body -> 400 INVALID_URL', async () => {
    const res = await postRaw('[1,2]');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'INVALID_URL' });
  });

  test('JSON string body -> 400 INVALID_BODY', async () => {
    const res = await postRaw('"just a string"');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'INVALID_BODY' });
  });

  test('body larger than 10kb -> 413 BODY_TOO_LARGE', async () => {
    const res = await postRaw('x'.repeat(11000));
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'BODY_TOO_LARGE' });
  });

  test('response contains shortUrl and clicks 0', async () => {
    const res = await post({ url: 'https://a.com/shape' });
    expect(res.status).toBe(201);
    expect(res.body.clicks).toBe(0);
    expect(res.body.url).toBe('https://a.com/shape');
    expect(typeof res.body.shortUrl).toBe('string');
  });
});

describe('URL normalisation and hardening', () => {
  test.each([
    ['credentials user:pass', 'https://user:pass@a.com/'],
    ['credentials user only', 'https://user@a.com/'],
    ['missing slashes', 'http:example.com'],
    ['data scheme', 'data:text/html,<script>alert(1)</script>'],
  ])('%s -> 400 INVALID_URL', async (_n, url) => {
    const res = await post({ url });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'INVALID_URL' });
  });

  test('non-string url (number, array) -> 400 INVALID_URL', async () => {
    for (const url of [123, ['https://a.com']]) {
      const res = await post({ url });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'INVALID_URL' });
    }
  });

  test('leading/trailing whitespace is trimmed -> 201', async () => {
    const res = await post({ url: '  https://a.com/trim  ' });
    expect(res.status).toBe(201);
    expect(res.body.url).toBe('https://a.com/trim');
  });

  test('stored url is the normalised href', async () => {
    const res = await post({ url: 'HTTPS://A.com' });
    expect(res.status).toBe(201);
    expect(res.body.url).toBe('https://a.com/');
  });

  test('slug longer than 32 chars -> 400 INVALID_SLUG', async () => {
    const res = await post({ url: 'https://a.com/x', slug: 'd'.repeat(40) });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'INVALID_SLUG' });
  });
});
