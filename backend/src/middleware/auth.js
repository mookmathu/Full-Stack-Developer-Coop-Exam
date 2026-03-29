const jwt = require('jsonwebtoken');
const { errors } = require('../utils/response');

// Role permission matrix
const PERMISSIONS = {
  dispatcher: ['trips:manage', 'checkpoints:manage', 'vehicles:read', 'drivers:read', 'alerts:read', 'audit:own'],
  admin:      ['trips:manage', 'checkpoints:manage', 'vehicles:manage', 'drivers:manage',
               'alerts:manage', 'audit:all', 'maintenance:manage'],
};

/**
 * Verify JWT access token
 * ถ้า token หมดอายุหรือไม่ถูกต้อง → 401
 */
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return errors.unauthorized(res, 'No token provided');
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;   // { id, username, role }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return errors.unauthorized(res, 'Token expired');
    }
    return errors.unauthorized(res, 'Invalid token');
  }
};

/**
 * Check permission — ใช้หลัง authenticate()
 * ตัวอย่าง: authorize('vehicles:manage')
 */
const authorize = (...requiredPerms) => {
  return (req, res, next) => {
    const userPerms = PERMISSIONS[req.user.role] || [];
    const hasAll = requiredPerms.every(p => userPerms.includes(p));
    if (!hasAll) {
      return errors.forbidden(res, `Role '${req.user.role}' cannot perform this action`);
    }
    next();
  };
};

module.exports = { authenticate, authorize, PERMISSIONS };
