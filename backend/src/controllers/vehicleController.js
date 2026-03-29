const db     = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { sendSuccess, errors } = require('../utils/response');
const audit  = require('../middleware/auditLog');

// Vehicle status transition rules
const STATUS_TRANSITIONS = {
  IDLE:        ['ACTIVE', 'MAINTENANCE', 'RETIRED'],
  ACTIVE:      ['IDLE', 'MAINTENANCE'],
  MAINTENANCE: ['IDLE'],
  RETIRED:     [],
};

// POST /vehicles
const createVehicle = async (req, res) => {
  const { license_plate, type, driver_id, brand, model, year, fuel_type,
          mileage_km, last_service_km, next_service_km } = req.body;

  if (!license_plate || !type) {
    return errors.validation(res, 'license_plate and type are required');
  }

  const validTypes = ['TRUCK','VAN','MOTORCYCLE','PICKUP'];
  if (!validTypes.includes(type)) {
    return errors.validation(res, `type must be one of: ${validTypes.join(', ')}`);
  }

  try {
    // ตรวจ license_plate ซ้ำ
    const [existing] = await db.execute('SELECT id FROM vehicles WHERE license_plate = ?', [license_plate]);
    if (existing.length) {
      return errors.conflict(res, `License plate '${license_plate}' already exists`);
    }

    // ตรวจ driver exists ถ้า assign
    if (driver_id) {
      const [drv] = await db.execute('SELECT id FROM drivers WHERE id = ?', [driver_id]);
      if (!drv.length) return errors.notFound(res, 'Driver');
    }

    const id = 'veh_' + uuidv4().slice(0, 8);
    await db.execute(
      `INSERT INTO vehicles (id, license_plate, type, driver_id, brand, model, year, fuel_type,
        mileage_km, last_service_km, next_service_km)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, license_plate, type, driver_id||null, brand||null, model||null,
       year||null, fuel_type||null, mileage_km||0, last_service_km||0, next_service_km||0]
    );

    await audit.log({
      userId: req.user.id, action: audit.ACTIONS.VEHICLE_CREATED,
      resourceType: 'vehicle', resourceId: id,
      newValues: req.body, ipAddress: req.ip,
    });

    const [created] = await db.execute('SELECT * FROM vehicles WHERE id = ?', [id]);
    return sendSuccess(res, created[0], 201);

  } catch (err) {
    console.error('[Vehicle] create error:', err);
    return errors.server(res);
  }
};

// GET /vehicles  (with filter: q, status, type, driver_id)
const listVehicles = async (req, res) => {
  const { q, status, type, driver_id } = req.query;

  let sql    = `SELECT v.*, d.name as driver_name FROM vehicles v
                LEFT JOIN drivers d ON v.driver_id = d.id WHERE 1=1`;
  const params = [];

  if (q) {
    sql += ' AND (v.license_plate LIKE ? OR v.brand LIKE ? OR v.model LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (status) { sql += ' AND v.status = ?';    params.push(status); }
  if (type)   { sql += ' AND v.type = ?';      params.push(type); }
  if (driver_id) { sql += ' AND v.driver_id = ?'; params.push(driver_id); }

  sql += ' ORDER BY v.created_at DESC';

  try {
    const [rows] = await db.execute(sql, params);
    return sendSuccess(res, rows);
  } catch (err) {
    return errors.server(res);
  }
};

// GET /vehicles/:id
const getVehicle = async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT v.*, d.name as driver_name FROM vehicles v LEFT JOIN drivers d ON v.driver_id = d.id WHERE v.id = ?',
      [req.params.id]
    );
    if (!rows.length) return errors.notFound(res, 'Vehicle');
    return sendSuccess(res, rows[0]);
  } catch (err) {
    return errors.server(res);
  }
};

// PATCH /vehicles/:id/status  — vehicle status transition
const updateStatus = async (req, res) => {
  const { id } = req.params;
  const { status: newStatus } = req.body;

  try {
    const [rows] = await db.execute('SELECT * FROM vehicles WHERE id = ?', [id]);
    if (!rows.length) return errors.notFound(res, 'Vehicle');

    const vehicle    = rows[0];
    const allowed    = STATUS_TRANSITIONS[vehicle.status] || [];

    if (!newStatus) {
      return errors.validation(res, 'status is required', { allowed_next: allowed });
    }
    if (!allowed.includes(newStatus)) {
      return errors.badTransition(res, vehicle.status, allowed);
    }

    await db.execute('UPDATE vehicles SET status = ? WHERE id = ?', [newStatus, id]);

    await audit.log({
      userId: req.user.id, action: audit.ACTIONS.VEHICLE_UPDATED,
      resourceType: 'vehicle', resourceId: id,
      oldValues: { status: vehicle.status }, newValues: { status: newStatus },
      ipAddress: req.ip,
    });

    return sendSuccess(res, { id, previous_status: vehicle.status, current_status: newStatus });

  } catch (err) {
    console.error('[Vehicle] updateStatus error:', err);
    return errors.server(res);
  }
};

// DELETE /vehicles/:id
// Business rule: ลบได้เฉพาะ trip status = SCHEDULED เท่านั้น
const deleteVehicle = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.execute('SELECT * FROM vehicles WHERE id = ?', [id]);
    if (!rows.length) return errors.notFound(res, 'Vehicle');

    // ตรวจสอบ active trips
    const [activeTrips] = await db.execute(
      `SELECT id, status FROM trips WHERE vehicle_id = ? AND status NOT IN ('SCHEDULED','CANCELLED','COMPLETED')`,
      [id]
    );
    if (activeTrips.length) {
      return errors.conflict(res,
        `Cannot delete vehicle with active trip (status: ${activeTrips[0].status}). Only SCHEDULED trips can be cancelled.`
      );
    }

    const oldData = rows[0];
    await db.execute('DELETE FROM vehicles WHERE id = ?', [id]);
    await audit.log({
      userId: req.user.id, action: audit.ACTIONS.VEHICLE_DELETED,
      resourceType: 'vehicle', resourceId: id,
      oldValues: oldData, ipAddress: req.ip,
    });

    return sendSuccess(res, { message: 'Vehicle deleted successfully' });
  } catch (err) {
    return errors.server(res);
  }
};

// GET /vehicles/:id/history  — รวม trips + maintenances เรียงตาม date
const getVehicleHistory = async (req, res) => {
  const { id } = req.params;
  try {
    const [veh] = await db.execute('SELECT id FROM vehicles WHERE id = ?', [id]);
    if (!veh.length) return errors.notFound(res, 'Vehicle');

    const [trips] = await db.execute(
      `SELECT id, 'trip' as type, status, origin, destination, distance_km,
              COALESCE(started_at, created_at) as date
       FROM trips WHERE vehicle_id = ? ORDER BY date DESC`,
      [id]
    );

    const [maint] = await db.execute(
      `SELECT id, 'maintenance' as type, status, type as maintenance_type, scheduled_at as date,
              technician, cost_thb
       FROM maintenances WHERE vehicle_id = ? ORDER BY scheduled_at DESC`,
      [id]
    );

    // Merge + sort by date
    const history = [...trips, ...maint]
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    return sendSuccess(res, history);
  } catch (err) {
    return errors.server(res);
  }
};

module.exports = { createVehicle, listVehicles, getVehicle, updateStatus, deleteVehicle, getVehicleHistory };
