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
      res.json({
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
      res.json(pub);
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
