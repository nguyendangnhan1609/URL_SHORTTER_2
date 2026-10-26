const express = require('express');
const path = require('path');
const { linksRouter } = require('./routes/links');
const { AppError, SLUG_RE, getLink } = require('./links');
const { LruCache } = require('./cache');
const { createClickCounter } = require('./clicks');
const { authRouter, loadUser, csrf, makeLoginLimiter, startSessionCleanup } = require('./auth');
const { RateLimiter } = require('./ratelimit');
const { pagesRouter, pickLang, renderNotFound } = require('./pages');

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
  app.get('/:slug', async (req, res, next) => {
    try {
      const { slug } = req.params;
      const valid = SLUG_RE.test(slug);
      let url = valid ? cache.get(slug) : undefined;
      if (url === undefined && valid) {
        const link = await getLink(pool, slug);
        if (link) {
          url = link.url;
          cache.set(slug, url);
        }
      }
      if (url === undefined) {
        if (req.accepts(['html', 'json']) === 'json') {
          return res.status(404).json({ error: 'NOT_FOUND' });
        }
        res.set('Vary', 'Accept-Language, Cookie');
        return res.status(404).type('html').send(renderNotFound(pickLang(req)));
      }
      res.redirect(302, url);
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
