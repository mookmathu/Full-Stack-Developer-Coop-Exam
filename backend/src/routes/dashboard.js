import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import { db } from "../db.js";

const router = express.Router();

// GET /dashboard/summary — metric cards (5.1)
router.get("/summary", authMiddleware(["ADMIN", "DISPATCHER"]), async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 19).replace("T", " ");

  const [[{ total_vehicles }]]       = await db.query(`SELECT COUNT(*) AS total_vehicles FROM vehicles`);
  const [[{ active_trips_today }]]   = await db.query(`SELECT COUNT(*) AS active_trips_today FROM trips WHERE status = 'IN_PROGRESS' AND DATE(started_at) = CURDATE()`);
  const [[{ total_distance_today }]] = await db.query(`SELECT COALESCE(SUM(distance_km),0) AS total_distance_today FROM trips WHERE status IN ('IN_PROGRESS','COMPLETED') AND DATE(started_at) = CURDATE()`);
  const [[{ overdue_count }]]        = await db.query(`SELECT COUNT(*) AS overdue_count FROM maintenance WHERE status IN ('SCHEDULED','OVERDUE') AND scheduled_at < NOW()`);

  res.json({
    total_vehicles:     Number(total_vehicles),
    active_trips_today: Number(active_trips_today),
    total_distance_today: Number(total_distance_today),
    overdue_maintenance: Number(overdue_count),
  });
});

// GET /dashboard/vehicles-by-status — for pie/donut chart (5.2)
router.get("/vehicles-by-status", authMiddleware(["ADMIN", "DISPATCHER"]), async (req, res) => {
  const [rows] = await db.query(`SELECT status, COUNT(*) AS count FROM vehicles GROUP BY status`);
  res.json(rows);
});

// GET /dashboard/trip-distance-trend — last 7 days line/bar chart (5.2)
router.get("/trip-distance-trend", authMiddleware(["ADMIN", "DISPATCHER"]), async (req, res) => {
  const [rows] = await db.query(`
    SELECT
      DATE(started_at)          AS date,
      COUNT(*)                  AS trips,
      COALESCE(SUM(distance_km), 0) AS total_distance_km
    FROM trips
    WHERE started_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
    GROUP BY DATE(started_at)
    ORDER BY date ASC
  `);

  // Fill missing days with 0
  const result = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const found = rows.find(r => r.date?.toISOString?.().slice(0, 10) === key || String(r.date).slice(0, 10) === key);
    result.push({ date: key, trips: found ? Number(found.trips) : 0, total_distance_km: found ? Number(found.total_distance_km) : 0 });
  }
  res.json(result);
});

export default router;