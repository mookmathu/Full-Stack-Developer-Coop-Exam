const bcrypt = require('bcrypt');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const db     = require('../config/database');
const { sendSuccess, errors } = require('../utils/response');
const audit  = require('../middleware/auditLog');

// Helper: สร้าง token คู่
const generateTokens = (user) => {
  const payload = { id: user.id, username: user.username, role: user.role };

  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
  });

  const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  });

  return { accessToken, refreshToken };
};

// POST /auth/login
const login = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return errors.validation(res, 'username and password are required');
  }

  try {
    const [rows] = await db.execute('SELECT * FROM users WHERE username = ?', [username]);
    const user = rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      await audit.log({
        action: audit.ACTIONS.LOGIN_FAILED,
        newValues: { username },
        ipAddress: req.ip,
      });
      return errors.unauthorized(res, 'Invalid username or password');
    }

    const { accessToken, refreshToken } = generateTokens(user);

    // Hash refresh token ก่อน save (เพราะเป็น sensitive data)
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await db.execute(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      [user.id, tokenHash, expiresAt]
    );

    // Store refresh token in httpOnly cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge:   7 * 24 * 60 * 60 * 1000,
    });

    await audit.log({
      userId:   user.id,
      action:   audit.ACTIONS.LOGIN_SUCCESS,
      ipAddress: req.ip,
    });

    return sendSuccess(res, {
      accessToken,
      user: { id: user.id, username: user.username, role: user.role },
    });

  } catch (err) {
    console.error('[Auth] login error:', err);
    return errors.server(res);
  }
};

// POST /auth/refresh
const refresh = async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;

  if (!refreshToken) {
    return errors.unauthorized(res, 'No refresh token provided');
  }

  try {
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    // ตรวจสอบว่า token นี้ยังอยู่ใน DB และไม่ถูก revoke
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const [rows] = await db.execute(
      'SELECT * FROM refresh_tokens WHERE token_hash = ? AND is_revoked = 0 AND expires_at > NOW()',
      [tokenHash]
    );

    if (!rows.length) {
      return errors.unauthorized(res, 'Refresh token is invalid or expired');
    }

    // ดึง user ใหม่ (เผื่อ role เปลี่ยน)
    const [users] = await db.execute('SELECT * FROM users WHERE id = ?', [payload.id]);
    if (!users.length) return errors.unauthorized(res, 'User not found');

    const { accessToken } = generateTokens(users[0]);
    return sendSuccess(res, { accessToken });

  } catch (err) {
    if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
      // Revoke token ใน DB
      try {
        const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
        await db.execute('UPDATE refresh_tokens SET is_revoked = 1 WHERE token_hash = ?', [tokenHash]);
      } catch (_) {}

      res.clearCookie('refreshToken');
      return errors.unauthorized(res, 'Refresh token expired. Please login again.');
    }
    console.error('[Auth] refresh error:', err);
    return errors.server(res);
  }
};

// POST /auth/logout
const logout = async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;
  if (refreshToken) {
    try {
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      await db.execute('UPDATE refresh_tokens SET is_revoked = 1 WHERE token_hash = ?', [tokenHash]);
    } catch (_) {}
  }
  res.clearCookie('refreshToken');
  return sendSuccess(res, { message: 'Logged out successfully' });
};

module.exports = { login, refresh, logout };
