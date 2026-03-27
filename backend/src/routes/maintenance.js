import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import { db } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { errorResponse } from "../utils/error.js";
import { validateMaintenanceTransition } from "../utils/Statustransition.js";

const router = express.Router();

// GET /maintenance
router.get("/", authMiddleware(["ADMIN", "DISPATCHER"]), async (req, res) => {
  const { status, vehicle_id, type } = req.query;
  let query = `
    SELECT m.*, v.license_plate
    FROM maintenance m
    JOIN vehicles v ON m.vehicle_id = v.id
    WHERE 1=1
  `;
  const params = [];
  if (status)     { query += " AND m.status = ?";     params.push(status); }
  if (vehicle_id) { query += " AND m.vehicle_id = ?"; params.push(vehicle_id); }
  if (type)       { query += " AND m.type = ?";       params.push(type); }
  query += " ORDER BY m.scheduled_at DESC";
  const [rows] = await db.query(query, params);
  res.json({ filters: { status: status || null, type: type || null }, total: rows.length, maintenance: rows });
});

// POST /maintenance
router.post("/", authMiddleware(["ADMIN"]), async (req, res) => {
  const { vehicle_id, type, scheduled_at, technician, cost_thb, notes } = req.body;
  if (!vehicle_id || !type || !scheduled_at) {
    return res.status(400).json(
      errorResponse("VALIDATION", "vehicle_id, type, scheduled_at are required")
    );
  }
  const [vehicles] = await db.query("SELECT id FROM vehicles WHERE id = ?", [vehicle_id]);
  if (!vehicles.length) return res.status(404).json(errorResponse("NOT_FOUND", "Vehicle not found"));

  const id = uuidv4();
  await db.query(
    `INSERT INTO maintenance (id, vehicle_id, type, scheduled_at, technician, cost_thb, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, vehicle_id, type, scheduled_at, technician || null, cost_thb || null, notes || null]
  );
  res.status(201).json({ message: "Maintenance scheduled", id });
});

// PATCH /maintenance/:id/status — validated transition
router.patch("/:id/status", authMiddleware(["ADMIN"]), async (req, res) => {
  const { id } = req.params;
  const { status: newStatus, cost_thb, technician, mileage_at_service } = req.body;

  const [rows] = await db.query("SELECT * FROM maintenance WHERE id = ?", [id]);
  if (!rows.length) return res.status(404).json(errorResponse("NOT_FOUND", "Maintenance not found"));

  const record = rows[0];
  const { allowed, message } = validateMaintenanceTransition(record.status, newStatus);
  if (!allowed) return res.status(422).json(errorResponse("INVALID_TRANSITION", message));

  const isComplete = newStatus === "COMPLETED";
  await db.query(
    `UPDATE maintenance SET
       status = ?,
       ${isComplete ? "completed_at = NOW()," : ""}
       ${cost_thb !== undefined ? "cost_thb = ?," : ""}
       ${technician ? "technician = ?," : ""}
       ${mileage_at_service ? "mileage_at_service = ?," : ""}
       updated_at = NOW()
     WHERE id = ?`,
    [
      newStatus,
      ...(cost_thb !== undefined ? [cost_thb] : []),
      ...(technician ? [technician] : []),
      ...(mileage_at_service ? [mileage_at_service] : []),
      id,
    ]
  );

  // If completed, release vehicle back to IDLE
  if (isComplete) {
    await db.query(
      `UPDATE vehicles SET status = 'IDLE', last_service_km = mileage_km WHERE id = ?`,
      [record.vehicle_id]
    );
  }

  res.json({ message: `Maintenance: ${record.status} → ${newStatus}`, maintenance_id: id });
});

// GET /maintenance/:id/parts
router.get("/:id/parts", authMiddleware(["ADMIN", "DISPATCHER"]), async (req, res) => {
  const [parts] = await db.query(
    "SELECT * FROM maintenance_parts WHERE maintenance_id = ?", [req.params.id]
  );
  res.json(parts);
});

// POST /maintenance/:id/parts
router.post("/:id/parts", authMiddleware(["ADMIN"]), async (req, res) => {
  const { part_name, part_number, quantity, cost_thb } = req.body;
  if (!part_name) {
    return res.status(400).json(errorResponse("VALIDATION", "part_name is required"));
  }
  const id = uuidv4();
  await db.query(
    `INSERT INTO maintenance_parts (id, maintenance_id, part_name, part_number, quantity, cost_thb)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, req.params.id, part_name, part_number || null, quantity || 1, cost_thb || null]
  );
  res.status(201).json({ message: "Part added", id });
});

export default router;