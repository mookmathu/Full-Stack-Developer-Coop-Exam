import express from "express";
import cors from "cors";
import { initDB } from "./db.js";
import authRoutes        from "./routes/auth.js";
import vehicleRoutes     from "./routes/vehicles.js";
import tripRoutes        from "./routes/trips.js";
import driverRoutes      from "./routes/drivers.js";
import maintenanceRoutes from "./routes/maintenance.js";
import dashboardRoutes   from "./routes/dashboard.js";
import auditLogRoutes    from "./routes/auditLogs.js";

// Load alert rules (open/closed — no existing code modified)
import "./alerts/builtinRules.js";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/auth",        authRoutes);
app.use("/vehicles",    vehicleRoutes);
app.use("/trips",       tripRoutes);
app.use("/drivers",     driverRoutes);
app.use("/maintenance", maintenanceRoutes);
app.use("/dashboard",   dashboardRoutes);
app.use("/audit-logs",  auditLogRoutes);

await initDB();

app.listen(3000, () => console.log("🚗 Fleet server running on http://localhost:3000"));