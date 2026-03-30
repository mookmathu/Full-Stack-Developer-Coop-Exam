const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     process.env.DB_PORT     || 3307,
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '1234',
  database: process.env.DB_NAME     || 'fleet_db',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  timezone: '+07:00',              // Bangkok time
  // บังคับให้ทุก MySQL session ใช้ +07:00 ทำให้ NOW() / CURRENT_TIMESTAMP ถูกต้อง
  initializationCommands: [`SET time_zone = '+07:00'`],
});

// Test connection on startup
pool.getConnection()
  .then(conn => {
    console.log('✅ MySQL connected successfully');
    conn.release();
  })
  .catch(err => {
    console.error('❌ MySQL connection failed:', err.message);
    process.exit(1);
  });

module.exports = pool;