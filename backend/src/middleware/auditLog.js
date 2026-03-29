const db = require('../config/database');

/**
 * บันทึก audit log — append-only เสมอ
 * ไม่ throw error ถ้า insert fail เพื่อไม่ให้กระทบ main request
 */
const log = async ({ userId, action, resourceType, resourceId, oldValues, newValues, ipAddress }) => {
  try {
    await db.execute(
      `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, old_values, new_values, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId     || null,
        action,
        resourceType || null,
        resourceId   || null,
        oldValues    ? JSON.stringify(oldValues) : null,
        newValues    ? JSON.stringify(newValues) : null,
        ipAddress    || null,
      ]
    );
  } catch (err) {
    console.error('[AuditLog] Failed to write log:', err.message);
  }
};

// Action constants — ใช้ค่าเหล่านี้เพื่อ consistent ทั่วทั้งระบบ
const ACTIONS = {
  LOGIN_SUCCESS:     'LOGIN_SUCCESS',
  LOGIN_FAILED:      'LOGIN_FAILED',
  LOGOUT:            'LOGOUT',
  VEHICLE_CREATED:   'VEHICLE_CREATED',
  VEHICLE_UPDATED:   'VEHICLE_UPDATED',
  VEHICLE_DELETED:   'VEHICLE_DELETED',
  DRIVER_ASSIGNED:   'DRIVER_ASSIGNED',
  TRIP_CREATED:      'TRIP_CREATED',
  TRIP_STATUS_CHANGED: 'TRIP_STATUS_CHANGED',
  TRIP_COMPLETED:    'TRIP_COMPLETED',
  CHECKPOINT_UPDATED:'CHECKPOINT_UPDATED',
};

module.exports = { log, ACTIONS };
