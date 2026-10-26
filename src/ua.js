// Phân tích User-Agent / Referer đơn giản bằng regex. Không lưu IP hay UA gốc.
const BOT_RE = /bot|crawl|spider|slurp|curl|wget|python|java\/|httpclient|okhttp|facebookexternalhit|preview|monitor|headless/i;

function parseUserAgent(ua) {
  ua = typeof ua === 'string' ? ua.slice(0, 512) : '';
  if (!ua.trim() || BOT_RE.test(ua)) return { device: 'bot-unknown', browser: 'other' };
  let device = 'desktop';
  if (/ipad|tablet|playbook|silk/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) device = 'tablet';
  else if (/mobi|iphone|ipod|android/i.test(ua)) device = 'mobile';
  let browser = 'other';
  if (/edg(e|a|ios)?\//i.test(ua)) browser = 'edge';
  else if (/opr\/|opera|samsungbrowser/i.test(ua)) browser = 'other';
  else if (/firefox\/|fxios\//i.test(ua)) browser = 'firefox';
  else if (/chrome\/|crios\//i.test(ua)) browser = 'chrome';
  else if (/safari\//i.test(ua)) browser = 'safari';
  return { device, browser };
}

// Chỉ lấy hostname; trống/không hợp lệ = 'direct'.
function parseReferrerHost(ref) {
  if (typeof ref !== 'string' || !ref.trim()) return 'direct';
  try {
    const u = new URL(ref.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'direct';
    const h = u.hostname.toLowerCase().replace(/\.+$/, '');
    return h && h.length <= 253 ? h : 'direct';
  } catch {
    return 'direct';
  }
}

function clickMeta(req) {
  return { at: new Date(), referrer: parseReferrerHost(req.get('referer')), ...parseUserAgent(req.get('user-agent')) };
}

module.exports = { parseUserAgent, parseReferrerHost, clickMeta };
