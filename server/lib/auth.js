/**
 * auth.js — stateless admin sessions.
 *
 * A signed, httpOnly cookie carries `expiry.email.hmac`. Nothing is stored
 * server-side, so restarts don't log the owner out and there is no session
 * store to scale. Rotating SESSION_SECRET invalidates every session.
 */

const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET || 'dev-only-insecure-secret';
const COOKIE = 'koydam_admin';
const SESSION_MS = (Number(process.env.SESSION_HOURS) || 12) * 60 * 60 * 1000;

function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
}

function issueToken(email) {
  const payload = `${Date.now() + SESSION_MS}.${Buffer.from(email).toString('base64url')}`;
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = sign(payload);
  const given = parts[2];
  // Length check first: timingSafeEqual throws on mismatched buffer lengths.
  if (given.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return null;
  if (Number(parts[0]) < Date.now()) return null;
  return { email: Buffer.from(parts[1], 'base64url').toString('utf8') };
}

/** Minimal cookie header parser — avoids a cookie-parser dependency. */
function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx < 0) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax;${secure} Max-Age=${Math.floor(SESSION_MS / 1000)}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** scrypt hash, stored as `salt:hash` in ADMIN_PASSWORD_HASH. */
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function checkPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  if (derived.length !== hash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(derived), Buffer.from(hash));
}

/** Verifies credentials against ADMIN_PASSWORD_HASH, or ADMIN_PASSWORD in dev. */
function verifyCredentials(email, password) {
  const adminEmail = (process.env.ADMIN_EMAIL || 'hello@koydam.com').toLowerCase();
  if (String(email || '').toLowerCase() !== adminEmail) return false;

  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (hash) return checkPassword(password, hash);

  const plain = process.env.ADMIN_PASSWORD;
  if (!plain) return false;
  if (process.env.NODE_ENV === 'production') {
    console.warn('[auth] ADMIN_PASSWORD_HASH is not set — using plaintext ADMIN_PASSWORD in production.');
  }
  const a = Buffer.from(String(password));
  const b = Buffer.from(plain);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Express middleware: 401s API calls, redirects page requests to /admin/login. */
function requireAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const session = verifyToken(cookies[COOKIE]);
  if (!session) {
    // originalUrl, not path: inside a mounted router req.path is router-relative,
    // so /api/admin/content would otherwise be treated as a page request.
    if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
    return res.redirect('/admin/login.html');
  }
  req.session = session;
  next();
}

module.exports = {
  COOKIE, issueToken, verifyToken, parseCookies, setSessionCookie,
  clearSessionCookie, hashPassword, checkPassword, verifyCredentials, requireAuth,
};
