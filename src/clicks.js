// Batches click increments per slug and flushes them to the DB periodically.
function createClickCounter(pool, { intervalMs = 1000 } = {}) {
  let pending = new Map();
  let inflight = Promise.resolve();

  function record(slug) {
    pending.set(slug, (pending.get(slug) || 0) + 1);
  }

  function flush() {
    const batch = pending;
    pending = new Map();
    const run = async () => {
      for (const [slug, n] of batch) {
        try {
          await pool.query('UPDATE links SET clicks = clicks + $2 WHERE slug = $1', [slug, n]);
        } catch (err) {
          console.error('click flush failed', err);
        }
      }
    };
    inflight = inflight.then(run);
    return inflight;
  }

  const timer = setInterval(() => {
    if (pending.size) flush();
  }, intervalMs);
  timer.unref();

  // Stop the timer and flush remaining counts (call on process exit).
  function stop() {
    clearInterval(timer);
    return flush();
  }

  return { record, flush, stop };
}

module.exports = { createClickCounter };
