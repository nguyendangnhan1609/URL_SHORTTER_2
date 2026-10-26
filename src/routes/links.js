const express = require('express');
const { requireUser } = require('../auth');
const { createLink, getLink, SLUG_RE, LinkError } = require('../links');

function baseUrl(req) {
  const configured = process.env.BASE_URL;
  if (configured) return configured.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

function linksRouter() {
  const router = express.Router();
  router.post('/', async (req, res, next) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      if (!req.user) {
        const lim = req.app.locals.guestLimiter;
        if (lim.blocked(req.ip)) throw new LinkError('RATE_LIMITED', 429);
        lim.hit(req.ip);
      }
      const link = await createLink(req.app.locals.pool, {
        url: body.url, slug: body.slug, userId: req.user && req.user.id,
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
        if (typeof v !== 'string' || !/^\d+$/.test(v)) throw new LinkError('INVALID_PAGINATION', 400);
        const n = Number(v);
        if (!Number.isSafeInteger(n) || n < 1 || (max && n > max)) throw new LinkError('INVALID_PAGINATION', 400);
        return n;
      };
      const page = parse(req.query.page, 1);
      const pageSize = parse(req.query.pageSize, 20, 100);
      const clicks = req.app.locals.clicks;
      if (clicks) await clicks.flush();
      const pool = req.app.locals.pool;
      const total = Number((await pool.query('SELECT COUNT(*) AS c FROM links WHERE user_id = $1', [req.user.id])).rows[0].c);
      const r = await pool.query(
        'SELECT slug, target_url, clicks, created_at FROM links WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3',
        [req.user.id, pageSize, (page - 1) * pageSize]
      );
      const base = baseUrl(req);
      res.json({
        items: r.rows.map((row) => ({
          slug: row.slug,
          url: row.target_url,
          shortUrl: `${base}/${row.slug}`,
          clicks: Number(row.clicks),
          createdAt: row.created_at,
        })),
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
      if (!SLUG_RE.test(slug)) throw new LinkError('NOT_FOUND', 404);
      const clicks = req.app.locals.clicks;
      if (clicks) await clicks.flush();
      const link = await getLink(req.app.locals.pool, slug);
      if (!link) throw new LinkError('NOT_FOUND', 404);
      res.json(link);
    } catch (err) {
      next(err);
    }
  });
  return router;
}

module.exports = { linksRouter };
