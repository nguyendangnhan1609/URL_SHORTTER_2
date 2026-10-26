// Batches click increments per slug and flushes them to the DB periodically.
function createClickCounter(pool, { intervalMs = 1000, maxPending = 50000, maxFailures = 5 } = {}) {
  let pending = new Map();
  let events = []; // chi tiết click chờ ghi vào link_clicks: { slug, at, referrer, device, browser }
  const failures = new Map();
  let running = null; // promise of the flush currently executing
  let queued = null; // promise of the single follow-up flush shared by late callers

  function recordEvent(slug, meta) {
    if (!meta) return;
    if (events.length >= maxPending) {
      console.error('click flush: events full, dropping click detail');
      return;
    }
    events.push({ slug, ...meta });
  }

  // Đếm theo lô + ghi chi tiết (bất đồng bộ, không chặn redirect).
  function record(slug, meta) {
    pending.set(slug, (pending.get(slug) || 0) + 1);
    recordEvent(slug, meta);
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
    const evs = events;
    events = [];
    for (const [slug, n] of batch) {
      try {
        await pool.query('UPDATE links SET clicks = clicks + $2 WHERE slug = $1', [slug, n]);
        failures.delete(slug);
      } catch (err) {
        console.error('click flush failed', err);
        requeue(slug, n);
      }
    }
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      try {
        await pool.query(
          'INSERT INTO link_clicks (link_id, clicked_at, referrer_host, device, browser) SELECT id, $2::timestamptz, $3::text, $4::text, $5::text FROM links WHERE slug = $1',
          [e.slug, e.at, e.referrer, e.device, e.browser]
        );
      } catch (err) {
        // Chi tiết thống kê là phụ: lỗi thì bỏ, không làm hỏng việc đếm.
        console.error('click detail insert failed', err);
      }
    }
  }

  // Tăng click nguyên tử cho link có max_clicks: trả true nếu còn lượt (và đã tăng), false nếu đã hết.
  async function tryConsume(slug) {
    const r = await pool.query(
      'UPDATE links SET clicks = clicks + 1 WHERE slug = $1 AND is_active = true AND (max_clicks IS NULL OR clicks < max_clicks) RETURNING clicks',
      [slug]
    );
    return r.rows.length > 0;
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

  return { record, recordEvent, tryConsume, flush, stop };
}

module.exports = { createClickCounter };
