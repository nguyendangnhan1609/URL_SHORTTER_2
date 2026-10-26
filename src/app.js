const express = require('express');
const path = require('path');
const { linksRouter } = require('./routes/links');
const { AppError, SLUG_RE, getLink, linkStatus } = require('./links');
const { LruCache } = require('./cache');
const { createClickCounter } = require('./clicks');
const { authRouter, loadUser, csrf, makeLoginLimiter, startSessionCleanup } = require('./auth');
const { RateLimiter } = require('./ratelimit');
const { pagesRouter, pickLang, renderNotFound, renderGone, renderPreview } = require('./pages');

function createApp({ pool, cacheSize, adsEnabled, guestLinkLimit, loginLimiter } = {}) {
  const app = express();
  const tp = process.env.TRUST_PROXY;
  if (tp) app.set('trust proxy', /^\d+$/.test(tp) ? Number(tp) : tp === 'true' ? true : tp);
  app.locals.pool = pool;
  const cache = new LruCache(cacheSize || process.env.CACHE_SIZE || 10000);
  const clicks = createClickCounter(pool);
  app.locals.cache = cache;
  app.locals.sessionCleanup = startSessionCleanup(pool);
  app.locals.clicks = clicks;
  app.use(express.json({ limit: '10kb' }));
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.locals.guestLimiter = new RateLimiter(
    guestLinkLimit || Number(process.env.GUEST_LINKS_PER_HOUR) || 30, 3600 * 1000);
  app.use('/api', csrf, loadUser(pool));
  app.use('/api/auth', authRouter({ loginLimiter: loginLimiter || makeLoginLimiter() }));
  app.use('/api/links', linksRouter());
  app.use(pagesRouter(express, adsEnabled));
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));
  const notFound = (req, res) => {
    if (req.accepts(['html', 'json']) === 'json') return res.status(404).json({ error: 'NOT_FOUND' });
    res.set('Vary', 'Accept-Language, Cookie');
    return res.status(404).type('html').send(renderNotFound(pickLang(req)));
  };
  const gone = (req, res) => {
    if (req.accepts(['html', 'json']) === 'json') return res.status(410).json({ error: 'GONE' });
    res.set('Vary', 'Accept-Language, Cookie');
    return res.status(410).type('html').send(renderGone(pickLang(req)));
  };
  // Trả { url } nếu link dùng được, 'gone' nếu tắt/hết hạn/hết lượt, null nếu không tồn tại.
  async function resolve(slug, { useCache }) {
    const entry = useCache ? cache.get(slug) : undefined;
    if (entry !== undefined) {
      if (entry.expiresAt != null && entry.expiresAt <= Date.now()) {
        cache.delete(slug);
        return 'gone';
      }
      return { url: entry.url };
    }
    let link = await getLink(pool, slug);
    if (link && link.maxClicks != null) {
      await clicks.flush(); // đếm click đang chờ để so với max_clicks
      link = await getLink(pool, slug);
    }
    if (!link) return null;
    if (linkStatus(link) !== 'active') return 'gone';
    // Link có giới hạn click không cache vì số click thay đổi liên tục.
    if (useCache && link.maxClicks == null) {
      cache.set(slug, { url: link.url, expiresAt: link.expiresAt ? new Date(link.expiresAt).getTime() : null });
    }
    return { url: link.url };
  }
  app.get('/preview/:slug', async (req, res, next) => {
    try {
      const { slug } = req.params;
      const r = SLUG_RE.test(slug) ? await resolve(slug, { useCache: true }) : null;
      if (r === null) return notFound(req, res);
      if (r === 'gone') return gone(req, res);
      if (req.accepts(['html', 'json']) === 'json') return res.json({ slug, url: r.url });
      res.set('Vary', 'Accept-Language, Cookie');
      res.set('Cache-Control', 'no-store');
      res.type('html').send(renderPreview(pickLang(req), slug, r.url));
    } catch (err) {
      next(err);
    }
  });
  app.get('/:slug', async (req, res, next) => {
    try {
      const { slug } = req.params;
      const r = SLUG_RE.test(slug) ? await resolve(slug, { useCache: true }) : null;
      if (r === null) return notFound(req, res);
      if (r === 'gone') return gone(req, res);
      res.redirect(302, r.url);
      const purpose = `${req.get('purpose') || ''} ${req.get('sec-purpose') || ''}`.toLowerCase();
      if (req.method !== 'HEAD' && !purpose.includes('prefetch')) clicks.record(slug);
    } catch (err) {
      next(err);
    }
  });
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.code });
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'INVALID_BODY' });
    }
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'BODY_TOO_LARGE' });
    const status = err.status || err.statusCode;
    if (Number.isInteger(status) && status >= 400 && status < 500) {
      return res.status(status).json({ error: 'BAD_REQUEST' });
    }
    console.error(err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  });
  return app;
}

module.exports = { createApp };
