import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import { db } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { errorResponse } from "../utils/error.js";
import { validateTripTransition, validateCheckpointTransition } from "../utils/Statustransition.js";

const router = express.Router();

// GET /trips  (?status=IN_PROGRESS&vehicle_id=xxx)
router.get("/", authMiddleware(["ADMIN", "DISPATCHER"]), async (req, res) => {
  const { status, vehicle_id, driver_id } = req.query;
  let query = `
    SELECT t.*, v.license_plate, d.name AS driver_name
    FROM trips t
    JOIN vehicles v ON t.vehicle_id = v.id
    JOIN drivers  d ON t.driver_id  = d.id
    WHERE 1=1
  `;
  const params = [];
  if (status)     { query += " AND t.status = ?";     params.push(status); }
  if (vehicle_id) { query += " AND t.vehicle_id = ?"; params.push(vehicle_id); }
  if (driver_id)  { query += " AND t.driver_id = ?";  params.push(driver_id); }
  query += " ORDER BY t.created_at DESC";

  const [trips] = await db.query(query, params);
  res.json({ filters: { status: status || null, vehicle_id: vehicle_id || null }, trips });
});

// POST /trips — start trip (vehicle must be IDLE or ACTIVE → ACTIVE)
router.post("/", authMiddleware(["ADMIN", "DISPATCHER"]), async (req, res) => {
  const { vehicle_id, driver_id, origin, destination,
          distance_km, cargo_type, cargo_weight_kg } = req.body;

  if (!vehicle_id || !driver_id || !origin || !destination) {
    return res.status(400).json(
      errorResponse("VALIDATION", "vehicle_id, driver_id, origin, destination are required")
    );
  }

  const [vehicles] = await db.query("SELECT * FROM vehicles WHERE id = ?", [vehicle_id]);
  if (!vehicles.length) return res.status(404).json(errorResponse("NOT_FOUND", "Vehicle not found"));

  const [drivers] = await db.query("SELECT * FROM drivers WHERE id = ?", [driver_id]);
  if (!drivers.length) return res.status(404).json(errorResponse("NOT_FOUND", "Driver not found"));

  const vehicle = vehicles[0];
  const driver  = drivers[0];

  // Vehicle must be IDLE or ACTIVE (not MAINTENANCE or RETIRED)
  if (!["IDLE", "ACTIVE"].includes(vehicle.status)) {
    return res.status(422).json(
      errorResponse("INVALID_TRANSITION",
        `Vehicle is "${vehicle.status}" — must be IDLE or ACTIVE to start a trip`)
    );
  }

  if (driver.status !== "ACTIVE") {
    return res.status(422).json(
      errorResponse("DRIVER_UNAVAILABLE",
        `Driver is "${driver.status}" — must be ACTIVE to start a trip`)
    );
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const tripId = uuidv4();
    await conn.query(
      `INSERT INTO trips
         (id, vehicle_id, driver_id, status, origin, destination,
          distance_km, cargo_type, cargo_weight_kg, started_at)
       VALUES (?, ?, ?, 'IN_PROGRESS', ?, ?, ?, ?, ?, NOW())`,
      [tripId, vehicle_id, driver_id, origin, destination,
       distance_km || null, cargo_type || null, cargo_weight_kg || null]
    );

    await conn.query(
      "UPDATE vehicles SET status = 'ACTIVE', driver_id = ? WHERE id = ?",
      [driver_id, vehicle_id]
    );

    await conn.commit();
    res.status(201).json({ message: "Trip started", id: tripId });
  } catch (err) {
    await conn.rollback();
    res.status(500).json(errorResponse("DB_ERROR", err.message));
  } finally {
    conn.release();
  }
});

// PATCH /trips/:id/status — validated transition
router.patch("/:id/status", authMiddleware(["ADMIN", "DISPATCHER"]), async (req, res) => {
  const { id } = req.params;
  const { status: newStatus } = req.body;

  const [rows] = await db.query("SELECT * FROM trips WHERE id = ?", [id]);
  if (!rows.length) return res.status(404).json(errorResponse("NOT_FOUND", "Trip not found"));

  const trip = rows[0];
  const { allowed, message } = validateTripTransition(trip.status, newStatus);
  if (!allowed) return res.status(422).json(errorResponse("INVALID_TRANSITION", message));

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const isTerminal = ["COMPLETED", "CANCELLED"].includes(newStatus);
    await conn.query(
      `UPDATE trips SET status = ?, ${isTerminal ? "ended_at = NOW()," : ""} updated_at = NOW() WHERE id = ?`,
      [newStatus, id]
    );

    // Release vehicle when trip ends
    if (isTerminal) {
      await conn.query(
        "UPDATE vehicles SET status = 'IDLE', driver_id = NULL WHERE id = ?",
        [trip.vehicle_id]
      );
    }

    await conn.commit();
    res.json({
      message: `Trip status: ${trip.status} → ${newStatus}`,
      trip_id: id, previous: trip.status, current: newStatus,
    });
  } catch (err) {
    await conn.rollback();
    res.status(500).json(errorResponse("DB_ERROR", err.message));
  } finally {
    conn.release();
  }
});

// GET /trips/:id — with checkpoints + visual progress
router.get("/:id", authMiddleware(["ADMIN", "DISPATCHER"]), async (req, res) => {
  const [rows] = await db.query(
    `SELECT t.*, v.license_plate, d.name AS driver_name, d.phone AS driver_phone
     FROM trips t
     JOIN vehicles v ON t.vehicle_id = v.id
     JOIN drivers  d ON t.driver_id  = d.id
     WHERE t.id = ?`, [req.params.id]
  );
  if (!rows.length) return res.status(404).json(errorResponse("NOT_FOUND", "Trip not found"));

  const trip = rows[0];

  const [checkpoints] = await db.query(
    `SELECT * FROM checkpoints WHERE trip_id = ? ORDER BY sequence ASC`,
    [trip.id]
  );

  // Calculate visual progress from checkpoints
  const total     = checkpoints.length;
  const done      = checkpoints.filter(c => ["ARRIVED","DEPARTED","SKIPPED"].includes(c.status)).length;
  const pct       = total > 0 ? Math.round((done / total) * 100) : (trip.status === "COMPLETED" ? 100 : 0);
  const filledBlocks = Math.round(pct / 5);
  const progressBar  = "█".repeat(filledBlocks) + "░".repeat(20 - filledBlocks);

  res.json({
    ...trip,
    checkpoints,
    progress: {
      percent: pct,
      bar: `[${progressBar}] ${pct}%`,
      checkpoints_done: done,
      checkpoints_total: total,
      label: getProgressLabel(pct, trip.status),
    },
  });
});

// ── Checkpoints ──────────────────────────────────────────────────────────────

// POST /trips/:id/checkpoints
router.post("/:id/checkpoints", authMiddleware(["ADMIN", "DISPATCHER"]), async (req, res) => {
  const { id: tripId } = req.params;
  const { sequence, location_name, latitude, longitude, purpose, notes } = req.body;

  if (!sequence || !location_name) {
    return res.status(400).json(errorResponse("VALIDATION", "sequence and location_name are required"));
  }

  const [trips] = await db.query("SELECT id FROM trips WHERE id = ?", [tripId]);
  if (!trips.length) return res.status(404).json(errorResponse("NOT_FOUND", "Trip not found"));

  const cpId = uuidv4();
  await db.query(
    `INSERT INTO checkpoints (id, trip_id, sequence, location_name, latitude, longitude, purpose, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [cpId, tripId, sequence, location_name, latitude || null, longitude || null, purpose || null, notes || null]
  );

  res.status(201).json({ message: "Checkpoint created", id: cpId });
});

// PATCH /trips/:tripId/checkpoints/:cpId/status
router.patch("/:tripId/checkpoints/:cpId/status",
  authMiddleware(["ADMIN", "DISPATCHER"]), async (req, res) => {
  const { tripId, cpId } = req.params;
  const { status: newStatus } = req.body;

  const [rows] = await db.query(
    "SELECT * FROM checkpoints WHERE id = ? AND trip_id = ?", [cpId, tripId]
  );
  if (!rows.length) return res.status(404).json(errorResponse("NOT_FOUND", "Checkpoint not found"));

  const cp = rows[0];
  const { allowed, message } = validateCheckpointTransition(cp.status, newStatus);
  if (!allowed) return res.status(422).json(errorResponse("INVALID_TRANSITION", message));

  const timeField = newStatus === "ARRIVED" ? ", arrived_at = NOW()"
                  : newStatus === "DEPARTED" ? ", departed_at = NOW()" : "";

  await db.query(
    `UPDATE checkpoints SET status = ? ${timeField} WHERE id = ?`,
    [newStatus, cpId]
  );

  res.json({ message: `Checkpoint: ${cp.status} → ${newStatus}`, checkpoint_id: cpId });
});

function getProgressLabel(pct, tripStatus) {
  if (tripStatus === "COMPLETED") return "✅ Completed";
  if (tripStatus === "CANCELLED") return "❌ Cancelled";
  if (pct === 0)   return "🕐 Not started";
  if (pct < 25)    return "🚀 Departing";
  if (pct < 50)    return "🚗 En route";
  if (pct < 75)    return "📍 Halfway there";
  if (pct < 100)   return "🏁 Approaching destination";
  return "✅ Arrived";
}

export default router;