import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import { db } from "../db.js";
import { errorResponse } from "../utils/error.js";

const router = express.Router();

// GET /audit-logs — filter by user_id, action, resource_type, date range (5.4)
// DISPATCHER sees only own logs; ADMIN sees all
router.get("/", authMiddleware(["ADMIN", "DISPATCHER"]), async (req, res) => {
  const { user_id, action, resource_type, date_from, date_to, limit = 100, offset = 0 } = req.query;
  const user = req.user;

  let query = `
    SELECT
      a.id, a.user_id, u.username,
      a.action, a.resource_type, a.resource_id,
      a.ip_address, a.result, a.detail, a.created_at
    FROM audit_logs a
    LEFT JOIN users u ON a.user_id = u.id
    WHERE 1=1
  `;
  const params = [];

  // DISPATCHER can only see their own logs
  if (user.role === "DISPATCHER") {
    query += " AND a.user_id = ?";
    params.push(user.id);
  } else if (user_id) {
    query += " AND a.user_id = ?";
    params.push(user_id);
  }

  if (action)        { query += " AND a.action = ?";        params.push(action); }
  if (resource_type) { query += " AND a.resource_type = ?"; params.push(resource_type); }
  if (date_from)     { query += " AND a.created_at >= ?";   params.push(date_from); }
  if (date_to)       { query += " AND a.created_at <= ?";   params.push(date_to + " 23:59:59"); }

  query += " ORDER BY a.created_at DESC";
  query += " LIMIT ? OFFSET ?";
  params.push(Number(limit), Number(offset));

  const [rows] = await db.query(query, params);

  // Count total for pagination
  let countQuery = `SELECT COUNT(*) AS total FROM audit_logs a WHERE 1=1`;
  const countParams = [];
  if (user.role === "DISPATCHER") { countQuery += " AND a.user_id = ?"; countParams.push(user.id); }
  else if (user_id)               { countQuery += " AND a.user_id = ?"; countParams.push(user_id); }
  if (action)        { countQuery += " AND a.action = ?";        countParams.push(action); }
  if (resource_type) { countQuery += " AND a.resource_type = ?"; countParams.push(resource_type); }
  if (date_from)     { countQuery += " AND a.created_at >= ?";   countParams.push(date_from); }
  if (date_to)       { countQuery += " AND a.created_at <= ?";   countParams.push(date_to + " 23:59:59"); }

  const [[{ total }]] = await db.query(countQuery, countParams);

  res.json({
    filters: { user_id: user_id || null, action: action || null, resource_type: resource_type || null, date_from: date_from || null, date_to: date_to || null },
    total: Number(total),
    limit: Number(limit),
    offset: Number(offset),
    logs: rows,
  });
});

export default router;