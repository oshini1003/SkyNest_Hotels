const crypto = require('crypto');
const jwt = require('jsonwebtoken');

function validateAuthConfig() {
  const accessSecret = process.env.JWT_SECRET;
  const refreshSecret = process.env.JWT_REFRESH_SECRET;
  if (typeof accessSecret !== 'string' || accessSecret.length < 32 ||
      typeof refreshSecret !== 'string' || refreshSecret.length < 32 ||
      accessSecret === refreshSecret) {
    throw new Error('Set JWT_SECRET and JWT_REFRESH_SECRET to different random values, each at least 32 characters long.');
  }
  const accessExpiresIn = process.env.JWT_ACCESS_EXPIRES_IN || process.env.JWT_EXPIRES_IN || '15m';
  const refreshExpiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
  // Require explicit units: a bare numeric string is interpreted as milliseconds by JWT.
  const duration = /^[1-9][0-9]*(s|m|h|d)$/;
  if (!duration.test(accessExpiresIn) || !duration.test(refreshExpiresIn)) {
    throw new Error('JWT expiry values must be positive durations with units, for example 15m or 7d.');
  }
  return { accessSecret, refreshSecret, accessExpiresIn, refreshExpiresIn };
}

function signAccessToken(payload) {
  const config = validateAuthConfig();
  return jwt.sign({ ...payload, tokenUse: 'access' }, config.accessSecret, {
    algorithm: 'HS256', expiresIn: config.accessExpiresIn,
  });
}

function signRefreshToken(type, id) {
  const config = validateAuthConfig();
  return jwt.sign({ type, id, tokenUse: 'refresh', jti: crypto.randomUUID() }, config.refreshSecret, {
    algorithm: 'HS256', expiresIn: config.refreshExpiresIn,
  });
}

function verifyToken(token, purpose) {
  const config = validateAuthConfig();
  const secret = purpose === 'access' ? config.accessSecret : config.refreshSecret;
  const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
  if (typeof payload !== 'object' || payload.tokenUse !== purpose ||
      !['guest', 'staff'].includes(payload.type) || !Number.isSafeInteger(payload.id) || payload.id < 1 ||
      !Number.isFinite(payload.exp)) {
    throw new Error('Invalid authentication token.');
  }
  return payload;
}

module.exports = {
  validateAuthConfig,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken: (token) => verifyToken(token, 'access'),
  verifyRefreshToken: (token) => verifyToken(token, 'refresh'),
};
