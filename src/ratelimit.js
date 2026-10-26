// Bộ đếm cửa sổ trượt đơn giản trong bộ nhớ (một instance).
class RateLimiter {
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
  }
  _recent(key, now) {
    const arr = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (arr.length) this.hits.set(key, arr); else this.hits.delete(key);
    return arr;
  }
  blocked(key, now = Date.now()) {
    return this._recent(key, now).length >= this.max;
  }
  hit(key, now = Date.now()) {
    const arr = this._recent(key, now);
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 50000) this.hits.delete(this.hits.keys().next().value);
  }
  reset(key) {
    this.hits.delete(key);
  }
}
module.exports = { RateLimiter };
