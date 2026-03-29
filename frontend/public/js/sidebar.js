/* sidebar.js — inject sidebar HTML into every page */

function renderSidebar() {
  const html = `
  <nav class="sidebar">
    <a class="sidebar-brand" href="/pages/dashboard.html">
      <i class="bi bi-truck-front-fill"></i>
      <span>Fleet Manager</span>
    </a>

    <div class="sidebar-nav">
      <div class="nav-section">Overview</div>
      <a class="nav-item" data-page="dashboard" href="/pages/dashboard.html">
        <i class="bi bi-speedometer2"></i> Dashboard
      </a>

      <div class="nav-section">Operations</div>
      <a class="nav-item" data-page="vehicles" href="/pages/vehicles.html">
        <i class="bi bi-truck"></i> Vehicles
      </a>
      <a class="nav-item" data-page="drivers" href="/pages/drivers.html">
        <i class="bi bi-person-badge"></i> Drivers
      </a>
      <a class="nav-item" data-page="trips" href="/pages/trips.html">
        <i class="bi bi-map"></i> Trips
      </a>

      <div class="nav-section">Maintenance</div>
      <a class="nav-item" data-page="maintenance" href="/pages/maintenance.html">
        <i class="bi bi-tools"></i> Maintenance
      </a>
      <a class="nav-item" data-page="alerts" href="/pages/alerts.html">
        <i class="bi bi-bell"></i> Alerts
        <span id="alertBadge" class="badge-nav" style="display:none">0</span>
      </a>

      <div class="nav-section">Admin</div>
      <a class="nav-item" data-page="audit" href="/pages/audit.html">
        <i class="bi bi-journal-text"></i> Audit Log
      </a>
    </div>

    <div class="sidebar-footer">
      <div class="sidebar-user">
        <div class="sidebar-avatar" id="sidebarAvatar">A</div>
        <div style="flex:1;min-width:0">
          <div id="sidebarUsername" style="font-size:13px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">User</div>
          <div style="font-size:11px;color:rgba(255,255,255,.5)">Fleet Manager</div>
        </div>
        <button id="logoutBtn" class="btn btn-sm" style="background:rgba(255,255,255,.1);color:rgba(255,255,255,.8);border:none" title="Logout">
          <i class="bi bi-box-arrow-right"></i>
        </button>
      </div>
    </div>
  </nav>`;

  const target = document.getElementById('sidebar-placeholder');
  if (target) target.innerHTML = html;
}
