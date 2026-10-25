const express = require('express');
const path = require('path');

function createApp({ pool } = {}) {
  const app = express();
  app.locals.pool = pool;
  app.use(express.json());
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  return app;
}

module.exports = { createApp };
