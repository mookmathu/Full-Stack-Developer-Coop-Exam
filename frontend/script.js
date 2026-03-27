const API = "http://localhost:3000";
let accessToken = "";
let refreshToken = "";
let refreshTimer = null;
let currentTab = "dashboard";
let chartStatus = null;
let chartTrend  = null;

// ─── AUTH ────────────────────────────────────────────────────────────

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: document.getElementById("username").value,
      password: document.getElementById("password").value,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    document.getElementById("loginStatus").textContent = "❌ " + (data.error?.message || "Login failed");
    return;
  }
  accessToken  = data.accessToken;
  refreshToken = data.refreshToken;
  scheduleTokenRefresh(data.expiresIn);

  document.getElementById("loginSection").style.display = "none";
  document.getElementById("mainTabs").style.display = "flex";

  // Restore tab + filters from URL
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab") || "dashboard";
  showTab(tab, false);
  restoreFiltersFromURL();
}

function scheduleTokenRefresh(expiresIn) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(doTokenRefresh, Math.max((expiresIn - 60) * 1000, 5000));
}

async function doTokenRefresh() {
  if (!refreshToken) return;
  const res = await fetch(`${API}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  const data = await res.json();
  if (res.ok) {
    accessToken = data.accessToken;
    scheduleTokenRefresh(data.expiresIn);
    console.log("🔄 Token refreshed");
  } else {
    // 1.4: Refresh token expired → force logout with message
    logout("⚠️ Session หมดอายุ กรุณาเข้าสู่ระบบใหม่");
  }
}

async function logout(msg = "") {
  await fetch(`${API}/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  }).catch(() => {});
  accessToken = refreshToken = "";
  if (refreshTimer) clearTimeout(refreshTimer);
  document.getElementById("loginSection").style.display = "block";
  document.getElementById("mainTabs").style.display = "none";
  document.querySelectorAll(".tab-content").forEach(el => el.style.display = "none");
  if (msg) {
    document.getElementById("loginStatus").textContent = msg;
  }
}

async function apiFetch(path, opts = {}) {
  opts.headers = { ...opts.headers, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
  let res = await fetch(`${API}${path}`, opts);
  if (res.status === 401) {
    await doTokenRefresh();
    opts.headers.Authorization = `Bearer ${accessToken}`;
    res = await fetch(`${API}${path}`, opts);
  }
  return res;
}

// ─── TABS ────────────────────────────────────────────────────────────

function showTab(name, updateURL = true) {
  currentTab = name;
  document.querySelectorAll(".tab-content").forEach(el => el.style.display = "none");
  document.querySelectorAll(".tab").forEach(el => el.classList.remove("active"));
  const tabEl = document.getElementById(`tab-${name}`);
  if (tabEl) tabEl.style.display = "block";

  // Match tab button by text
  document.querySelectorAll(".tab").forEach(btn => {
    const t = btn.textContent.toLowerCase();
    if (
      (name === "dashboard"  && t.includes("dashboard")) ||
      (name === "vehicles"   && t.includes("vehicle")) ||
      (name === "trips"      && t.includes("trip")) ||
      (name === "drivers"    && t.includes("driver")) ||
      (name === "maintenance"&& t.includes("maintenance")) ||
      (name === "auditlogs"  && t.includes("audit"))
    ) btn.classList.add("active");
  });

  if (updateURL) {
    const params = new URLSearchParams(window.location.search);
    params.set("tab", name);
    history.replaceState(null, "", "?" + params.toString());
  }

  if (name === "dashboard")   loadDashboard();
  if (name === "vehicles")    loadVehicles();
  if (name === "trips")       loadTrips();
  if (name === "drivers")     loadDrivers();
  if (name === "maintenance") loadMaintenance();
  if (name === "auditlogs")   loadAuditLogs();
}

// ─── FILTER ↔ URL SYNC ───────────────────────────────────────────────

function syncFiltersToURL(prefix) {
  const params = new URLSearchParams(window.location.search);
  params.set("tab", currentTab);
  if (prefix === "v") {
    const s = document.getElementById("vFilterStatus").value;
    const t = document.getElementById("vFilterType").value;
    const q = document.getElementById("vFilterSearch").value;
    s ? params.set("status", s) : params.delete("status");
    t ? params.set("type", t)   : params.delete("type");
    q ? params.set("search", q) : params.delete("search");
  }
  if (prefix === "t") {
    const s = document.getElementById("tFilterStatus").value;
    s ? params.set("status", s) : params.delete("status");
  }
  history.replaceState(null, "", "?" + params.toString());
}

function restoreFiltersFromURL() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("status") && document.getElementById("vFilterStatus"))
    document.getElementById("vFilterStatus").value = params.get("status");
  if (params.get("type") && document.getElementById("vFilterType"))
    document.getElementById("vFilterType").value = params.get("type");
  if (params.get("search") && document.getElementById("vFilterSearch"))
    document.getElementById("vFilterSearch").value = params.get("search");
}

// ─── DASHBOARD (5.1 + 5.2) ───────────────────────────────────────────

async function loadDashboard() {
  await Promise.all([loadMetricCards(), loadChartStatus(), loadChartTrend()]);
}

// 5.1 — Metric Cards
async function loadMetricCards() {
  const res = await apiFetch("/dashboard/summary");
  if (!res.ok) return;
  const d = await res.json();

  animateNumber("mv-vehicles", d.total_vehicles);
  animateNumber("mv-trips",    d.active_trips_today);
  animateNumber("mv-distance", d.total_distance_today, true);
  animateNumber("mv-overdue",  d.overdue_maintenance);

  // Highlight overdue card if > 0
  document.getElementById("mc-overdue").classList.toggle("mc-alert", d.overdue_maintenance > 0);
}

function animateNumber(id, target, isDecimal = false) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = 0;
  const duration = 600;
  const startTime = performance.now();
  function step(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = start + (target - start) * eased;
    el.textContent = isDecimal
      ? value.toLocaleString("th-TH", { maximumFractionDigits: 1 })
      : Math.round(value).toLocaleString("th-TH");
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// 5.2 — Pie/Donut chart: vehicles by status
const STATUS_COLORS = {
  IDLE:        "#6b7280",
  ACTIVE:      "#16a34a",
  MAINTENANCE: "#ea580c",
  RETIRED:     "#9ca3af",
};

async function loadChartStatus() {
  const res = await apiFetch("/dashboard/vehicles-by-status");
  if (!res.ok) return;
  const rows = await res.json();

  const labels = rows.map(r => r.status);
  const values = rows.map(r => Number(r.count));
  const colors = labels.map(l => STATUS_COLORS[l] || "#2563eb");

  // Legend
  const legend = document.getElementById("chartStatusLegend");
  legend.innerHTML = labels.map((l, i) =>
    `<div class="legend-item">
       <span class="legend-dot" style="background:${colors[i]}"></span>
       <span>${l}: <strong>${values[i]}</strong></span>
     </div>`
  ).join("");

  const ctx = document.getElementById("chartStatus").getContext("2d");
  if (chartStatus) chartStatus.destroy();
  chartStatus = new Chart(ctx, {
    type: "doughnut",
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: "#fff" }] },
    options: {
      responsive: false,
      cutout: "62%",
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}` } } },
      animation: { animateRotate: true, duration: 700 },
    },
  });
}

// 5.2 — Bar/Line chart: trip distance 7 days
async function loadChartTrend() {
  const res = await apiFetch("/dashboard/trip-distance-trend");
  if (!res.ok) return;
  const rows = await res.json();

  const labels = rows.map(r => {
    const d = new Date(r.date);
    return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
  });
  const distances = rows.map(r => Number(r.total_distance_km));
  const trips     = rows.map(r => Number(r.trips));

  const ctx = document.getElementById("chartTrend").getContext("2d");
  if (chartTrend) chartTrend.destroy();
  chartTrend = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          type: "bar",
          label: "ระยะทาง (km)",
          data: distances,
          backgroundColor: "rgba(37,99,235,0.25)",
          borderColor: "#2563eb",
          borderWidth: 1.5,
          borderRadius: 4,
          yAxisID: "y",
        },
        {
          type: "line",
          label: "จำนวน Trips",
          data: trips,
          borderColor: "#ea580c",
          backgroundColor: "rgba(234,88,12,0.12)",
          borderWidth: 2,
          pointBackgroundColor: "#ea580c",
          pointRadius: 4,
          fill: true,
          tension: 0.35,
          yAxisID: "y2",
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { labels: { font: { size: 12 }, color: "#555" } } },
      scales: {
        y:  { position: "left",  beginAtZero: true, title: { display: true, text: "km", color: "#2563eb" }, ticks: { color: "#555" }, grid: { color: "rgba(0,0,0,0.06)" } },
        y2: { position: "right", beginAtZero: true, title: { display: true, text: "trips", color: "#ea580c" }, ticks: { color: "#555" }, grid: { drawOnChartArea: false } },
        x:  { ticks: { color: "#555" }, grid: { color: "rgba(0,0,0,0.04)" } },
      },
      animation: { duration: 600 },
    },
  });
}

// ─── VEHICLES ────────────────────────────────────────────────────────

async function loadVehicles() {
  const params = new URLSearchParams();
  const s = document.getElementById("vFilterStatus").value;
  const t = document.getElementById("vFilterType").value;
  const q = document.getElementById("vFilterSearch").value;
  if (s) params.set("status", s);
  if (t) params.set("type", t);
  if (q) params.set("search", q);

  const res = await apiFetch(`/vehicles${params.toString() ? "?" + params : ""}`);
  const data = await res.json();
  const el = document.getElementById("vehicleResult");
  el.innerHTML = `<p style="color:#666;font-size:13px">พบ ${data.total} คัน</p>`;

  data.vehicles.forEach(v => {
    const div = document.createElement("div");
    div.className = `card s-${v.status}`;
    div.innerHTML = `
      <div class="card-body">
        <div class="card-title">🚗 ${v.license_plate}
          <span class="badge b-${v.status}">${v.status}</span>
        </div>
        <div class="card-sub">${v.brand || ""} ${v.model || ""} ${v.year || ""} · ${v.type} · ${v.fuel_type || "-"}</div>
        <div class="card-sub">Mileage: ${v.mileage_km.toLocaleString()} km
          ${v.next_service_km ? ` · Next service: ${v.next_service_km.toLocaleString()} km` : ""}
          ${v.driver_name ? ` · Driver: ${v.driver_name}` : ""}
        </div>
      </div>
    `;
    el.appendChild(div);
  });
}

// ─── TRIPS ──────────────────────────────────────────────────────────

async function loadTrips() {
  const params = new URLSearchParams();
  const s = document.getElementById("tFilterStatus").value;
  if (s) params.set("status", s);

  const res = await apiFetch(`/trips${params.toString() ? "?" + params : ""}`);
  const data = await res.json();
  const el = document.getElementById("tripResult");
  el.innerHTML = `<p style="color:#666;font-size:13px">พบ ${data.trips.length} trip</p>`;

  data.trips.forEach(t => {
    const div = document.createElement("div");
    div.className = `card s-${t.status}`;
    div.innerHTML = `
      <div class="card-body">
        <div class="card-title">${t.origin} → ${t.destination}
          <span class="badge b-${t.status}">${t.status}</span>
        </div>
        <div class="card-sub">🚗 ${t.license_plate} · 👤 ${t.driver_name}</div>
        <div class="card-sub">
          ${t.cargo_type ? `📦 ${t.cargo_type}` : ""}
          ${t.cargo_weight_kg ? ` · ${t.cargo_weight_kg} kg` : ""}
          ${t.distance_km ? ` · ${t.distance_km} km` : ""}
        </div>
      </div>
      <div class="card-actions">
        ${t.status === "IN_PROGRESS" ? `<button onclick="showTripDetail('${t.id}')">📍 Detail</button>` : ""}
      </div>
    `;
    el.appendChild(div);
  });
}

// Trip detail modal with visual checkpoint progress
async function showTripDetail(tripId) {
  const res = await apiFetch(`/trips/${tripId}`);
  const trip = await res.json();
  const pct = trip.progress?.percent ?? 0;

  let cpHtml = "";
  if (trip.checkpoints?.length) {
    cpHtml = `<div class="cp-list">` +
      trip.checkpoints.map(cp => `
        <div class="cp-item">
          <div class="cp-dot cp-${cp.status}"></div>
          <div>
            <strong>#${cp.sequence} ${cp.location_name}</strong>
            <span class="badge b-${cp.status === "ARRIVED" ? "SCHEDULED" : cp.status === "DEPARTED" ? "COMPLETED" : "IDLE"}" style="font-size:10px">${cp.status}</span>
            ${cp.purpose ? `<span style="font-size:11px;color:#888"> · ${cp.purpose}</span>` : ""}
          </div>
        </div>
      `).join("") + `</div>`;
  } else {
    cpHtml = `<p style="color:#9ca3af;font-size:13px">ยังไม่มี checkpoint</p>`;
  }

  document.getElementById("tripDetail").innerHTML = `
    <p><strong>Route:</strong> ${trip.origin} → ${trip.destination}</p>
    <p><strong>Driver:</strong> ${trip.driver_name} · ${trip.driver_phone}</p>
    <p><strong>Vehicle:</strong> ${trip.license_plate}</p>
    ${trip.cargo_type ? `<p><strong>Cargo:</strong> ${trip.cargo_type} ${trip.cargo_weight_kg ? trip.cargo_weight_kg + " kg" : ""}</p>` : ""}
    <div class="progress-wrap">
      <div class="progress-label">Progress: ${pct}% — ${trip.progress?.label || ""}</div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" style="width:${pct}%">${pct > 10 ? pct + "%" : ""}</div>
      </div>
      <div class="progress-stage">${trip.progress?.checkpoints_done ?? 0} / ${trip.progress?.checkpoints_total ?? 0} checkpoints done</div>
    </div>
    <h3 style="font-size:14px;margin-bottom:6px">Checkpoints</h3>
    ${cpHtml}
  `;

  document.getElementById("tripModal").style.display = "flex";
}

function closeTripModal() {
  document.getElementById("tripModal").style.display = "none";
}

// ─── DRIVERS ────────────────────────────────────────────────────────

async function loadDrivers() {
  const s = document.getElementById("dFilterStatus").value;
  const params = s ? `?status=${s}` : "";
  const res = await apiFetch(`/drivers${params}`);
  const data = await res.json();
  const el = document.getElementById("driverResult");
  el.innerHTML = `<p style="color:#666;font-size:13px">พบ ${data.total} คน</p>`;

  data.drivers.forEach(d => {
    const expDate = new Date(d.license_expires_at);
    const daysLeft = Math.ceil((expDate - Date.now()) / 86400000);
    const expWarning = daysLeft <= 30
      ? `<span style="color:${daysLeft <= 7 ? "#dc2626" : "#ea580c"}"> ⚠️ หมด ${daysLeft} วัน</span>`
      : "";
    const div = document.createElement("div");
    div.className = `card s-${d.status}`;
    div.innerHTML = `
      <div class="card-body">
        <div class="card-title">👤 ${d.name}<span class="badge b-${d.status}">${d.status}</span></div>
        <div class="card-sub">📋 ${d.license_number} · หมดอายุ ${expDate.toLocaleDateString("th-TH")} ${expWarning}</div>
        <div class="card-sub">📞 ${d.phone}</div>
      </div>
    `;
    el.appendChild(div);
  });
}

// ─── MAINTENANCE ─────────────────────────────────────────────────────

async function loadMaintenance() {
  const s = document.getElementById("mFilterStatus").value;
  const params = s ? `?status=${s}` : "";
  const res = await apiFetch(`/maintenance${params}`);
  const data = await res.json();
  const el = document.getElementById("maintenanceResult");
  el.innerHTML = `<p style="color:#666;font-size:13px">พบ ${data.total} รายการ</p>`;

  data.maintenance.forEach(m => {
    const div = document.createElement("div");
    div.className = `card s-${m.status}`;
    div.innerHTML = `
      <div class="card-body">
        <div class="card-title">🔧 ${m.type}<span class="badge b-${m.status}">${m.status}</span></div>
        <div class="card-sub">🚗 ${m.license_plate} · กำหนด: ${new Date(m.scheduled_at).toLocaleDateString("th-TH")}</div>
        <div class="card-sub">
          ${m.technician ? `👷 ${m.technician}` : ""}
          ${m.cost_thb ? ` · ฿${Number(m.cost_thb).toLocaleString()}` : ""}
          ${m.mileage_at_service ? ` · @${m.mileage_at_service.toLocaleString()} km` : ""}
        </div>
      </div>
    `;
    el.appendChild(div);
  });
}

// ─── AUDIT LOGS (5.4) ────────────────────────────────────────────────

let auditDebounce = null;

async function loadAuditLogs() {
  clearTimeout(auditDebounce);
  auditDebounce = setTimeout(_doLoadAuditLogs, 300);
}

async function _doLoadAuditLogs() {
  const params = new URLSearchParams();
  const userId   = document.getElementById("alFilterUserId")?.value;
  const action   = document.getElementById("alFilterAction")?.value;
  const resource = document.getElementById("alFilterResource")?.value;
  const dateFrom = document.getElementById("alFilterDateFrom")?.value;
  const dateTo   = document.getElementById("alFilterDateTo")?.value;

  if (userId)   params.set("user_id",       userId);
  if (action)   params.set("action",        action);
  if (resource) params.set("resource_type", resource);
  if (dateFrom) params.set("date_from",     dateFrom);
  if (dateTo)   params.set("date_to",       dateTo);

  const res  = await apiFetch(`/audit-logs${params.toString() ? "?" + params : ""}`);
  const data = await res.json();
  const el   = document.getElementById("auditResult");

  if (!data.logs?.length) {
    el.innerHTML = `<p style="color:#9ca3af;font-size:13px;padding:12px 0">ไม่พบ log</p>`;
    return;
  }

  el.innerHTML = `<p style="color:#666;font-size:13px;margin-bottom:8px">พบ ${data.total} รายการ</p>`;

  const table = document.createElement("div");
  table.className = "audit-table";
  table.innerHTML = `
    <div class="audit-header">
      <span>เวลา</span><span>User</span><span>Action</span><span>Resource</span><span>Result</span><span>IP</span>
    </div>
    ${data.logs.map(l => `
      <div class="audit-row">
        <span class="audit-time">${new Date(l.created_at).toLocaleString("th-TH")}</span>
        <span class="audit-user">${l.username || l.user_id?.slice(0,8) || "-"}</span>
        <span class="audit-action">${l.action}</span>
        <span class="audit-resource">${l.resource_type}${l.resource_id ? `<br><small>${l.resource_id.slice(0,12)}…</small>` : ""}</span>
        <span class="audit-result ${l.result === "SUCCESS" ? "res-ok" : "res-fail"}">${l.result}</span>
        <span class="audit-ip">${l.ip_address || "-"}</span>
      </div>
    `).join("")}
  `;
  el.appendChild(table);
}

// ─── INIT ────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {});