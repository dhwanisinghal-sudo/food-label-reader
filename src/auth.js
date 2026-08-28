/**
 * auth.js
 * JWT issuing + verification for the signup/login flow.
 *
 * JWT_SECRET must be set in .env for real deployments. A dev fallback is
 * provided so the app doesn't crash on first run, but it logs a loud
 * warning — anyone using the fallback in production can forge tokens.
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'insecure-dev-secret-do-not-use-in-production';
const TOKEN_EXPIRY = '30d';

if (!process.env.JWT_SECRET) {
  console.warn(
    'JWT_SECRET not set in .env — using an insecure dev fallback. '
    + 'Set a real JWT_SECRET before deploying, or existing sessions will be '
    + 'forgeable and will all be invalidated whenever this fallback changes.',
  );
}

function issueToken(user) {
  return jwt.sign({ userId: user._id.toString(), email: user.email }, JWT_SECRET, {
    expiresIn: TOKEN_EXPIRY,
  });
}

// Requires a valid token — rejects the request if missing/invalid/expired.
// Use on routes that must be tied to a specific account (analyze, history).
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Not logged in. Include an Authorization: Bearer <token> header.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    req.userEmail = payload.email;
    next();
  } catch (err) {
    return res.status(401).json({ error: `Invalid or expired session: ${err.message}` });
  }
}

module.exports = { issueToken, requireAuth, JWT_SECRET };
