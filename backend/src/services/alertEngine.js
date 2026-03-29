/**
 * Alert Engine — Extensible Rule System
 *
 * การทำงาน: engine ดึง rule config จาก alert_rules table
 * เพิ่ม rule ใหม่ = INSERT row ใน alert_rules เท่านั้น ไม่ต้องแตะ code นี้เลย
 *
 * แต่ละ rule จะมี "checker function" ที่ map กับ rule_key
 * ถ้าอยากเพิ่ม rule ใหม่ที่มี logic ซับซ้อน: เพิ่ม checker ใน RULE_CHECKERS object
 */

const db = require('../config/database');

// ============================================================
// RULE CHECKERS: map rule_key → async function(rule, config)
// แต่ละ checker return array ของ alert objects ที่ต้อง trigger
// ============================================================
const RULE_CHECKERS = {

  // Rule 1: mileage_km >= next_service_km → "Vehicle Due for Service"
  vehicle_due_service: async (rule, config) => {
    const [rows] = await db.execute(
      `SELECT id, license_plate, mileage_km, next_service_km
       FROM vehicles
       WHERE mileage_km >= next_service_km AND status != 'RETIRED'`
    );
    return rows.map(v => ({
      rule_id: rule.id,
      affected_resource_type: 'vehicle',
      affected_resource_id: v.id,
      message: (config.message_tpl || 'Vehicle {id} due for service')
        .replace('{id}', v.license_plate || v.id)
        .replace('{mileage}', v.mileage_km),
      severity: rule.severity,
    }));
  },

  // Rule 2: maintenance SCHEDULED เลยมา 3 วัน → "Overdue Maintenance"
  overdue_maintenance: async (rule, config) => {
    const threshold = config.threshold_days || 3;
    const [rows] = await db.execute(
      `SELECT m.id, m.vehicle_id, m.scheduled_at, v.license_plate,
              DATEDIFF(NOW(), m.scheduled_at) as days_overdue
       FROM maintenances m JOIN vehicles v ON m.vehicle_id = v.id
       WHERE m.status = 'SCHEDULED' AND m.scheduled_at < NOW() - INTERVAL ? DAY`,
      [threshold]
    );
    return rows.map(m => ({
      rule_id: rule.id,
      affected_resource_type: 'maintenance',
      affected_resource_id: m.id,
      message: (config.message_tpl || 'Maintenance {id} is overdue')
        .replace('{id}', m.id)
        .replace('{days}', m.days_overdue),
      severity: rule.severity,
    }));
  },

  // Rule 3: driver license หมดอายุภายใน 30 วัน → "License Expiring Soon"
  license_expiring_soon: async (rule, config) => {
    const threshold = config.threshold_days || 30;
    const [rows] = await db.execute(
      `SELECT id, name, license_expires_at,
              DATEDIFF(license_expires_at, NOW()) as days_left
       FROM drivers
       WHERE license_expires_at BETWEEN NOW() AND NOW() + INTERVAL ? DAY
         AND status != 'inactive'`,
      [threshold]
    );
    return rows.map(d => ({
      rule_id: rule.id,
      affected_resource_type: 'driver',
      affected_resource_id: d.id,
      message: (config.message_tpl || 'Driver {name} license expires soon')
        .replace('{name}', d.name)
        .replace('{days}', d.days_left),
      severity: rule.severity,
    }));
  },

  // Rule 4: trip IN_PROGRESS นานเกิน estimated_duration * 150% → "Trip Delayed"
  trip_delayed: async (rule, config) => {
    const threshold = (config.threshold_pct || 150) / 100;
    const [rows] = await db.execute(
      `SELECT id, vehicle_id, driver_id, started_at, estimated_duration_min,
              TIMESTAMPDIFF(MINUTE, started_at, NOW()) as elapsed_min
       FROM trips
       WHERE status = 'IN_PROGRESS'
         AND estimated_duration_min IS NOT NULL
         AND TIMESTAMPDIFF(MINUTE, started_at, NOW()) > (estimated_duration_min * ?)`
      , [threshold]
    );
    return rows.map(t => ({
      rule_id: rule.id,
      affected_resource_type: 'trip',
      affected_resource_id: t.id,
      message: (config.message_tpl || 'Trip {id} is delayed at {pct}%')
        .replace('{id}', t.id)
        .replace('{pct}', Math.round((t.elapsed_min / t.estimated_duration_min) * 100)),
      severity: rule.severity,
    }));
  },

  // ============================================================
  // เพิ่ม rule ใหม่ที่นี่ถ้าต้องการ logic ซับซ้อน
  // หรือถ้า logic ง่ายมาก ก็แค่ INSERT ลง alert_rules + เขียน checker
  // ============================================================
};

// ============================================================
// ENGINE: วิ่ง rule ทั้งหมดและ insert alerts ที่ยังไม่มีใน DB
// ============================================================
const runAlertEngine = async () => {
  try {
    // ดึง active rules ทั้งหมดจาก DB
    const [rules] = await db.execute('SELECT * FROM alert_rules WHERE is_active = 1');

    for (const rule of rules) {
      const checker = RULE_CHECKERS[rule.rule_key];
      if (!checker) {
        console.warn(`[AlertEngine] No checker found for rule_key: ${rule.rule_key}`);
        continue;
      }

      const config = rule.config || {};
      const newAlerts = await checker(rule, config);

      for (const alert of newAlerts) {
        // ป้องกัน duplicate: ถ้ามี alert เดียวกันที่ยังไม่ read อยู่แล้ว ข้ามไป
        const [existing] = await db.execute(
          `SELECT id FROM alerts
           WHERE rule_id = ? AND affected_resource_type = ? AND affected_resource_id = ? AND is_read = 0`,
          [alert.rule_id, alert.affected_resource_type, alert.affected_resource_id]
        );
        if (existing.length) continue;

        await db.execute(
          `INSERT INTO alerts (rule_id, affected_resource_type, affected_resource_id, message, severity)
           VALUES (?, ?, ?, ?, ?)`,
          [alert.rule_id, alert.affected_resource_type, alert.affected_resource_id,
           alert.message, alert.severity]
        );
      }
    }

    console.log(`[AlertEngine] Run complete — ${rules.length} rules checked`);
  } catch (err) {
    console.error('[AlertEngine] Error:', err.message);
  }
};

module.exports = { runAlertEngine, RULE_CHECKERS };
