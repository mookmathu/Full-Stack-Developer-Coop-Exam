require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const cron         = require('node-cron');
const path         = require('path');

const db           = require('./config/database');
const { runAlertEngine } = require('./services/alertEngine');

// Controllers
const authCtrl     = require('./controllers/authController');
const vehicleCtrl  = require('./controllers/vehicleController');
const tripCtrl     = require('./controllers/tripController');
const driverCtrl   = require('./controllers/driverController');
const {
  listAlerts, markRead,
  getSummary, getChartData,
  listLogs,
  listMaintenance, updateStatus: updateMaintenanceStatus,
  getDraft, saveDraft, deleteDraft,
} = require('./controllers/alertController');

const alertCtrl       = { listAlerts, markRead };
const dashboardCtrl   = { getSummary, getChartData };
const auditCtrl       = { listLogs };
const maintenanceCtrl = { listMaintenance, updateStatus: updateMaintenanceStatus };

// Trip draft helpers (attach to tripCtrl)
tripCtrl.getDraft    = getDraft;
tripCtrl.saveDraft   = saveDraft;
tripCtrl.deleteDraft = deleteDraft;

// Middleware
const { authenticate, authorize } = require('./middleware/auth');

const app = express();

// ─── Global Middleware ────────────────────────────────────────────────────────
app.use(cors({
  origin: function(origin, callback) {
    if (!origin || /^http:\/\/localhost:\d+$/.test(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../../frontend/public')));

// ─── Auth Routes (no auth required) ──────────────────────────────────────────
app.post('/auth/login',   authCtrl.login);
app.post('/auth/refresh', authCtrl.refresh);
app.post('/auth/logout',  authenticate, authCtrl.logout);

// ─── Protected Routes ─────────────────────────────────────────────────────────
// All routes below require valid JWT
app.use(authenticate);

// Vehicles
app.post  ('/vehicles',               authorize('vehicles:manage'), vehicleCtrl.createVehicle);
app.get   ('/vehicles',               vehicleCtrl.listVehicles);
app.get   ('/vehicles/:id',           vehicleCtrl.getVehicle);
app.patch ('/vehicles/:id/status',    authorize('vehicles:manage'), vehicleCtrl.updateStatus);
app.delete('/vehicles/:id',           authorize('vehicles:manage'), vehicleCtrl.deleteVehicle);
app.get   ('/vehicles/:id/history',   vehicleCtrl.getVehicleHistory);

// Drivers
app.post  ('/drivers',                authorize('drivers:manage'), driverCtrl.createDriver);
app.get   ('/drivers',                driverCtrl.listDrivers);
app.get   ('/drivers/:id',            driverCtrl.getDriver);
app.patch ('/drivers/:id',            authorize('drivers:manage'), driverCtrl.updateDriver);

// Trips
app.post  ('/trips',                  authorize('trips:manage'), tripCtrl.createTrip);
app.get   ('/trips',                  tripCtrl.listTrips);
app.get   ('/trips/:id',              tripCtrl.getTrip);
app.patch ('/trips/:id/complete',     authorize('trips:manage'), tripCtrl.completeTrip);

// Checkpoints
app.patch ('/checkpoints/:id/status', authorize('checkpoints:manage'), tripCtrl.updateCheckpoint);

// Trip Drafts (multi-step form state)
app.get   ('/trip-drafts/:sessionKey',  tripCtrl.getDraft);
app.put   ('/trip-drafts/:sessionKey',  tripCtrl.saveDraft);
app.delete('/trip-drafts/:sessionKey',  tripCtrl.deleteDraft);

// Maintenance
app.get   ('/maintenance',            maintenanceCtrl.listMaintenance);
app.patch ('/maintenance/:id/status', authorize('maintenance:manage'), maintenanceCtrl.updateStatus);

// Alerts
app.get   ('/alerts',                 alertCtrl.listAlerts);
app.patch ('/alerts/:id/read',        alertCtrl.markRead);

// Dashboard
app.get   ('/dashboard/summary',      dashboardCtrl.getSummary);
app.get   ('/dashboard/charts',       dashboardCtrl.getChartData);

// Audit logs
app.get   ('/audit-logs',             auditCtrl.listLogs);

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err);
  res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal server error' } });
});

// ─── Alert Engine Cron (ทุก 5 นาที) ─────────────────────────────────────────
cron.schedule('*/5 * * * *', () => {
  console.log('[Cron] Running alert engine...');
  runAlertEngine();
});

// Run once on startup
runAlertEngine();

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Fleet Management API running on http://localhost:${PORT}`);
});

module.exports = app;

