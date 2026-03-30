/**
 * Standard error response format ที่ใช้ทุก endpoint
 * { success: false, error: { code, message, details? } }
 */

const sendError = (res, status, code, message, details = null) => {
  const body = { success: false, error: { code, message } };
  if (details) body.error.details = details;
  return res.status(status).json(body);
};

const sendSuccess = (res, data, status = 200) => {
  return res.status(status).json({ success: true, data });
};

// Common error shortcuts
const errors = {
  // token ไม่มี/หมดอายุ
  unauthorized: (res, msg = 'Unauthorized')          => sendError(res, 401, 'UNAUTHORIZED', msg),
  // ไม่มีสิทธิ์ทำ action นั้น
  forbidden:    (res, msg = 'Forbidden')              => sendError(res, 403, 'FORBIDDEN', msg),
  // หาข้อมูลไม่เจอ
  notFound:     (res, resource = 'Resource')          => sendError(res, 404, 'NOT_FOUND', `${resource} not found`),
  // ข้อมูลซ้ำ/ขัดแย้ง
  conflict:     (res, msg)                            => sendError(res, 409, 'CONFLICT', msg),
  // ข้อมูลที่ส่งมาไม่ถูกต้อง
  validation:   (res, msg, details)                  => sendError(res, 422, 'VALIDATION_ERROR', msg, details),
  // ข้อผิดพลาดของเซิร์ฟเวอร์
  server:       (res, msg = 'Internal server error')  => sendError(res, 500, 'SERVER_ERROR', msg),
  // เปลี่ยน status ไม่ถูกต้อง
  badTransition:(res, from, allowed)                  => sendError(res, 409, 'INVALID_TRANSITION',
    `Cannot transition from ${from}. Allowed next statuses: ${allowed.join(', ')}`,
    { current_status: from, allowed_next: allowed }
  ),
};

module.exports = { sendError, sendSuccess, errors };
