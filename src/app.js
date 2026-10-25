const express = require('express');
const path = require('path');
const { linksRouter } = require('./routes/links');
const { LinkError } = require('./links');

function createApp({ pool } = {}) {
  const app = express();
  app.locals.pool = pool;
  app.use(express.json({ limit: '10kb' }));
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.use('/api/links', linksRouter());
  app.use(express.static(path.join(__dirname, '..', 'public')));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof LinkError) return res.status(err.status).json({ error: err.code });
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'INVALID_BODY' });
    }
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'BODY_TOO_LARGE' });
    console.error(err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  });
  return app;
}

module.exports = { createApp };
