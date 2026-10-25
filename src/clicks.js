// Batches click increments per slug and flushes them to the DB periodically.
function createClickCounter(pool, { intervalMs = 1000, maxPending = 50000, maxFailures = 5 } = {}) {
  let pending = new Map();
  const failures = new Map();
  let running = null; // promise of the flush currently executing
  let queued = null; // promise of the single follow-up flush shared by late callers

  function record(slug) {
    pending.set(slug, (pending.get(slug) || 0) + 1);
  }

  function requeue(slug, n) {
    const f = (failures.get(slug) || 0) + 1;
    if (f >= maxFailures) {
      failures.delete(slug);
      console.error(`click flush: dropping ${n} clicks for "${slug}" after ${f} consecutive failures`);
      return;
    }
    if (!pending.has(slug) && pending.size >= maxPending) {
      console.error(`click flush: pending full, dropping ${n} clicks for "${slug}"`);
      return;
    }
    failures.set(slug, f);
    pending.set(slug, (pending.get(slug) || 0) + n);
  }

  async function run() {
    const batch = pending;
    pending = new Map();
    for (const [slug, n] of batch) {
      try {
        await pool.query('UPDATE links SET clicks = clicks + $2 WHERE slug = $1', [slug, n]);
        failures.delete(slug);
      } catch (err) {
        console.error('click flush failed', err);
        requeue(slug, n);
      }
    }
  }

  // Coalesced: at most one running + one queued flush, however many callers.
  // A caller always gets a flush that starts after its call, so earlier clicks are included.
  function flush() {
    if (!running) {
      running = run().finally(() => {
        running = null;
      });
      return running;
    }
    if (!queued) {
      queued = running.then(() => {
        queued = null;
        return flush();
      });
    }
    return queued;
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
