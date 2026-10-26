const TTL_MS = 60 * 1000;

// GET /api/stats/public: tổng link và tổng click, cache 60 giây trong bộ nhớ.
function statsRouter(express, { ttlMs = TTL_MS, now = Date.now } = {}) {
  const router = express.Router();
  let cached = null;
  router.get('/public', async (req, res, next) => {
    try {
      const t = now();
      if (!cached || t - cached.at >= ttlMs) {
        const { rows } = await req.app.locals.pool.query(
          'SELECT COUNT(*) AS links, COALESCE(SUM(clicks), 0) AS clicks FROM links');
        cached = { at: t, body: { totalLinks: Number(rows[0].links), totalClicks: Number(rows[0].clicks) } };
      }
      res.set('Cache-Control', 'public, max-age=60');
      res.json(cached.body);
    } catch (e) { next(e); }
  });
  return router;
}
module.exports = { statsRouter };
