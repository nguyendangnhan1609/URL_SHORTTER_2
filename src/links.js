const crypto = require('crypto');

const RESERVED = new Set([
  'api', 'admin', 'dashboard', 'healthz', 'static', 'public', 'locales',
  'assets', 'favicon.ico', 'robots.txt', 'create', 'links',
  'login', 'register', 'logout', 'me', 'profile', 'preview',
]);
const SLUG_RE = /^[a-zA-Z0-9_-]{3,32}$/;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const MAX_URL = 2048;
const MAX_ATTEMPTS = 5;

class AppError extends Error {
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
  if (typeof url !== 'string') throw new AppError('INVALID_URL', 400);
  const trimmed = url.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL) throw new AppError('INVALID_URL', 400);
  if (!/^https?:\/\//i.test(trimmed)) throw new AppError('INVALID_URL', 400);
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    throw new AppError('INVALID_URL', 400);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new AppError('INVALID_URL', 400);
  if (u.username || u.password) throw new AppError('INVALID_URL', 400);
  if (u.href.length > MAX_URL) throw new AppError('INVALID_URL', 400);
  return u.href;
}

// selfHosts: danh sách host (kèm port nếu có) của chính dịch vụ; URL đích không được trỏ về đó.
// Chuẩn hoá host để so sánh: chữ thường, bỏ dấu chấm cuối, bỏ tiền tố "www.", giữ port (nếu khác mặc định).
function normHost(h) {
  try {
    const u = new URL(`http://${String(h).trim()}`);
    const name = u.hostname.toLowerCase().replace(/\.+$/, '').replace(/^www\./, '');
    return u.port ? `${name}:${u.port}` : name;
  } catch { return ''; }
}

function checkSelfReference(url, selfHosts) {
  if (!selfHosts || !selfHosts.length) return;
  const host = normHost(new URL(url).host);
  if (selfHosts.some((h) => h && normHost(h) === host)) throw new AppError('SELF_REFERENCE', 400);
}

function validateText(v, max, code) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new AppError(code, 400);
  const t = v.trim();
  if (t.length > max) throw new AppError(code, 400);
  return t === '' ? null : t;
}
const validateTitle = (v) => validateText(v, 100, 'INVALID_TITLE');
const validateNote = (v) => validateText(v, 500, 'INVALID_NOTE');

function validateExpiresAt(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) throw new AppError('INVALID_EXPIRES', 400);
  const d = new Date(v);
  if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) throw new AppError('INVALID_EXPIRES', 400);
  return d;
}

function validateMaxClicks(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 1e9) throw new AppError('INVALID_MAX_CLICKS', 400);
  return v;
}

function validateSlug(slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) throw new AppError('INVALID_SLUG', 400);
  if (RESERVED.has(slug.toLowerCase())) throw new AppError('RESERVED_SLUG', 400);
}

const isUnique = (err) => err && err.code === '23505';

function toPublic(row) {
  return {
    slug: row.slug,
    url: row.target_url,
    clicks: Number(row.clicks),
    createdAt: row.created_at,
    title: row.title === undefined ? null : row.title,
    note: row.note === undefined ? null : row.note,
    isActive: row.is_active === undefined ? true : row.is_active,
    expiresAt: row.expires_at === undefined ? null : row.expires_at,
    maxClicks: row.max_clicks === undefined ? null : row.max_clicks,
  };
}

const COLS = 'slug, target_url, clicks, created_at, title, note, is_active, expires_at, max_clicks';

async function insert(pool, slug, url, userId, extra) {
  const r = await pool.query(
    `INSERT INTO links (slug, target_url, user_id, title, note, expires_at, max_clicks) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLS}`,
    [slug, url, userId || null, extra.title, extra.note, extra.expiresAt, extra.maxClicks]
  );
  return toPublic(r.rows[0]);
}

async function createLink(pool, { url, slug, userId, title, note, expiresAt, maxClicks, selfHosts } = {}) {
  url = validateUrl(url);
  checkSelfReference(url, selfHosts);
  const extra = {
    title: validateTitle(title),
    note: validateNote(note),
    expiresAt: validateExpiresAt(expiresAt),
    maxClicks: validateMaxClicks(maxClicks),
  };
  if (slug !== undefined && slug !== null && slug !== '') {
    validateSlug(slug);
    try {
      return await insert(pool, slug, url, userId, extra);
    } catch (err) {
      if (isUnique(err)) throw new AppError('SLUG_TAKEN', 409);
      throw err;
    }
  }
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const candidate = generateSlug();
    if (RESERVED.has(candidate.toLowerCase())) continue;
    try {
      return await insert(pool, candidate, url, userId, extra);
    } catch (err) {
      if (!isUnique(err)) throw err;
    }
  }
  throw new AppError('SLUG_GENERATION_FAILED', 500);
}

async function getLink(pool, slug) {
  const r = await pool.query(
    `SELECT ${COLS}, user_id FROM links WHERE slug = $1`,
    [slug]
  );
  const row = r.rows[0];
  if (!row) return null;
  return { ...toPublic(row), userId: row.user_id };
}

// Trạng thái link: 'active' | 'disabled' | 'expired' (hết hạn hoặc hết lượt click).
function linkStatus(link, now = Date.now()) {
  if (link.isActive === false) return 'disabled';
  if (link.expiresAt && new Date(link.expiresAt).getTime() <= now) return 'expired';
  if (link.maxClicks != null && link.clicks >= link.maxClicks) return 'expired';
  return 'active';
}

// Cập nhật link của chủ sở hữu; trả null nếu không tồn tại / không phải chủ.
async function updateLink(pool, slug, userId, body, selfHosts) {
  const sets = [];
  const vals = [slug, userId];
  const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  if (has('url')) {
    const url = validateUrl(body.url);
    checkSelfReference(url, selfHosts);
    add('target_url', url);
  }
  if (has('title')) add('title', validateTitle(body.title));
  if (has('note')) add('note', validateNote(body.note));
  if (has('isActive')) {
    if (typeof body.isActive !== 'boolean') throw new AppError('INVALID_BODY', 400);
    add('is_active', body.isActive);
  }
  if (has('expiresAt')) add('expires_at', validateExpiresAt(body.expiresAt));
  if (has('maxClicks')) add('max_clicks', validateMaxClicks(body.maxClicks));
  if (!sets.length) throw new AppError('INVALID_BODY', 400);
  const r = await pool.query(
    `UPDATE links SET ${sets.join(', ')} WHERE slug = $1 AND user_id = $2 RETURNING ${COLS}`,
    vals
  );
  return r.rows[0] ? toPublic(r.rows[0]) : null;
}

async function deleteLink(pool, slug, userId) {
  const r = await pool.query('DELETE FROM links WHERE slug = $1 AND user_id = $2 RETURNING slug', [slug, userId]);
  return r.rows.length > 0;
}

module.exports = { createLink, getLink, updateLink, deleteLink, linkStatus, normHost, COLS, toPublic, AppError, generateSlug, RESERVED, SLUG_RE };
