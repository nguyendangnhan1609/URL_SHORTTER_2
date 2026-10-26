const crypto = require('crypto');
const express = require('express');
const { LinkError } = require('./links');
const { RateLimiter } = require('./ratelimit');

const COOKIE = 'sid';
const SESSION_MS = 30 * 24 * 3600 * 1000;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const scrypt = (pw, salt) =>
  new Promise((resolve, reject) =>
    crypto.scrypt(pw, salt, 64, (e, k) => (e ? reject(e) : resolve(k))));

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await scrypt(pw, salt)).toString('hex')}`;
}
async function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(pw, Buffer.from(saltHex, 'hex'));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
let dummyHash;

function parseCookie(header, name) {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(header || '');
  return m ? m[1] : '';
}

function normEmail(v) {
  if (typeof v !== 'string') throw new LinkError('INVALID_EMAIL', 400);
  const e = v.trim().toLowerCase();
  if (e.length > 254 || !EMAIL_RE.test(e)) throw new LinkError('INVALID_EMAIL', 400);
  return e;
}
function checkNewPassword(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD || pw.length > MAX_PASSWORD) {
    throw new LinkError('WEAK_PASSWORD', 400);
  }
}

function setCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MS,
    path: '/',
  });
}
const clearCookie = (res) => res.clearCookie(COOKIE, { path: '/' });

async function createSession(pool, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)', [
    sha256(token), userId, new Date(Date.now() + SESSION_MS),
  ]);
  setCookie(res, token);
}

// Gắn req.user (hoặc null) và req.sessionId nếu có cookie hợp lệ.
function loadUser(pool) {
  return async (req, res, next) => {
    req.user = null;
    const token = parseCookie(req.headers.cookie, COOKIE);
    if (!/^[0-9a-f]{64}$/.test(token)) return next();
    try {
      const r = await pool.query(
        'SELECT u.id, u.email, s.id AS sid FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1 AND s.expires_at > $2',
        [sha256(token), new Date()]
      );
      if (r.rows[0]) {
        req.user = { id: r.rows[0].id, email: r.rows[0].email };
        req.sessionId = r.rows[0].sid;
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

// CSRF: request thay đổi dữ liệu có cookie phiên cần X-Requested-With hoặc Origin cùng host.
function csrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!parseCookie(req.headers.cookie, COOKIE)) return next();
  if (req.get('x-requested-with')) return next();
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host === req.get('host')) return next();
    } catch { /* rơi xuống 403 */ }
  }
  res.status(403).json({ error: 'CSRF' });
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'UNAUTHORIZED' });
  next();
}

function authRouter({ loginLimiter }) {
  const router = express.Router();
  const body = (req) => (req.body && typeof req.body === 'object' ? req.body : {});
  const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

  router.post('/register', wrap(async (req, res) => {
    const pool = req.app.locals.pool;
    const email = normEmail(body(req).email);
    checkNewPassword(body(req).password);
    const hash = await hashPassword(body(req).password);
    let row;
    try {
      row = (await pool.query(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email', [email, hash]
      )).rows[0];
    } catch (err) {
      if (err && err.code === '23505') throw new LinkError('EMAIL_TAKEN', 409);
      throw err;
    }
    await createSession(pool, res, row.id);
    res.status(201).json({ user: { id: String(row.id), email: row.email } });
  }));

  router.post('/login', wrap(async (req, res) => {
    const pool = req.app.locals.pool;
    const email = typeof body(req).email === 'string' ? body(req).email.trim().toLowerCase() : '';
    const password = body(req).password;
    if (!email || typeof password !== 'string') throw new LinkError('INVALID_CREDENTIALS', 401);
    const key = `${email}|${req.ip}`;
    if (loginLimiter.blocked(key)) throw new LinkError('TOO_MANY_ATTEMPTS', 429);
    const row = (await pool.query('SELECT id, email, password_hash FROM users WHERE email = $1', [email])).rows[0];
    if (!dummyHash) dummyHash = await hashPassword('dummy-password');
    const ok = await verifyPassword(password, row ? row.password_hash : dummyHash);
    if (!row || !ok) {
      loginLimiter.hit(key);
      throw new LinkError('INVALID_CREDENTIALS', 401);
    }
    loginLimiter.reset(key);
    await createSession(pool, res, row.id);
    res.json({ user: { id: String(row.id), email: row.email } });
  }));

  router.post('/logout', wrap(async (req, res) => {
    if (req.sessionId) await req.app.locals.pool.query('DELETE FROM sessions WHERE id = $1', [req.sessionId]);
    clearCookie(res);
    res.json({ ok: true });
  }));

  router.get('/me', requireUser, (req, res) => {
    res.json({ user: { id: String(req.user.id), email: req.user.email } });
  });

  router.post('/change-password', requireUser, wrap(async (req, res) => {
    const pool = req.app.locals.pool;
    const { currentPassword, newPassword } = body(req);
    const row = (await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id])).rows[0];
    const key = `pw|${req.user.id}|${req.ip}`;
    if (loginLimiter.blocked(key)) throw new LinkError('TOO_MANY_ATTEMPTS', 429);
    if (typeof currentPassword !== 'string' || !(await verifyPassword(currentPassword, row.password_hash))) {
      loginLimiter.hit(key);
      throw new LinkError('INVALID_CREDENTIALS', 401);
    }
    checkNewPassword(newPassword);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(newPassword), req.user.id]);
    // Đăng xuất mọi phiên khác.
    await pool.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [req.user.id, req.sessionId]);
    res.json({ ok: true });
  }));

  return router;
}

function makeLoginLimiter() {
  return new RateLimiter(Number(process.env.LOGIN_MAX_FAILS) || 5, 15 * 60 * 1000);
}

module.exports = { authRouter, loadUser, csrf, requireUser, makeLoginLimiter, hashPassword, verifyPassword };
