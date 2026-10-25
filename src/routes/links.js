const express = require('express');
const { createLink } = require('../links');

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
      const link = await createLink(req.app.locals.pool, { url: body.url, slug: body.slug });
      res.status(201).json({ ...link, shortUrl: `${baseUrl(req)}/${link.slug}` });
    } catch (err) {
      next(err);
    }
  });
  return router;
}

module.exports = { linksRouter };
