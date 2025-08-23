// src/utils/proxy.cjs
/**
 * Утилита нормализации строки прокси.
 * Поддерживает:
 *  - http://user:pass@host:port
 *  - socks5://host:port
 *  - user:pass@host:port (будет считаться http://)
 */

function normalizeProxy(p) {
  try {
    if (!p) return null;
    let s = String(p).trim();
    if (!/^[a-z]+:\/\//i.test(s)) {
      s = 'http://' + s; // по умолчанию http
    }
    const u = new URL(s);
    const scheme = u.protocol.replace(':','').toLowerCase();
    const host = u.hostname;
    const port = u.port;
    if (!host || !port) return null;
    const auth = (u.username || u.password) ? {
      username: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password)
    } : null;
    return { serverArg: `${scheme}://${host}:${port}`, auth };
  } catch {
    return null;
  }
}

module.exports = { normalizeProxy };
