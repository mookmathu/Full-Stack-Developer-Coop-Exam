export const errorResponse = (code, message, details = {}) => ({
  error: { code, message, details }
});