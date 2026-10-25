// Simple LRU cache built on Map (insertion order = recency order).
class LruCache {
  constructor(max = 10000) {
    this.max = Math.max(1, Number(max) || 10000);
    this.map = new Map();
  }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
  delete(key) {
    return this.map.delete(key);
  }
  get size() {
    return this.map.size;
  }
}

module.exports = { LruCache };
