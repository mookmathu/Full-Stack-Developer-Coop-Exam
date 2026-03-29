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
  unauthorized: (res, msg = 'Unauthorized')          => sendError(res, 401, 'UNAUTHORIZED', msg),
  forbidden:    (res, msg = 'Forbidden')              => sendError(res, 403, 'FORBIDDEN', msg),
  notFound:     (res, resource = 'Resource')          => sendError(res, 404, 'NOT_FOUND', `${resource} not found`),
  conflict:     (res, msg)                            => sendError(res, 409, 'CONFLICT', msg),
  validation:   (res, msg, details)                  => sendError(res, 422, 'VALIDATION_ERROR', msg, details),
  server:       (res, msg = 'Internal server error')  => sendError(res, 500, 'SERVER_ERROR', msg),
  badTransition:(res, from, allowed)                  => sendError(res, 409, 'INVALID_TRANSITION',
    `Cannot transition from ${from}. Allowed next statuses: ${allowed.join(', ')}`,
    { current_status: from, allowed_next: allowed }
  ),
};

module.exports = { sendError, sendSuccess, errors };
