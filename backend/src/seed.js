import { db } from "./db.js";

const seedData = async () => {
  try {
    console.log("Seeding data... 🔥");

    // 🧍 driver
    await db.query(`
      INSERT INTO drivers (id, name, license_number, license_expires_at, phone)
      VALUES ('drv_001', 'สมชาย', 'LIC001', '2027-01-01', '0812345678')
    `);

    // 🚗 vehicle (flatten context)
    await db.query(`
      INSERT INTO vehicles (
        id, license_plate, type, status, driver_id,
        brand, model, year, fuel_type,
        mileage_km, last_service_km, next_service_km
      ) VALUES (
        'veh_001', 'กข-1234', 'TRUCK', 'ACTIVE', 'drv_001',
        'Isuzu', 'D-Max', 2020, 'DIESEL',
        45230, 40000, 50000
      )
    `);

    // 🚚 trip
    await db.query(`
      INSERT INTO trips (
        id, vehicle_id, driver_id, status,
        origin, destination, distance_km,
        cargo_type, cargo_weight_kg,
        started_at
      ) VALUES (
        'trp_001', 'veh_001', 'drv_001', 'IN_PROGRESS',
        'กรุงเทพฯ', 'เชียงใหม่', 696,
        'GENERAL', 1500,
        NOW()
      )
    `);

    // 📍 checkpoint
    await db.query(`
      INSERT INTO checkpoints (
        id, trip_id, sequence, status,
        location_name, latitude, longitude,
        purpose, notes, arrived_at
      ) VALUES (
        'chk_001', 'trp_001', 1, 'ARRIVED',
        'นครสวรรค์', 15.7047, 100.1372,
        'FUEL', 'เติมน้ำมัน',
        NOW()
      )
    `);

    // 🔧 maintenance
    await db.query(`
      INSERT INTO maintenance (
        id, vehicle_id, status,
        type, scheduled_at,
        mileage_at_service,
        technician, notes
      ) VALUES (
        'mnt_001', 'veh_001', 'SCHEDULED',
        'OIL_CHANGE', NOW(),
        50000,
        'ช่างสมชาย', 'เปลี่ยนน้ำมันเครื่อง'
      )
    `);

    console.log("Seed data inserted ✅");

  } catch (err) {
    console.error("Seed error ❌", err.message);
  }
};

seedData();