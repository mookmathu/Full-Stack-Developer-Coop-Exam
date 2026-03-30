/* fleet-api.js — shared API client สำหรับทุก page */

const API_BASE = 'http://localhost:3000';

// Access token เก็บใน memory (ไม่ใน localStorage)
let _accessToken = null;

// โหลด token จาก sessionStorage ตอนเริ่มต้น
const _saved = sessionStorage.getItem('accessToken');
if (_saved) _accessToken = _saved;

const setToken = (t) => { 
  _accessToken = t; 
  if (t) sessionStorage.setItem('accessToken', t);
  else sessionStorage.removeItem('accessToken');
};
const getToken  = ()  => _accessToken;
const clearToken= ()  => { _accessToken = null; sessionStorage.removeItem('accessToken'); };

/* ─── Core fetch wrapper ──────────────────────────────────── */
async function apiFetch(path, options = {}, retry = true) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (_accessToken) headers['Authorization'] = `Bearer ${_accessToken}`;

  const res = await fetch(API_BASE + path, {
    ...options,
    headers,
    credentials: 'include',  // ส่ง httpOnly cookie ไปด้วยเสมอ
  });

  // Token expired → ลอง refresh แล้ว retry
  if (res.status === 401 && retry) {
    const refreshed = await tryRefresh();
    if (refreshed) return apiFetch(path, options, false);

    // Refresh failed → force logout
    redirectToLogin('Session expired. Please login again.');
    return null;
  }

  return res;
}

/* ─── Convenience methods ─────────────────────────────────── */
const api = {
  get:    (path)         => apiFetch(path, { method: 'GET' }),
  post:   (path, body)   => apiFetch(path, { method: 'POST',   body: JSON.stringify(body) }),
  patch:  (path, body)   => apiFetch(path, { method: 'PATCH',  body: JSON.stringify(body) }),
  put:    (path, body)   => apiFetch(path, { method: 'PUT',    body: JSON.stringify(body) }),
  delete: (path)         => apiFetch(path, { method: 'DELETE' }),

  // Parse JSON response + throw on error
  async json(path, options) {
    const res = await apiFetch(path, options);
    if (!res) return null;
    const data = await res.json();
    if (!data.success) throw new Error(data.error?.message || 'API error');
    return data.data;
  },
};

/* ─── Token refresh ───────────────────────────────────────── */
async function tryRefresh() {
  try {
    const res  = await fetch(API_BASE + '/auth/refresh', {
      method: 'POST', credentials: 'include',
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (data.success && data.data.accessToken) {
      _accessToken = data.data.accessToken;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/* ─── Auth helpers ────────────────────────────────────────── */
function redirectToLogin(msg) {
  clearToken();
  sessionStorage.removeItem('user');
  if (msg) sessionStorage.setItem('loginMsg', msg);
  window.location.href = '/index.html';
}

function getCurrentUser() {
  try { return JSON.parse(sessionStorage.getItem('user')); }
  catch { return null; }
}

function requireAuth() {
  const user = getCurrentUser();
  if (!user) redirectToLogin();
  return user;
}

/* ─── Status badge helper ─────────────────────────────────── */
function statusBadge(status) {
  const s = (status || '').toLowerCase().replace(/ /g, '_');
  const labels = {
    active: 'Active', idle: 'Idle', maintenance: 'Maintenance', retired: 'Retired',
    scheduled: 'Scheduled', in_progress: 'In Progress', completed: 'Completed',
    cancelled: 'Cancelled', pending: 'Pending', arrived: 'Arrived',
    departed: 'Departed', overdue: 'Overdue', due: 'Due Soon',
    warning: 'Warning', critical: 'Critical',
    available: 'Available', on_trip: 'On Trip', inactive: 'Inactive',
  };
  return `<span class="badge-status s-${s}">${labels[s] || status}</span>`;
}

/* ─── Date formatting (Bangkok timezone) ─────────────────── */
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    calendar: 'gregory',
    day: '2-digit', month: 'short', year: 'numeric',
  });
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    calendar: 'gregory',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/* ─── Toast notification ──────────────────────────────────── */
function showToast(msg, type = 'success') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  const colors = { success:'#10b981', danger:'#ef4444', warning:'#f59e0b', info:'#3b82f6' };
  toast.style.cssText = `
    background:#fff; border-left: 4px solid ${colors[type]||colors.info};
    padding: 12px 16px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,.15);
    font-size: 13px; max-width: 300px; animation: slideIn .2s ease;
    display:flex; align-items:center; gap:8px;
  `;
  const icons = { success:'✓', danger:'✕', warning:'⚠', info:'ℹ' };
  toast.innerHTML = `<span style="color:${colors[type]};font-weight:700">${icons[type]||'ℹ'}</span><span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity='0'; toast.style.transition='opacity .3s'; setTimeout(()=>toast.remove(), 300); }, 3500);
}

/* ─── Sidebar active state ────────────────────────────────── */
function initSidebar() {
  const user = requireAuth();
  const page = window.location.pathname;

  // Set username in sidebar
  const uEl = document.getElementById('sidebarUsername');
  const aEl = document.getElementById('sidebarAvatar');
  if (uEl && user) uEl.textContent = user.username;
  if (aEl && user) aEl.textContent = user.username[0].toUpperCase();

  // Highlight current nav item
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    if (page.includes(el.dataset.page)) el.classList.add('active');
  });

  // Logout button
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await api.post('/auth/logout', {});
      redirectToLogin();
    });
  }

  // Load unread alert count
  loadAlertCount();
}

async function loadAlertCount() {
  try {
    const alerts = await api.json('/alerts');
    const unread = alerts?.filter(a => !a.is_read).length || 0;
    const badge = document.getElementById('alertBadge');
    if (badge) {
      badge.textContent = unread;
      badge.style.display = unread > 0 ? 'inline' : 'none';
    }
  } catch {}
}