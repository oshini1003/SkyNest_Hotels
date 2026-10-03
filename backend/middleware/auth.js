const { verifyAccessToken } = require('../config/auth');

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication token missing.' });
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = payload; // { type: 'guest'|'staff', id, role?, username }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || req.user.type !== 'staff' || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    next();
  };
}

/** Restricts a route to authenticated staff of any role (any front-desk/manager/service account) */
function requireStaff(req, res, next) {
  if (!req.user || req.user.type !== 'staff') {
    return res.status(403).json({ error: 'Staff access only.' });
  }
  next();
}

/** Restricts a route to authenticated guests */
function requireGuest(req, res, next) {
  if (!req.user || req.user.type !== 'guest') {
    return res.status(403).json({ error: 'Guest access only.' });
  }
  next();
}

module.exports = { authenticate, requireRole, requireStaff, requireGuest };
