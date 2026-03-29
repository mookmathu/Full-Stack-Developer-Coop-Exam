const db   = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { sendSuccess, errors } = require('../utils/response');
const audit = require('../middleware/auditLog');

// POST /trips
const createTrip = async (req, res) => {
  const { vehicle_id, driver_id, origin, destination, distance_km,
          cargo_type, cargo_weight_kg, estimated_duration_min } = req.body;

  if (!vehicle_id || !driver_id || !origin || !destination) {
    return errors.validation(res, 'vehicle_id, driver_id, origin, destination are required');
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // ตรวจสอบ vehicle มีอยู่จริงและ status ไม่ใช่ MAINTENANCE/RETIRED
    const [veh] = await conn.execute('SELECT * FROM vehicles WHERE id = ? FOR UPDATE', [vehicle_id]);
    if (!veh.length) { await conn.rollback(); return errors.notFound(res, 'Vehicle'); }
    if (['MAINTENANCE','RETIRED'].includes(veh[0].status)) {
      await conn.rollback();
      return errors.conflict(res, `Vehicle is currently ${veh[0].status} and cannot be assigned a trip`);
    }

    // ตรวจสอบ vehicle ไม่มี trip ที่ overlap ในเวลาเดียวกัน (1 vehicle = 1 trip at a time)
    const [overlap] = await conn.execute(
      `SELECT id FROM trips WHERE vehicle_id = ? AND status IN ('SCHEDULED','IN_PROGRESS')`,
      [vehicle_id]
    );
    if (overlap.length) {
      await conn.rollback();
      return errors.conflict(res, `Vehicle already has an active/scheduled trip (id: ${overlap[0].id})`);
    }

    // ตรวจสอบ driver license ไม่หมดอายุ
    const [drv] = await conn.execute('SELECT * FROM drivers WHERE id = ?', [driver_id]);
    if (!drv.length) { await conn.rollback(); return errors.notFound(res, 'Driver'); }

    const licenseExpiry = new Date(drv[0].license_expires_at);
    if (licenseExpiry < new Date()) {
      await conn.rollback();
      return errors.conflict(res, `Driver's license expired on ${drv[0].license_expires_at}. Cannot assign trip.`);
    }

    const id = 'trp_' + uuidv4().slice(0, 8);
    await conn.execute(
      `INSERT INTO trips (id, vehicle_id, driver_id, status, origin, destination,
        distance_km, cargo_type, cargo_weight_kg, estimated_duration_min, created_by)
       VALUES (?, ?, ?, 'SCHEDULED', ?, ?, ?, ?, ?, ?, ?)`,
      [id, vehicle_id, driver_id, origin, destination, distance_km||null,
       cargo_type||null, cargo_weight_kg||null, estimated_duration_min||null, req.user.id]
    );

    await conn.commit();

    await audit.log({
      userId: req.user.id, action: audit.ACTIONS.TRIP_CREATED,
      resourceType: 'trip', resourceId: id, newValues: req.body, ipAddress: req.ip,
    });

    const [created] = await db.execute('SELECT * FROM trips WHERE id = ?', [id]);
    return sendSuccess(res, created[0], 201);

  } catch (err) {
    await conn.rollback();
    console.error('[Trip] create error:', err);
    return errors.server(res);
  } finally {
    conn.release();
  }
};

// PATCH /trips/:id/complete
// Update mileage + check maintenance threshold — ทำใน transaction เดียวกัน
const completeTrip = async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [trips] = await conn.execute('SELECT * FROM trips WHERE id = ? FOR UPDATE', [id]);
    if (!trips.length) { await conn.rollback(); return errors.notFound(res, 'Trip'); }

    const trip = trips[0];
    if (trip.status !== 'IN_PROGRESS') {
      await conn.rollback();
      return errors.conflict(res, `Only IN_PROGRESS trips can be completed. Current status: ${trip.status}`);
    }

    // 1. Complete the trip
    await conn.execute(
      `UPDATE trips SET status = 'COMPLETED', ended_at = NOW() WHERE id = ?`, [id]
    );

    // 2. Update vehicle mileage
    const [veh] = await conn.execute('SELECT * FROM vehicles WHERE id = ? FOR UPDATE', [trip.vehicle_id]);
    const vehicle = veh[0];
    const newMileage = (vehicle.mileage_km || 0) + (trip.distance_km || 0);

    // 3. Check maintenance threshold: mileage >= (next_service_km - 1000) → MAINTENANCE
    const needsMaintenance = newMileage >= (vehicle.next_service_km - 1000);
    const newVehicleStatus = needsMaintenance ? 'MAINTENANCE' : 'IDLE';

    await conn.execute(
      'UPDATE vehicles SET mileage_km = ?, status = ? WHERE id = ?',
      [newMileage, newVehicleStatus, trip.vehicle_id]
    );

    // 4. Auto-create maintenance record ถ้าเข้า MAINTENANCE
    let maintenanceId = null;
    if (needsMaintenance) {
      maintenanceId = 'mnt_' + uuidv4().slice(0, 8);
      await conn.execute(
        `INSERT INTO maintenances (id, vehicle_id, status, type, scheduled_at, mileage_at_service)
         VALUES (?, ?, 'SCHEDULED', 'INSPECTION', NOW(), ?)`,
        [maintenanceId, trip.vehicle_id, newMileage]
      );
    }

    await conn.commit();

    await audit.log({
      userId: req.user.id, action: audit.ACTIONS.TRIP_COMPLETED,
      resourceType: 'trip', resourceId: id,
      newValues: { mileage_added: trip.distance_km, vehicle_status: newVehicleStatus },
      ipAddress: req.ip,
    });

    return sendSuccess(res, {
      trip_id: id, status: 'COMPLETED',
      vehicle_mileage_updated: newMileage,
      vehicle_status: newVehicleStatus,
      maintenance_created: maintenanceId,
    });

  } catch (err) {
    await conn.rollback();
    console.error('[Trip] complete error:', err);
    return errors.server(res);
  } finally {
    conn.release();
  }
};

// PATCH /checkpoints/:id/status
// Sequence: PENDING → ARRIVED → DEPARTED เท่านั้น
const updateCheckpoint = async (req, res) => {
  const { id } = req.params;
  const { status: newStatus } = req.body;

  const validTransitions = { PENDING: 'ARRIVED', ARRIVED: 'DEPARTED' };

  try {
    const [rows] = await db.execute('SELECT * FROM checkpoints WHERE id = ?', [id]);
    if (!rows.length) return errors.notFound(res, 'Checkpoint');

    const chk = rows[0];
    const expected = validTransitions[chk.status];

    if (!expected) {
      return errors.conflict(res, `Checkpoint is already in final status: ${chk.status}`);
    }
    if (newStatus !== expected) {
      return errors.conflict(res,
        `Cannot change status from ${chk.status} to ${newStatus}. Next required status: ${expected}`
      );
    }

    const timeField = newStatus === 'ARRIVED' ? 'arrived_at' : 'departed_at';
    await db.execute(
      `UPDATE checkpoints SET status = ?, ${timeField} = NOW() WHERE id = ?`,
      [newStatus, id]
    );

    await audit.log({
      userId: req.user.id, action: audit.ACTIONS.CHECKPOINT_UPDATED,
      resourceType: 'checkpoint', resourceId: id,
      oldValues: { status: chk.status }, newValues: { status: newStatus },
      ipAddress: req.ip,
    });

    const [updated] = await db.execute('SELECT * FROM checkpoints WHERE id = ?', [id]);
    return sendSuccess(res, updated[0]);

  } catch (err) {
    console.error('[Checkpoint] update error:', err);
    return errors.server(res);
  }
};

// GET /trips
const listTrips = async (req, res) => {
  const { status, vehicle_id, driver_id } = req.query;
  let sql = `SELECT t.*, v.license_plate, d.name as driver_name
             FROM trips t
             JOIN vehicles v ON t.vehicle_id = v.id
             JOIN drivers d ON t.driver_id = d.id WHERE 1=1`;
  const params = [];

  if (status)    { sql += ' AND t.status = ?';    params.push(status); }
  if (vehicle_id){ sql += ' AND t.vehicle_id = ?'; params.push(vehicle_id); }
  if (driver_id) { sql += ' AND t.driver_id = ?';  params.push(driver_id); }

  sql += ' ORDER BY t.created_at DESC';

  try {
    const [rows] = await db.execute(sql, params);
    return sendSuccess(res, rows);
  } catch (err) {
    return errors.server(res);
  }
};

// GET /trips/:id  (with checkpoints)
const getTrip = async (req, res) => {
  try {
    const [trips] = await db.execute(
      `SELECT t.*, v.license_plate, v.brand, v.model, d.name as driver_name
       FROM trips t JOIN vehicles v ON t.vehicle_id = v.id JOIN drivers d ON t.driver_id = d.id
       WHERE t.id = ?`,
      [req.params.id]
    );
    if (!trips.length) return errors.notFound(res, 'Trip');

    const [checkpoints] = await db.execute(
      'SELECT * FROM checkpoints WHERE trip_id = ? ORDER BY sequence ASC',
      [req.params.id]
    );

    return sendSuccess(res, { ...trips[0], checkpoints });
  } catch (err) {
    return errors.server(res);
  }
};

module.exports = { createTrip, completeTrip, updateCheckpoint, listTrips, getTrip };
