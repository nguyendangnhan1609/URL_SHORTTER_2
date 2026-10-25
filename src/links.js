const crypto = require('crypto');

const RESERVED = new Set([
  'api', 'admin', 'dashboard', 'healthz', 'static', 'public', 'locales',
  'assets', 'favicon.ico', 'robots.txt', 'create', 'links',
]);
const SLUG_RE = /^[a-zA-Z0-9_-]{3,32}$/;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const MAX_URL = 2048;
const MAX_ATTEMPTS = 5;

class LinkError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function generateSlug(len = 7) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s;
}

function validateUrl(url) {
  if (typeof url !== 'string') throw new LinkError('INVALID_URL', 400);
  const trimmed = url.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL) throw new LinkError('INVALID_URL', 400);
  if (!/^https?:\/\//i.test(trimmed)) throw new LinkError('INVALID_URL', 400);
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    throw new LinkError('INVALID_URL', 400);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new LinkError('INVALID_URL', 400);
  if (u.username || u.password) throw new LinkError('INVALID_URL', 400);
  if (u.href.length > MAX_URL) throw new LinkError('INVALID_URL', 400);
  return u.href;
}

function validateSlug(slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) throw new LinkError('INVALID_SLUG', 400);
  if (RESERVED.has(slug.toLowerCase())) throw new LinkError('RESERVED_SLUG', 400);
}

const isUnique = (err) => err && err.code === '23505';

async function insert(pool, slug, url) {
  const r = await pool.query(
    'INSERT INTO links (slug, target_url) VALUES ($1, $2) RETURNING slug, target_url, clicks, created_at',
    [slug, url]
  );
  const row = r.rows[0];
  return {
    slug: row.slug,
    url: row.target_url,
    clicks: Number(row.clicks),
    createdAt: row.created_at,
  };
}

async function createLink(pool, { url, slug } = {}) {
  url = validateUrl(url);
  if (slug !== undefined && slug !== null && slug !== '') {
    validateSlug(slug);
    try {
      return await insert(pool, slug, url);
    } catch (err) {
      if (isUnique(err)) throw new LinkError('SLUG_TAKEN', 409);
      throw err;
    }
  }
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const candidate = generateSlug();
    if (RESERVED.has(candidate.toLowerCase())) continue;
    try {
      return await insert(pool, candidate, url);
    } catch (err) {
      if (!isUnique(err)) throw err;
    }
  }
  throw new LinkError('SLUG_GENERATION_FAILED', 500);
}

async function getLink(pool, slug) {
  const r = await pool.query(
    'SELECT slug, target_url, clicks, created_at FROM links WHERE slug = $1',
    [slug]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    slug: row.slug,
    url: row.target_url,
    clicks: Number(row.clicks),
    createdAt: row.created_at,
  };
}

module.exports = { createLink, getLink, LinkError, generateSlug, RESERVED, SLUG_RE };
