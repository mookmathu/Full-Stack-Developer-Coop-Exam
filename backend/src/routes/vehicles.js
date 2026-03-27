import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import { db } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { errorResponse } from "../utils/error.js";
import { validateVehicleTransition } from "../utils/Statustransition.js";
import { alertEngine } from "../alerts/alertEngine.js";
import { writeAudit } from "../utils/audit.js";

const router = express.Router();

// GET /vehicles  — filters reflect in URL (?status=IDLE&type=VAN&search=กข)
router.get("/", authMiddleware(["ADMIN", "DISPATCHER"]), async (req, res) => {
  const { status, type, search } = req.query;

  let query = `
    SELECT v.*, d.name AS driver_name
    FROM vehicles v
    LEFT JOIN drivers d ON v.driver_id = d.id
    WHERE 1=1
  `;
  const params = [];

  if (status) { query += " AND v.status = ?"; params.push(status); }
  if (type)   { query += " AND v.type = ?";   params.push(type); }
  if (search) { query += " AND v.license_plate LIKE ?"; params.push(`%${search}%`); }

  const [vehicles] = await db.query(query, params);
  res.json({
    filters: { status: status || null, type: type || null, search: search || null },
    total: vehicles.length,
    vehicles,
  });
});

// GET /vehicles/alerts
router.get("/alerts", authMiddleware(["ADMIN"]), async (req, res) => {
  const [vehicles] = await db.query("SELECT * FROM vehicles");
  const alerts = await alertEngine.evaluateAll(vehicles, db);
  res.json({ total: alerts.length, alerts });
});

// POST /vehicles
router.post("/", authMiddleware(["ADMIN"]), async (req, res) => {
  const { license_plate, type, brand, model, year, fuel_type,
          driver_id, mileage_km, next_service_km } = req.body;

  if (!license_plate || !type) {
    return res.status(400).json(
      errorResponse("VALIDATION", "license_plate and type are required")
    );
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const vehicleId = uuidv4();
    const mileage   = mileage_km || 0;
    const nextSvc   = next_service_km || null;

    await conn.query(
      `INSERT INTO vehicles
         (id, license_plate, type, brand, model, year, fuel_type,
          driver_id, mileage_km, next_service_km)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [vehicleId, license_plate, type, brand || null, model || null,
       year || null, fuel_type || null, driver_id || null, mileage, nextSvc]
    );

    // Auto-schedule maintenance if mileage already >= next_service_km
    if (nextSvc && mileage >= nextSvc) {
      await conn.query(
        `INSERT INTO maintenance (id, vehicle_id, type, status, scheduled_at, mileage_at_service)
         VALUES (?, ?, 'INSPECTION', 'SCHEDULED', NOW(), ?)`,
        [uuidv4(), vehicleId, mileage]
      );
      await conn.query(
        `UPDATE vehicles SET status = 'MAINTENANCE' WHERE id = ?`, [vehicleId]
      );
    }

    await conn.commit();

    await writeAudit({
      userId: req.user.id, action: "CREATE_VEHICLE",
      resourceType: "vehicles", resourceId: vehicleId,
      ip: req.ip, result: "SUCCESS", detail: { license_plate, type },
    });

    res.status(201).json({ message: "Vehicle created", id: vehicleId });
  } catch (err) {
    await conn.rollback();
    res.status(500).json(errorResponse("DB_ERROR", err.message));
  } finally {
    conn.release();
  }
});

// PATCH /vehicles/:id/status — validate transition, block with error message
router.patch("/:id/status", authMiddleware(["ADMIN"]), async (req, res) => {
  const { id } = req.params;
  const { status: newStatus } = req.body;

  if (!newStatus) {
    return res.status(400).json(errorResponse("VALIDATION", "status is required"));
  }

  const [rows] = await db.query("SELECT * FROM vehicles WHERE id = ?", [id]);
  if (!rows.length) {
    return res.status(404).json(errorResponse("NOT_FOUND", "Vehicle not found"));
  }

  const vehicle = rows[0];
  const { allowed, message } = validateVehicleTransition(vehicle.status, newStatus);
  if (!allowed) {
    return res.status(422).json(errorResponse("INVALID_TRANSITION", message));
  }

  await db.query("UPDATE vehicles SET status = ? WHERE id = ?", [newStatus, id]);

  await writeAudit({
    userId: req.user.id, action: "UPDATE_VEHICLE_STATUS",
    resourceType: "vehicles", resourceId: id, ip: req.ip, result: "SUCCESS",
    detail: { from: vehicle.status, to: newStatus },
  });

  res.json({
    message: `Status updated: ${vehicle.status} → ${newStatus}`,
    vehicle_id: id, previous_status: vehicle.status, new_status: newStatus,
  });
});

// PATCH /vehicles/:id/mileage — update mileage + auto maintenance in ONE transaction
router.patch("/:id/mileage", authMiddleware(["ADMIN", "DISPATCHER"]), async (req, res) => {
  const { id } = req.params;
  const { mileage_km } = req.body;

  if (mileage_km == null) {
    return res.status(400).json(errorResponse("VALIDATION", "mileage_km is required"));
  }

  const [rows] = await db.query("SELECT * FROM vehicles WHERE id = ?", [id]);
  if (!rows.length) {
    return res.status(404).json(errorResponse("NOT_FOUND", "Vehicle not found"));
  }

  const vehicle = rows[0];
  if (mileage_km < vehicle.mileage_km) {
    return res.status(400).json(
      errorResponse("VALIDATION",
        `New mileage (${mileage_km}) cannot be less than current (${vehicle.mileage_km})`)
    );
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      "UPDATE vehicles SET mileage_km = ?, last_service_km = last_service_km WHERE id = ?",
      [mileage_km, id]
    );

    let maintenanceCreated = false;

    // Crossed next_service_km threshold → auto-create maintenance record (same tx)
    if (
      vehicle.next_service_km &&
      vehicle.mileage_km < vehicle.next_service_km &&
      mileage_km >= vehicle.next_service_km
    ) {
      await conn.query(
        `INSERT INTO maintenance (id, vehicle_id, type, status, scheduled_at, mileage_at_service)
         VALUES (?, ?, 'INSPECTION', 'SCHEDULED', NOW(), ?)`,
        [uuidv4(), id, mileage_km]
      );
      await conn.query(
        "UPDATE vehicles SET status = 'MAINTENANCE' WHERE id = ?", [id]
      );
      maintenanceCreated = true;
    }

    await conn.commit();

    res.json({
      message: "Mileage updated",
      vehicle_id: id,
      previous_mileage: vehicle.mileage_km,
      new_mileage: mileage_km,
      maintenance_scheduled: maintenanceCreated,
    });
  } catch (err) {
    await conn.rollback();
    res.status(500).json(errorResponse("DB_ERROR", err.message));
  } finally {
    conn.release();
  }
});

// GET /vehicles/:id/history
router.get("/:id/history", authMiddleware(["ADMIN", "DISPATCHER"]), async (req, res) => {
  const { id } = req.params;
  const [check] = await db.query("SELECT id FROM vehicles WHERE id = ?", [id]);
  if (!check.length) return res.status(404).json(errorResponse("NOT_FOUND", "Vehicle not found"));

  const [trips] = await db.query(
    `SELECT id, started_at AS date, 'TRIP' AS type, status, origin, destination
     FROM trips WHERE vehicle_id = ? ORDER BY started_at DESC`, [id]
  );
  const [maintenances] = await db.query(
    `SELECT m.id, m.scheduled_at AS date, 'MAINTENANCE' AS type,
            m.status, m.type AS subtype, m.cost_thb, m.technician
     FROM maintenance m WHERE m.vehicle_id = ? ORDER BY m.scheduled_at DESC`, [id]
  );

  const history = [...trips, ...maintenances].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );
  res.json(history);
});

// GET /vehicles/:id
router.get("/:id", authMiddleware(["ADMIN", "DISPATCHER"]), async (req, res) => {
  const [rows] = await db.query(
    `SELECT v.*, d.name AS driver_name, d.phone AS driver_phone
     FROM vehicles v LEFT JOIN drivers d ON v.driver_id = d.id
     WHERE v.id = ?`, [req.params.id]
  );
  if (!rows.length) return res.status(404).json(errorResponse("NOT_FOUND", "Vehicle not found"));
  res.json(rows[0]);
});

export default router;