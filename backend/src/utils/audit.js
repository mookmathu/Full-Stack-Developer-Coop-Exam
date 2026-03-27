import { db } from "../db.js";
import { v4 as uuidv4 } from "uuid";

/**
 * Write an entry to audit_logs — matches schema exactly
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.action        e.g. "LOGIN", "CREATE_VEHICLE"
 * @param {string} opts.resourceType  e.g. "users", "vehicles"
 * @param {string} [opts.resourceId]
 * @param {string} [opts.ip]
 * @param {"SUCCESS"|"FAIL"} opts.result
 * @param {object} [opts.detail]      stored as JSON
 */
export const writeAudit = async ({ userId, action, resourceType, resourceId = null, ip = null, result, detail = {} }) => {
  try {
    await db.query(
      `INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, ip_address, result, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), userId, action, resourceType, resourceId, ip, result, JSON.stringify(detail)]
    );
  } catch (err) {
    // Audit must never crash the main request
    console.error("Audit write failed:", err.message);
  }
};