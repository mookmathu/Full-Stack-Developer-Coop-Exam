/**
 * Alert Engine — Open for Extension, Closed for Modification
 * 
 * To add a new alert rule: create a new file in /alerts/rules/
 * and register it in alertEngine.registerRule().
 * DO NOT modify this file or existing rule files.
 */

class AlertEngine {
  constructor() {
    this.rules = [];
  }

  /**
   * Register a new alert rule without modifying existing code
   * @param {Object} rule - { name, description, check: async (vehicle, db) => Alert|null }
   */
  registerRule(rule) {
    if (typeof rule.check !== "function") {
      throw new Error(`Alert rule "${rule.name}" must have a check() function`);
    }
    this.rules.push(rule);
    console.log(`✅ Alert rule registered: ${rule.name}`);
  }

  /**
   * Evaluate all rules for a given vehicle
   * @returns {Array} triggered alerts
   */
  async evaluate(vehicle, db) {
    const alerts = [];

    for (const rule of this.rules) {
      try {
        const alert = await rule.check(vehicle, db);
        if (alert) {
          alerts.push({
            rule: rule.name,
            severity: alert.severity || "WARNING",
            message: alert.message,
            metadata: alert.metadata || {},
          });
        }
      } catch (err) {
        console.error(`Alert rule "${rule.name}" failed:`, err.message);
      }
    }

    return alerts;
  }

  /**
   * Evaluate all rules for all vehicles in bulk
   */
  async evaluateAll(vehicles, db) {
    const results = [];
    for (const vehicle of vehicles) {
      const alerts = await this.evaluate(vehicle, db);
      if (alerts.length > 0) {
        results.push({ vehicle_id: vehicle.id, license_plate: vehicle.license_plate, alerts });
      }
    }
    return results;
  }
}

// Singleton engine instance
export const alertEngine = new AlertEngine();