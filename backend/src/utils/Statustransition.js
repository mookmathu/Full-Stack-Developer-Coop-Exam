/**
 * Status Transition Validators — ตรงตาม Schema.sql ENUM ทุก table
 */

// vehicles.status: ACTIVE | IDLE | MAINTENANCE | RETIRED
const VEHICLE_TRANSITIONS = {
  IDLE:        ["ACTIVE", "MAINTENANCE", "RETIRED"],
  ACTIVE:      ["IDLE", "MAINTENANCE", "RETIRED"],
  MAINTENANCE: ["IDLE", "ACTIVE"],
  RETIRED:     [], // terminal state
};

// trips.status: SCHEDULED | IN_PROGRESS | COMPLETED | CANCELLED
const TRIP_TRANSITIONS = {
  SCHEDULED:   ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED:   [],
  CANCELLED:   [],
};

// maintenance.status: SCHEDULED | IN_PROGRESS | COMPLETED | OVERDUE
const MAINTENANCE_TRANSITIONS = {
  SCHEDULED:   ["IN_PROGRESS", "OVERDUE"],
  IN_PROGRESS: ["COMPLETED"],
  OVERDUE:     ["IN_PROGRESS", "COMPLETED"],
  COMPLETED:   [],
};

// checkpoints.status: PENDING | ARRIVED | DEPARTED | SKIPPED
const CHECKPOINT_TRANSITIONS = {
  PENDING:  ["ARRIVED", "SKIPPED"],
  ARRIVED:  ["DEPARTED"],
  DEPARTED: [],
  SKIPPED:  [],
};

function validate(map, current, next) {
  if (current === next) {
    return { allowed: false, message: `Already in status "${current}"` };
  }
  const allowed = map[current] || [];
  if (!allowed.includes(next)) {
    return {
      allowed: false,
      message: `Cannot transition from "${current}" to "${next}". Allowed: ${allowed.join(", ") || "none (terminal state)"}`,
    };
  }
  return { allowed: true };
}

export const validateVehicleTransition     = (cur, nxt) => validate(VEHICLE_TRANSITIONS, cur, nxt);
export const validateTripTransition        = (cur, nxt) => validate(TRIP_TRANSITIONS, cur, nxt);
export const validateMaintenanceTransition = (cur, nxt) => validate(MAINTENANCE_TRANSITIONS, cur, nxt);
export const validateCheckpointTransition  = (cur, nxt) => validate(CHECKPOINT_TRANSITIONS, cur, nxt);