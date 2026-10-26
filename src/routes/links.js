const express = require('express');
const { requireUser } = require('../auth');
const { createLink, getLink, updateLink, deleteLink, linkStatus, toPublic, COLS, SLUG_RE, AppError } = require('../links');

function baseUrl(req) {
  const configured = process.env.BASE_URL;
  if (configured) return configured.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

function selfHosts(req) {
  const hosts = [req.get('host')];
  if (process.env.BASE_URL) {
    try { hosts.push(new URL(process.env.BASE_URL).host); } catch { /* bỏ qua BASE_URL sai */ }
  }
  return hosts.filter(Boolean);
}

const BULK_MAX = 50;
const escLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function linksRouter() {
  const router = express.Router();
  router.post('/', async (req, res, next) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      if (!req.user) {
        const lim = req.app.locals.guestLimiter;
        if (lim.blocked(req.ip)) throw new AppError('RATE_LIMITED', 429);
        lim.hit(req.ip);
      }
      const link = await createLink(req.app.locals.pool, {
        url: body.url, slug: body.slug, userId: req.user && req.user.id,
        title: body.title, note: body.note, expiresAt: body.expiresAt, maxClicks: body.maxClicks,
        selfHosts: selfHosts(req),
      });
      res.status(201).json({ ...link, shortUrl: `${baseUrl(req)}/${link.slug}` });
    } catch (err) {
      next(err);
    }
  });
  router.post('/bulk', requireUser, async (req, res, next) => {
    try {
      const urls = req.body && typeof req.body === 'object' ? req.body.urls : undefined;
      if (!Array.isArray(urls) || urls.length === 0) throw new AppError('INVALID_BODY', 400);
      if (urls.length > BULK_MAX) throw new AppError('BULK_TOO_MANY', 400);
      const pool = req.app.locals.pool;
      const hosts = selfHosts(req);
      const base = baseUrl(req);
      const results = [];
      for (let i = 0; i < urls.length; i++) {
        try {
          const link = await createLink(pool, { url: urls[i], userId: req.user.id, selfHosts: hosts });
          results.push({ index: i, ok: true, link: { ...link, shortUrl: `${base}/${link.slug}` } });
        } catch (err) {
          const code = err instanceof AppError ? err.code : 'INTERNAL_ERROR';
          if (!(err instanceof AppError)) console.error(err);
          results.push({ index: i, ok: false, error: code });
        }
      }
      res.json({ results, created: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
    } catch (err) {
      next(err);
    }
  });
  router.get('/:slug/stats', requireUser, async (req, res, next) => {
    try {
      const { slug } = req.params;
      if (!SLUG_RE.test(slug)) throw new AppError('NOT_FOUND', 404);
      const clicks = req.app.locals.clicks;
      if (clicks) await clicks.flush();
      const pool = req.app.locals.pool;
      const link = await getLink(pool, slug);
      if (!link || link.userId == null || String(link.userId) !== String(req.user.id)) {
        throw new AppError('NOT_FOUND', 404);
      }
      const id = (await pool.query('SELECT id FROM links WHERE slug = $1', [slug])).rows[0].id;
      const dayMs = 24 * 3600 * 1000;
      const today = Math.floor(Date.now() / dayMs) * dayMs; // 00:00 UTC hôm nay
      const from = new Date(today - 29 * dayMs);
      const days = new Map();
      for (let i = 0; i < 30; i++) days.set(new Date(from.getTime() + i * dayMs).toISOString().slice(0, 10), 0);
      const times = (await pool.query('SELECT clicked_at FROM link_clicks WHERE link_id = $1 AND clicked_at >= $2', [id, from])).rows;
      for (const t of times) {
        const k = new Date(t.clicked_at).toISOString().slice(0, 10);
        if (days.has(k)) days.set(k, days.get(k) + 1);
      }
      const byDay = [...days].map(([date, count]) => ({ date, count }));
      const group = async (col, limit) => {
        const rows = (await pool.query(
          `SELECT ${col} AS k, COUNT(*) AS c FROM link_clicks WHERE link_id = $1 GROUP BY ${col} ORDER BY c DESC, k ASC${limit ? ` LIMIT ${limit}` : ''}`, [id])).rows;
        return rows.map((r) => ({ [col === 'referrer_host' ? 'referrer' : col]: r.k, count: Number(r.c) }));
      };
      res.json({
        total: link.clicks,
        last7days: byDay.slice(-7).reduce((a, d) => a + d.count, 0),
        byDay,
        byReferrer: await group('referrer_host', 10),
        byDevice: await group('device'),
        byBrowser: await group('browser'),
      });
    } catch (err) {
      next(err);
    }
  });
  router.get('/', requireUser, async (req, res, next) => {
    try {
      const parse = (v, def, max) => {
        if (v === undefined) return def;
        if (typeof v !== 'string' || !/^\d+$/.test(v)) throw new AppError('INVALID_PAGINATION', 400);
        const n = Number(v);
        if (!Number.isSafeInteger(n) || n < 1 || (max && n > max)) throw new AppError('INVALID_PAGINATION', 400);
        return n;
      };
      const page = parse(req.query.page, 1);
      const pageSize = parse(req.query.pageSize, 20, 100);
      const clicks = req.app.locals.clicks;
      if (clicks) await clicks.flush();
      const pool = req.app.locals.pool;
      const where = ['user_id = $1'];
      const params = [req.user.id];
      const { q, status } = req.query;
      if (q !== undefined) {
        if (typeof q !== 'string' || q.length > 200) throw new AppError('INVALID_QUERY', 400);
        if (q.trim() !== '') {
          params.push(`%${escLike(q.trim())}%`);
          const n = params.length;
          where.push(`(slug ILIKE $${n} OR target_url ILIKE $${n} OR title ILIKE $${n})`);
        }
      }
      if (status !== undefined && status !== '') {
        if (status === 'active') {
          params.push(new Date());
          where.push(`is_active = true AND (expires_at IS NULL OR expires_at > $${params.length}) AND (max_clicks IS NULL OR clicks < max_clicks)`);
        } else if (status === 'disabled') {
          where.push('is_active = false');
        } else if (status === 'expired') {
          params.push(new Date());
          where.push(`is_active = true AND ((expires_at IS NOT NULL AND expires_at <= $${params.length}) OR (max_clicks IS NOT NULL AND clicks >= max_clicks))`);
        } else {
          throw new AppError('INVALID_STATUS', 400);
        }
      }
      const cond = where.join(' AND ');
      const total = Number((await pool.query(`SELECT COUNT(*) AS c FROM links WHERE ${cond}`, params)).rows[0].c);
      const r = await pool.query(
        `SELECT ${COLS} FROM links WHERE ${cond} ORDER BY created_at DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      const base = baseUrl(req);
      const sum = (await pool.query(
        'SELECT COUNT(*) AS n, COALESCE(SUM(clicks), 0) AS c FROM links WHERE user_id = $1', [req.user.id])).rows[0];
      res.json({
        summary: { totalLinks: Number(sum.n), totalClicks: Number(sum.c) },
        items: r.rows.map((row) => {
          const l = toPublic(row);
          return { ...l, shortUrl: `${base}/${row.slug}`, status: linkStatus(l) };
        }),
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      });
    } catch (err) {
      next(err);
    }
  });
  router.get('/:slug', async (req, res, next) => {
    try {
      const { slug } = req.params;
      if (!SLUG_RE.test(slug)) throw new AppError('NOT_FOUND', 404);
      const clicks = req.app.locals.clicks;
      if (clicks) await clicks.flush();
      const link = await getLink(req.app.locals.pool, slug);
      if (!link) throw new AppError('NOT_FOUND', 404);
      const { userId, ...pub } = link;
      // Link của người dùng chỉ chủ sở hữu xem được.
      if (userId != null && !(req.user && String(req.user.id) === String(userId))) {
        throw new AppError('NOT_FOUND', 404);
      }
      res.json({ ...pub, shortUrl: `${baseUrl(req)}/${pub.slug}`, status: linkStatus(pub) });
    } catch (err) {
      next(err);
    }
  });
  router.patch('/:slug', requireUser, async (req, res, next) => {
    try {
      const { slug } = req.params;
      if (!SLUG_RE.test(slug)) throw new AppError('NOT_FOUND', 404);
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      const clicks = req.app.locals.clicks;
      if (clicks) await clicks.flush();
      const link = await updateLink(req.app.locals.pool, slug, req.user.id, body, selfHosts(req));
      if (!link) throw new AppError('NOT_FOUND', 404);
      req.app.locals.cache.delete(slug);
      res.json({ ...link, shortUrl: `${baseUrl(req)}/${slug}`, status: linkStatus(link) });
    } catch (err) {
      next(err);
    }
  });
  router.delete('/:slug', requireUser, async (req, res, next) => {
    try {
      const { slug } = req.params;
      if (!SLUG_RE.test(slug)) throw new AppError('NOT_FOUND', 404);
      const ok = await deleteLink(req.app.locals.pool, slug, req.user.id);
      req.app.locals.cache.delete(slug);
      if (!ok) throw new AppError('NOT_FOUND', 404);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });
  return router;
}

module.exports = { linksRouter };
