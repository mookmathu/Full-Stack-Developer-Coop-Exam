// ============================================================
// driverController.js
// ============================================================
const db   = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { sendSuccess, errors } = require('../utils/response');
const audit = require('../middleware/auditLog');

const createDriver = async (req, res) => {
  const { name, license_number, license_expires_at, phone } = req.body;
  if (!name || !license_number || !license_expires_at) {
    return errors.validation(res, 'name, license_number, license_expires_at are required');
  }
  // ตรวจสอบใบขับขี่ไม่หมดอายุ
  if (new Date(license_expires_at) < new Date()) {
    return errors.validation(res, 'Cannot add driver with an expired license. Please renew the license first.');
  }

  try {
    const [dup] = await db.execute('SELECT id FROM drivers WHERE license_number = ?', [license_number]);
    if (dup.length) return errors.conflict(res, 'License number already exists');

    const [lastRow] = await db.execute(
      `SELECT id FROM drivers WHERE id LIKE 'drv_%' ORDER BY id DESC LIMIT 1`
    );
    let nextNum = 1;
    if (lastRow.length) {
      const lastNum = parseInt(lastRow[0].id.replace('drv_', ''), 10);
      if (!isNaN(lastNum)) nextNum = lastNum + 1;
    }
    const id = 'drv_' + String(nextNum).padStart(3, '0');
    await db.execute(
      'INSERT INTO drivers (id, name, license_number, license_expires_at, phone) VALUES (?, ?, ?, ?, ?)',
      [id, name, license_number, license_expires_at, phone||null]
    );
    const [created] = await db.execute('SELECT * FROM drivers WHERE id = ?', [id]);
    return sendSuccess(res, created[0], 201);
  } catch (err) {
    return errors.server(res);
  }
};

const listDrivers = async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM drivers ORDER BY name');
    return sendSuccess(res, rows);
  } catch (err) {
    return errors.server(res);
  }
};

const getDriver = async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM drivers WHERE id = ?', [req.params.id]);
    if (!rows.length) return errors.notFound(res, 'Driver');
    return sendSuccess(res, rows[0]);
  } catch (err) {
    return errors.server(res);
  }
};

const updateDriver = async (req, res) => {
  const { name, phone, license_expires_at, status } = req.body;
  try {
    const [rows] = await db.execute('SELECT * FROM drivers WHERE id = ?', [req.params.id]);
    if (!rows.length) return errors.notFound(res, 'Driver');

    await db.execute(
      `UPDATE drivers SET
        name = COALESCE(?, name),
        phone = COALESCE(?, phone),
        license_expires_at = COALESCE(?, license_expires_at),
        status = COALESCE(?, status)
       WHERE id = ?`,
      [name||null, phone||null, license_expires_at||null, status||null, req.params.id]
    );
    const [updated] = await db.execute('SELECT * FROM drivers WHERE id = ?', [req.params.id]);
    return sendSuccess(res, updated[0]);
  } catch (err) {
    return errors.server(res);
  }
};

module.exports = { createDriver, listDrivers, getDriver, updateDriver };