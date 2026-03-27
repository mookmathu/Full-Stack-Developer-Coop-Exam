import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db.js";
import { errorResponse } from "../utils/error.js";
import { JWT_SECRET, JWT_REFRESH_SECRET } from "../middleware/auth.js";
import { writeAudit } from "../utils/audit.js";

const router = express.Router();

// POST /auth/login
router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const ip = req.ip;

  if (!username || !password) {
    return res.status(400).json(
      errorResponse("VALIDATION", "username and password are required")
    );
  }

  const [users] = await db.query(
    "SELECT * FROM users WHERE username = ?", [username]
  );

  if (!users.length) {
    await writeAudit({ userId: "anonymous", action: "LOGIN", resourceType: "users", ip, result: "FAIL", detail: { username } });
    return res.status(401).json(errorResponse("INVALID_CREDENTIALS", "Invalid username or password"));
  }

  const user = users[0];
  const match = await bcrypt.compare(password, user.password_hash);

  if (!match) {
    await writeAudit({ userId: user.id, action: "LOGIN", resourceType: "users", resourceId: user.id, ip, result: "FAIL" });
    return res.status(401).json(errorResponse("INVALID_CREDENTIALS", "Invalid username or password"));
  }

  // Short-lived access token (15 min)
  const accessToken = jwt.sign(
    { id: user.id, role: user.role, username: user.username },
    JWT_SECRET,
    { expiresIn: "15m" }
  );

  // Long-lived refresh token (7 days)
  const refreshToken = jwt.sign({ id: user.id }, JWT_REFRESH_SECRET, { expiresIn: "7d" });

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.query(
    `INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`,
    [uuidv4(), user.id, refreshToken, expiresAt]
  );

  await writeAudit({ userId: user.id, action: "LOGIN", resourceType: "users", resourceId: user.id, ip, result: "SUCCESS" });

  res.json({ accessToken, refreshToken, expiresIn: 900 });
});

// POST /auth/refresh
router.post("/refresh", async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json(errorResponse("MISSING_REFRESH_TOKEN", "refreshToken is required"));
  }

  let decoded;
  try {
    decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
  } catch {
    return res.status(401).json(errorResponse("INVALID_REFRESH_TOKEN", "Refresh token is invalid or expired"));
  }

  const [rows] = await db.query(
    `SELECT * FROM refresh_tokens WHERE token = ? AND user_id = ? AND expires_at > NOW()`,
    [refreshToken, decoded.id]
  );
  if (!rows.length) {
    return res.status(401).json(errorResponse("REFRESH_TOKEN_REVOKED", "Refresh token revoked or expired"));
  }

  const [users] = await db.query("SELECT * FROM users WHERE id = ?", [decoded.id]);
  if (!users.length) {
    return res.status(401).json(errorResponse("USER_NOT_FOUND", "User not found"));
  }

  const user = users[0];
  const newAccessToken = jwt.sign(
    { id: user.id, role: user.role, username: user.username },
    JWT_SECRET,
    { expiresIn: "15m" }
  );

  res.json({ accessToken: newAccessToken, expiresIn: 900 });
});

// POST /auth/logout
router.post("/logout", async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    await db.query("DELETE FROM refresh_tokens WHERE token = ?", [refreshToken]);
  }
  res.json({ message: "Logged out successfully" });
});

export default router;