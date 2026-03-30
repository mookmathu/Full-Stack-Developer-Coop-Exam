// ============================================================
// alertController.js
// ============================================================
const db   = require('../config/database');
const { sendSuccess, errors } = require('../utils/response');

const listAlerts = async (req, res) => {
  const { severity, affected_resource_type, affected_resource_id, message } = req.query;
  let sql = `SELECT a.*, r.rule_key, r.name as rule_name FROM alerts a
             JOIN alert_rules r ON a.rule_id = r.id WHERE 1=1`;
  const params = [];

  if (severity)               { sql += ' AND a.severity = ?';                params.push(severity); }
  if (affected_resource_type) { sql += ' AND a.affected_resource_type = ?';  params.push(affected_resource_type); }
  if (affected_resource_id)   { sql += ' AND a.affected_resource_id = ?';    params.push(affected_resource_id); }
  if (message)                { sql += ' AND a.message LIKE ?';              params.push(`%${message}%`); }

  sql += ' ORDER BY a.triggered_at DESC';

  try {
    const [rows] = await db.execute(sql, params);
    return sendSuccess(res, rows);
  } catch (err) {
    return errors.server(res);
  }
};

const markRead = async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT id FROM alerts WHERE id = ?', [req.params.id]);
    if (!rows.length) return errors.notFound(res, 'Alert');
    await db.execute('UPDATE alerts SET is_read = 1 WHERE id = ?', [req.params.id]);
    return sendSuccess(res, { id: req.params.id, is_read: true });
  } catch (err) {
    return errors.server(res);
  }
};

// ============================================================
// dashboardController.js
// ============================================================
const getDashboardDb = db;

const getSummary = async (req, res) => {
  try {
    const [[totalVehicles]] = await getDashboardDb.execute('SELECT COUNT(*) as count FROM vehicles WHERE status != "RETIRED"');
    // Active Trips Today = trip ที่กำลังวิ่งอยู่ตอนนี้ (IN_PROGRESS ทั้งหมด)
    // ไม่กรองด้วย created_at เพราะ trip ที่เริ่มเมื่อวานแต่ยังวิ่งอยู่ต้องนับด้วย
    const [[activeTrips]] = await getDashboardDb.execute(
      'SELECT COUNT(*) as count FROM trips WHERE status = "IN_PROGRESS"'
    );
    const [[totalDistance]] = await getDashboardDb.execute(
      'SELECT COALESCE(SUM(distance_km), 0) as total FROM trips WHERE status = "COMPLETED" AND DATE(ended_at) = CURDATE()'
    );
    const [[overdue]] = await getDashboardDb.execute(
      'SELECT COUNT(*) as count FROM maintenances WHERE status = "SCHEDULED" AND scheduled_at < NOW() - INTERVAL 3 DAY'
    );

    return sendSuccess(res, {
      total_vehicles:         totalVehicles.count,
      active_trips_today:     activeTrips.count,
      total_distance_today_km: totalDistance.total,
      maintenance_overdue:    overdue.count,
    });
  } catch (err) {
    return errors.server(res);
  }
};

const getChartData = async (req, res) => {
  try {
    // Pie: vehicles by status
    const [byStatus] = await getDashboardDb.execute(
      'SELECT status, COUNT(*) as count FROM vehicles GROUP BY status'
    );

    // Line: trip distance trend last 7 days
    const [distanceTrend] = await getDashboardDb.execute(
      `SELECT DATE(COALESCE(ended_at, created_at)) as date,
              COALESCE(SUM(distance_km), 0) as total_km,
              COUNT(*) as trips_count
       FROM trips
       WHERE created_at >= NOW() - INTERVAL 7 DAY AND status = 'COMPLETED'
       GROUP BY DATE(COALESCE(ended_at, created_at))
       ORDER BY date ASC`
    );

    return sendSuccess(res, { vehicles_by_status: byStatus, distance_trend_7d: distanceTrend });
  } catch (err) {
    return errors.server(res);
  }
};

// ============================================================
// auditController.js
// ============================================================
const listLogs = async (req, res) => {
  const { user_id, action, resource_type, date_from, date_to } = req.query;

  let sql = `SELECT a.*, u.username FROM audit_logs a
             LEFT JOIN users u ON a.user_id = u.id WHERE 1=1`;
  const params = [];

  // Dispatcher เห็นเฉพาะ log ของตัวเอง
  if (req.user.role === 'dispatcher') {
    sql += ' AND a.user_id = ?';
    params.push(req.user.id);
  } else if (user_id) {
    sql += ' AND a.user_id = ?';
    params.push(user_id);
  }

  if (action)        { sql += ' AND a.action = ?';        params.push(action); }
  if (resource_type) { sql += ' AND a.resource_type = ?'; params.push(resource_type); }
  if (date_from)     { sql += ' AND a.created_at >= ?';   params.push(date_from); }
  if (date_to)       { sql += ' AND a.created_at <= ?';   params.push(date_to); }

  sql += ' ORDER BY a.created_at DESC LIMIT 500';

  try {
    const [rows] = await db.execute(sql, params);
    return sendSuccess(res, rows);
  } catch (err) {
    return errors.server(res);
  }
};

// ============================================================
// maintenanceController.js
// ============================================================
const listMaintenance = async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT m.*, v.license_plate, v.brand, v.model,
        CASE
          WHEN m.status = 'SCHEDULED' AND m.scheduled_at < NOW() - INTERVAL 3 DAY THEN 'OVERDUE'
          WHEN m.status = 'SCHEDULED' AND m.scheduled_at BETWEEN NOW() AND NOW() + INTERVAL 7 DAY THEN 'DUE'
          ELSE m.status
        END as display_status
       FROM maintenances m JOIN vehicles v ON m.vehicle_id = v.id
       ORDER BY m.scheduled_at ASC`
    );
    return sendSuccess(res, rows);
  } catch (err) {
    return errors.server(res);
  }
};

const updateMaintenanceStatus = async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['SCHEDULED','IN_PROGRESS','COMPLETED'];
  if (!validStatuses.includes(status)) {
    return errors.validation(res, `status must be one of: ${validStatuses.join(', ')}`);
  }
  try {
    const [rows] = await db.execute('SELECT * FROM maintenances WHERE id = ?', [req.params.id]);
    if (!rows.length) return errors.notFound(res, 'Maintenance');
    await db.execute('UPDATE maintenances SET status = ? WHERE id = ?', [status, req.params.id]);
    const [updated] = await db.execute('SELECT * FROM maintenances WHERE id = ?', [req.params.id]);
    return sendSuccess(res, updated[0]);
  } catch (err) {
    return errors.server(res);
  }
};

// Trip Draft handlers (multi-step form)
const tripDraftGetSave = {
  getDraft: async (req, res) => {
    try {
      const [rows] = await db.execute(
        'SELECT * FROM trip_drafts WHERE user_id = ? AND session_key = ?',
        [req.user.id, req.params.sessionKey]
      );
      if (!rows.length) return sendSuccess(res, null);
      return sendSuccess(res, rows[0]);
    } catch (err) {
      return errors.server(res);
    }
  },
  saveDraft: async (req, res) => {
    const { step1_data, step2_data, current_step } = req.body;
    try {
      await db.execute(
        `INSERT INTO trip_drafts (user_id, session_key, step1_data, step2_data, current_step)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           step1_data = VALUES(step1_data), step2_data = VALUES(step2_data),
           current_step = VALUES(current_step), updated_at = NOW()`,
        [req.user.id, req.params.sessionKey,
         step1_data ? JSON.stringify(step1_data) : null,
         step2_data ? JSON.stringify(step2_data) : null,
         current_step || 1]
      );
      return sendSuccess(res, { saved: true });
    } catch (err) {
      return errors.server(res);
    }
  },
  deleteDraft: async (req, res) => {
    try {
      await db.execute(
        'DELETE FROM trip_drafts WHERE user_id = ? AND session_key = ?',
        [req.user.id, req.params.sessionKey]
      );
      return sendSuccess(res, { deleted: true });
    } catch (err) {
      return errors.server(res);
    }
  },
};

module.exports = {
  // Alert
  listAlerts, markRead,
  // Dashboard
  getSummary, getChartData,
  // Audit
  listLogs,
  // Maintenance
  listMaintenance, updateStatus: updateMaintenanceStatus,
  // Trip Drafts
  ...tripDraftGetSave,
};