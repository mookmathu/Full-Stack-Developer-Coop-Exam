import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import { db } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { errorResponse } from "../utils/error.js";

const router = express.Router();

// GET /drivers
router.get("/", authMiddleware(["ADMIN", "DISPATCHER"]), async (req, res) => {
  const { status, search } = req.query;
  let query = "SELECT * FROM drivers WHERE 1=1";
  const params = [];
  if (status) { query += " AND status = ?"; params.push(status); }
  if (search) { query += " AND (name LIKE ? OR license_number LIKE ?)"; params.push(`%${search}%`, `%${search}%`); }
  query += " ORDER BY name ASC";
  const [drivers] = await db.query(query, params);
  res.json({ filters: { status: status || null, search: search || null }, total: drivers.length, drivers });
});

// POST /drivers
router.post("/", authMiddleware(["ADMIN"]), async (req, res) => {
  const { name, license_number, license_expires_at, phone } = req.body;
  if (!name || !license_number || !license_expires_at || !phone) {
    return res.status(400).json(
      errorResponse("VALIDATION", "name, license_number, license_expires_at, phone are required")
    );
  }
  const id = uuidv4();
  try {
    await db.query(
      `INSERT INTO drivers (id, name, license_number, license_expires_at, phone)
       VALUES (?, ?, ?, ?, ?)`,
      [id, name, license_number, license_expires_at, phone]
    );
    res.status(201).json({ message: "Driver created", id });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json(errorResponse("DUPLICATE", "License number already exists"));
    }
    res.status(500).json(errorResponse("DB_ERROR", err.message));
  }
});

// PATCH /drivers/:id/status
router.patch("/:id/status", authMiddleware(["ADMIN"]), async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const VALID = ["ACTIVE","INACTIVE","SUSPENDED"];
  if (!VALID.includes(status)) {
    return res.status(400).json(
      errorResponse("VALIDATION", `status must be one of: ${VALID.join(", ")}`)
    );
  }
  const [rows] = await db.query("SELECT * FROM drivers WHERE id = ?", [id]);
  if (!rows.length) return res.status(404).json(errorResponse("NOT_FOUND", "Driver not found"));
  await db.query("UPDATE drivers SET status = ? WHERE id = ?", [status, id]);
  res.json({ message: `Driver status updated to ${status}`, driver_id: id });
});

// GET /drivers/:id
router.get("/:id", authMiddleware(["ADMIN", "DISPATCHER"]), async (req, res) => {
  const [rows] = await db.query("SELECT * FROM drivers WHERE id = ?", [req.params.id]);
  if (!rows.length) return res.status(404).json(errorResponse("NOT_FOUND", "Driver not found"));
  res.json(rows[0]);
});

export default router;