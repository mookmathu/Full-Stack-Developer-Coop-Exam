import { alertEngine } from "./alertEngine.js";

// Rule 1: SERVICE_DUE — mileage >= next_service_km
alertEngine.registerRule({
  name: "SERVICE_DUE",
  description: "Vehicle mileage has reached next service threshold",
  check: async (vehicle, _db) => {
    if (vehicle.next_service_km && vehicle.mileage_km >= vehicle.next_service_km) {
      return {
        severity: "HIGH",
        message: `${vehicle.license_plate} ถึงกำหนดเซอร์วิส (${vehicle.mileage_km.toLocaleString()} / ${vehicle.next_service_km.toLocaleString()} km)`,
        metadata: { mileage_km: vehicle.mileage_km, next_service_km: vehicle.next_service_km },
      };
    }
    return null;
  },
});

// Rule 2: LONG_MAINTENANCE — in MAINTENANCE status > 7 days
alertEngine.registerRule({
  name: "LONG_MAINTENANCE",
  description: "Vehicle has been in MAINTENANCE for over 7 days",
  check: async (vehicle, db) => {
    if (vehicle.status !== "MAINTENANCE") return null;
    const [rows] = await db.query(
      `SELECT scheduled_at FROM maintenance
       WHERE vehicle_id = ? AND status IN ('SCHEDULED','IN_PROGRESS')
       ORDER BY scheduled_at ASC LIMIT 1`,
      [vehicle.id]
    );
    if (!rows.length) return null;
    const days = (Date.now() - new Date(rows[0].scheduled_at)) / 86400000;
    if (days > 7) {
      return {
        severity: "MEDIUM",
        message: `${vehicle.license_plate} อยู่ใน MAINTENANCE นานกว่า ${Math.floor(days)} วัน`,
        metadata: { days_in_maintenance: Math.floor(days) },
      };
    }
    return null;
  },
});

// Rule 3: LICENSE_EXPIRY — driver license expires within 30 days
alertEngine.registerRule({
  name: "LICENSE_EXPIRY",
  description: "Driver assigned to vehicle has a license expiring within 30 days",
  check: async (vehicle, db) => {
    if (!vehicle.driver_id) return null;
    const [rows] = await db.query(
      "SELECT name, license_expires_at FROM drivers WHERE id = ?",
      [vehicle.driver_id]
    );
    if (!rows.length) return null;
    const daysLeft = (new Date(rows[0].license_expires_at) - Date.now()) / 86400000;
    if (daysLeft <= 30) {
      return {
        severity: daysLeft <= 7 ? "HIGH" : "MEDIUM",
        message: `คนขับ ${rows[0].name} ใบขับขี่หมดใน ${Math.ceil(daysLeft)} วัน`,
        metadata: { driver_id: vehicle.driver_id, expires_at: rows[0].license_expires_at, days_left: Math.ceil(daysLeft) },
      };
    }
    return null;
  },
});

// Rule 4: OVERDUE_MAINTENANCE — maintenance scheduled_at passed but still SCHEDULED
alertEngine.registerRule({
  name: "OVERDUE_MAINTENANCE",
  description: "Maintenance is past scheduled date and still not started",
  check: async (vehicle, db) => {
    const [rows] = await db.query(
      `SELECT id, type, scheduled_at FROM maintenance
       WHERE vehicle_id = ? AND status = 'SCHEDULED' AND scheduled_at < NOW()
       LIMIT 1`,
      [vehicle.id]
    );
    if (!rows.length) return null;
    return {
      severity: "HIGH",
      message: `${vehicle.license_plate} มีการซ่อมบำรุง (${rows[0].type}) ที่เลยกำหนดแล้ว`,
      metadata: { maintenance_id: rows[0].id, scheduled_at: rows[0].scheduled_at },
    };
  },
});