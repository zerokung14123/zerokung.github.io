// ============================================================
//  app.js — Main Application (routing, settings, UI helpers)
// ============================================================

/* ──────────────────────────────────────────────────────────
   INIT
   ────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  await window.loadV3RuntimeConfig?.();
  updateLoginGate(null, { pending: true });
  loadSettings();
  updateSheetSyncInfo();
  buildYearSelectors();
  updateDashboard();
  renderQueueTable();
  renderRevenue();
  setTodayDate();
  setupPickerIconClicks();
  setupStaticEventHandlers();
  initTheme();
  startInactivityCheck();

  // Nav buttons
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => showPage(btn.dataset.page));
  });

  // Check for existing JWT session
  const token = localStorage.getItem('manager_token');
  const wasLoggedIn = localStorage.getItem('oracat_logged_in') === 'true';
  const lastActive = Number(localStorage.getItem('oracat_last_activity') || 0);
  const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
  const isExpired = lastActive && (Date.now() - lastActive > SESSION_TTL);

  if (token && wasLoggedIn && !isExpired) {
    try {
      const apiBase = (window.location.hostname === 'localhost' ? 'http://localhost:5000/api' : 'https://oracatapi.onrender.com/api');
      const settingsRes = await fetch(`${apiBase}/settings`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (settingsRes.ok) {
        const settingsData = await settingsRes.json();
        applyCloudSettings(settingsData);
        const username = localStorage.getItem('oracat_username') || 'admin';
        updateLoginGate({ email: username, displayName: username });
      } else {
        // Token expired or invalid
        localStorage.removeItem('manager_token');
        updateLoginGate(null, { message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
      }
    } catch (e) {
      updateLoginGate(null, { message: 'ไม่สามารถเชื่อมต่อ server ได้' });
    }
  } else {
    if (token) localStorage.removeItem('manager_token');
    updateLoginGate(null, { message: 'กรุณาระบุชื่อผู้ใช้งานและรหัสผ่านเพื่อเข้าใช้งาน Oracat Manager' });
  }

  loadGoogleAPIs?.();
  await window.googleOAuthV3?.init?.();

  // Close modal on overlay click
  document.getElementById('jobModal').addEventListener('click', function (e) {
    if (e.target === this) closeJobModal({ preserveDraft: true });
  });
});


function setupStaticEventHandlers() {
  bindClick('googleAuthBtn', () => handleGoogleAuth());
  bindClick('menuToggleBtn', () => toggleSidebar());
  bindClick('syncAllBtn', () => syncAll());
  bindClick('openJobModalBtn', () => openJobModal());
  bindClick('syncCalendarBtn', () => syncCalendar());
  bindClick('dashboardTaxPaidButton', () => markDashboardTaxPaid());
  bindClick('bookingPreviewBtn', () => renderBookingDocument());
  bindClick('bookingDownloadBtn', () => downloadBookingDocument());
  bindClick('saveBusinessInfoBtn', () => saveBusinessInfo());
  bindClick('addJobTypeBtn', () => addJobTypeSetting());
  bindClick('addPackageBtn', () => addPackageSetting());
  bindClick('saveJobBtn', () => saveJob());
  bindClick('jobDetailEditBtn', () => editCurrentJobDetail());
  bindClick('jobDetailBookingBtn', () => openCurrentJobDetailBooking());
  bindClick('downloadCurrentBookingBtn', () => downloadCurrentBookingDocument());
  bindClick('themeToggleBtn', () => toggleTheme());

  // Settings Tabs switching
  document.querySelectorAll('.settings-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.settingsTab;
      
      // Update active button
      document.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Update active pane
      document.querySelectorAll('.settings-pane').forEach(p => p.classList.remove('active'));
      const targetPane = document.getElementById(`settings-pane-${targetTab}`);
      if (targetPane) targetPane.classList.add('active');
    });
  });

  bindChange('chartYear', () => renderChart());
  bindChange('chartType', () => renderChart());
  bindInput('searchInput', () => filterJobs());
  bindChange('filterMonth', () => filterJobs());
  bindChange('filterJobType', () => filterJobs());
  bindChange('filterStatus', () => filterJobs());
  bindChange('bookingJobSelect', () => renderBookingDocument());
  bindChange('bookingSlipInput', event => loadBookingSlip(event.currentTarget));
  bindChange('revYear', () => renderRevenue());
  bindChange('revMonth', () => renderRevenue());

  document.querySelectorAll('[data-show-page]').forEach(button => {
    button.addEventListener('click', () => showPage(button.dataset.showPage));
  });
  document.querySelectorAll('[data-job-modal-close]').forEach(button => {
    button.addEventListener('click', () => closeJobModal({ clearDraft: true }));
  });
  document.querySelectorAll('[data-job-detail-close]').forEach(button => {
    button.addEventListener('click', () => closeJobDetailModal());
  });
  document.querySelectorAll('[data-booking-preview-close]').forEach(button => {
    button.addEventListener('click', () => closeBookingPreviewModal());
  });

  document.querySelectorAll('[data-login-alert-close]').forEach(button => {
    button.addEventListener('click', () => closeLoginAlertModal());
  });

  const loginAlertModal = document.getElementById('loginAlertModal');
  loginAlertModal?.addEventListener('click', event => {
    if (event.target === loginAlertModal) closeLoginAlertModal();
  });

  const jobDetailModal = document.getElementById('jobDetailModal');
  jobDetailModal?.addEventListener('click', event => {
    if (event.target === jobDetailModal) closeJobDetailModal();
  });

  const bookingPreviewModal = document.getElementById('bookingPreviewModal');
  bookingPreviewModal?.addEventListener('click', event => {
    if (event.target === bookingPreviewModal) closeBookingPreviewModal();
  });

  // Handle Login Form Submit
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('loginUsername').value.trim();
      const password = document.getElementById('loginPassword').value;
      
      setLoginGateBusy(true, 'กำลังเข้าสู่ระบบ...');
      setLoginGateStatus('กำลังตรวจสอบชื่อผู้ใช้งานและรหัสผ่าน...');
      
      try {
        const apiBase = (window.location.hostname === 'localhost' ? 'http://localhost:5000/api' : 'https://oracatapi.onrender.com/api');
        const res = await fetch(`${apiBase}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'เข้าสู่ระบบล้มเหลว');
        
        localStorage.setItem('manager_token', data.token);
        localStorage.setItem('oracat_logged_in', 'true');
        localStorage.setItem('oracat_last_activity', Date.now().toString());
        localStorage.setItem('oracat_username', data.user?.username || username);

        // Load settings from backend after login
        const settingsRes = await fetch(`${apiBase}/settings`, {
          headers: { 'Authorization': `Bearer ${data.token}` }
        });
        if (settingsRes.ok) {
          const settingsData = await settingsRes.json();
          applyCloudSettings(settingsData);
        }

        const user = { email: data.user?.username || username, displayName: data.user?.username || username };
        updateLoginGate(user);
        showToast('เข้าสู่ระบบสำเร็จ ยินดีต้อนรับ!', 'success');
      } catch (err) {
        updateLoginGate(null, { message: err.message || 'เข้าสู่ระบบล้มเหลว' });
        showToast(err.message || 'เข้าสู่ระบบล้มเหลว', 'error');
      }
    });
  }
}

function bindClick(id, handler) {
  document.getElementById(id)?.addEventListener('click', handler);
}

function bindInput(id, handler) {
  document.getElementById(id)?.addEventListener('input', handler);
}

function bindChange(id, handler) {
  document.getElementById(id)?.addEventListener('change', handler);
}

const TEST_NOTICE_SESSION_PREFIX = 'oracatManagerTestNoticeSeen:';

/* ──────────────────────────────────────────────────────────
   LOGIN GATE
   ────────────────────────────────────────────────────────── */
function setLoginGateBusy(isBusy, label = '') {
  const btn = document.getElementById('loginGoogleBtn');
  const labelEl = document.getElementById('loginGoogleLabel');
  if (btn) btn.disabled = Boolean(isBusy);
  if (labelEl) labelEl.textContent = label || 'เข้าสู่ระบบด้วย Google';
}

function setLoginGateStatus(message) {
  const status = document.getElementById('loginGateStatus');
  if (status) status.textContent = message || '';
}

function updateLoginGate(user = null, options = {}) {
  if (!document.body) return;

  if (options.pending) {
    document.body.classList.add('auth-pending');
    document.body.classList.remove('auth-ready', 'auth-locked');
    setLoginGateBusy(true, 'กำลังตรวจสอบ...');
    setLoginGateStatus('กำลังตรวจสอบสถานะการเข้าสู่ระบบ...');
    return;
  }

  if (user) {
    document.body.classList.add('auth-ready');
    document.body.classList.remove('auth-pending', 'auth-locked');
    setLoginGateBusy(false);
    setLoginGateStatus(`เข้าสู่ระบบแล้ว: ${user.email || user.displayName || 'Google account'}`);
    showTestNoticeAfterLogin(user);
    window.setTimeout(() => updateSheetSetupUI(), 0);
    return;
  }

  initialLandingResolved = false;
  document.body.classList.add('auth-locked');
  document.body.classList.remove('auth-pending', 'auth-ready');
  setLoginGateBusy(false);
  setLoginGateStatus(options.message || 'กรุณาระบุชื่อผู้ใช้งานและรหัสผ่านเพื่อเข้าใช้งาน Oracat Manager');
}

async function handleLoginGateAuth() {
  if (!window.googleOAuthV3?.login) {
    setLoginGateStatus('Google OAuth ยังไม่พร้อมใช้งาน ลองรีเฟรชหน้าเว็บอีกครั้ง');
    showToast?.('Google OAuth ยังไม่พร้อมใช้งาน', 'error');
    return;
  }

  setLoginGateBusy(true, 'กำลังเปิด Google...');
  setLoginGateStatus('กำลังเปิด Google Popup เพื่อเข้าสู่ระบบ');
  const ok = await window.googleOAuthV3.login();
  if (!ok) {
    updateLoginGate(null);
    return;
  }

  setLoginGateStatus('รอการยืนยันจาก Google...');
  window.setTimeout(() => {
    if (!window.firebaseData?.currentUser?.()) {
      const message = getGoogleLoginTimeoutMessage();
      updateLoginGate(null, { message });
      showToast?.(message, 'error');
    }
  }, 20000);
}

function getGoogleLoginTimeoutMessage() {
  const origin = window.location.origin;
  const lastLoginError = String(window.__lastGoogleLoginError || '').trim();
  const runtimeError = window.runtimeConfigState?.error;
  const clientId = String(window.CONFIG?.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  if (lastLoginError) return lastLoginError;
  if (runtimeError) return `Google Login ยังไม่สำเร็จ: ${runtimeError}`;
  if (!clientId) return 'Google Login ยังไม่สำเร็จ: ไม่พบ GOOGLE_OAUTH_CLIENT_ID จาก backend config';
  return `Google Login ยังไม่สำเร็จ: ตรวจ Firebase Authentication, Render logs และ OAuth origin ${origin}`;
}

function testNoticeSessionKey(user) {
  const identity = user?.uid || user?.email || 'current-user';
  return TEST_NOTICE_SESSION_PREFIX + identity;
}

function showTestNoticeAfterLogin(user) {
  // Disabled trial notice pop-up
}

function closeTestNoticeModal() {
  // Disabled trial notice pop-up
}

let lastActivitySaved = 0;
function resetActivityTimer() {
  if (!localStorage.getItem('manager_token')) return;
  const now = Date.now();
  if (now - lastActivitySaved > 5000) {
    localStorage.setItem('oracat_last_activity', now.toString());
    lastActivitySaved = now;
  }
}

function startInactivityCheck() {
  // Initialize current activity timestamp on startup to prevent stale value logouts
  localStorage.setItem('oracat_last_activity', Date.now().toString());

  const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
  ACTIVITY_EVENTS.forEach(event => {
    window.addEventListener(event, resetActivityTimer, { passive: true });
  });

  window.setInterval(() => {
    if (localStorage.getItem('manager_token')) {
      const lastActive = Number(localStorage.getItem('oracat_last_activity') || 0);
      // Extend timeout to 7 days for private photographer dashboard
      if (lastActive && (Date.now() - lastActive > 7 * 24 * 60 * 60 * 1000)) {
        showToast?.('เซสชันหมดอายุหลังจากไม่มีการใช้งานเป็นเวลา 7 วัน', 'warning');
        localStorage.removeItem('manager_token');
        localStorage.removeItem('oracat_logged_in');
        updateLoginGate(null);
      }
    }
  }, 30000);
}

/* ──────────────────────────────────────────────────────────
   THEME MANAGER
   ────────────────────────────────────────────────────────── */
function initTheme() {
  const savedTheme = localStorage.getItem('oracatManagerTheme') === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeToggle(savedTheme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const nextTheme = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', nextTheme);
  localStorage.setItem('oracatManagerTheme', nextTheme);
  updateThemeToggle(nextTheme);
  renderChart();
}

function updateThemeToggle(theme) {
  const button = document.getElementById('themeToggleBtn');
  if (!button) return;
  const nextLabel = theme === 'light' ? 'มืด' : 'สว่าง';
  button.textContent = `ธีม${nextLabel}`;
  button.title = `สลับเป็นธีม${nextLabel}`;
  button.setAttribute('aria-label', `สลับเป็นธีม${nextLabel}`);
}

/* ──────────────────────────────────────────────────────────
   LOGIN ALERT MANAGER
   ────────────────────────────────────────────────────────── */
let loginAlertShown = false;
function checkLoginAlerts(alerts) {
  if (loginAlertShown) return;
  const deliveryAlerts = Array.isArray(alerts) ? alerts : [];
  if (deliveryAlerts.length > 0) {
    const listHtml = deliveryAlerts.slice(0, 8).map(item => `
      <div class="delivery-alert-item ${item.isOverdue ? 'overdue' : item.daysLeft === 0 ? 'due-today' : 'due-soon'}">
        <div class="delivery-alert-main">
          <strong>${appEscHtml(item.client)}</strong>
          <span>${appEscHtml(item.typeLabel)} • งานวันที่ ${appEscHtml(formatDate(item.jobDateText))}</span>
        </div>
        <div class="delivery-alert-meta">
          <b>${appEscHtml(item.statusText)}</b>
          <small>กำหนดส่ง ${appEscHtml(formatDate(item.dueDateText))}</small>
        </div>
      </div>
    `).join('');
    const listEl = document.getElementById('loginAlertList');
    if (listEl) listEl.innerHTML = listHtml;

    document.getElementById('loginAlertModal')?.classList.add('open');
    loginAlertShown = true;
  }
}

function closeLoginAlertModal() {
  document.getElementById('loginAlertModal')?.classList.remove('open');
}

/* ──────────────────────────────────────────────────────────
   PAGE ROUTING
   ────────────────────────────────────────────────────────── */
const PAGE_TITLES = {
  dashboard: 'Dashboard',
  bookings: 'คำขอจองคิวงาน',
  queue: 'คิวงาน',
  gallery: 'จัดการคลังรูปภาพผลงาน',
  revenue: 'รายรับ',
  tax: 'โปรแกรมคำนวณภาษี',
  documents: 'เอกสาร',
  settings: 'ตั้งค่า',
};

let initialLandingResolved = false;

function routeInitialLanding() {
  if (initialLandingResolved || !window.firebaseData?.isReady?.()) return;
  initialLandingResolved = true;
  showPage(isSheetSetupRequired() ? 'settings' : 'dashboard', { quietGate: true });
}

function showPage(page, options = {}) {
  let target = page;
  if (isSheetSetupRequired() && page !== 'settings') {
    target = 'settings';
    if (!options.quietGate) {
      showToast('กรุณาตั้งค่า Google Sheet ก่อนเริ่มใช้งาน', 'error');
    }
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const targetPage = document.getElementById(`page-${target}`);
  if (targetPage) targetPage.classList.add('active');

  const targetBtn = document.querySelector(`.nav-btn[data-page="${target}"]`);
  if (targetBtn) targetBtn.classList.add('active');

  document.getElementById('pageTitle').textContent = PAGE_TITLES[target] || target;

  // Page-specific refresh
  if (target === 'dashboard') { updateDashboard(); }
  if (target === 'bookings') { window.refreshBookingsTab?.(); }
  if (target === 'queue') { renderQueueTable(); }
  if (target === 'gallery') { window.refreshGalleryTab?.(); }
  if (target === 'revenue') { renderRevenue(); }
  if (target === 'tax') { window.renderTaxCalculator?.(); }
  if (target === 'documents') { refreshBookingDocumentJobs(); }
  if (target === 'settings') { loadSettingsForm(); }

  // Close sidebar on mobile
  if (window.innerWidth <= 900) {
    document.getElementById('sidebar').classList.remove('open');
  }
}

/* ──────────────────────────────────────────────────────────
   SIDEBAR TOGGLE (MOBILE)
   ────────────────────────────────────────────────────────── */
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

/* ──────────────────────────────────────────────────────────
   TODAY DATE
   ────────────────────────────────────────────────────────── */
function setTodayDate() {
  const d = new Date();
  const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  document.getElementById('todayDate').textContent = d.toLocaleDateString('th-TH', opts);
}

function setupPickerIconClicks() {
  document.querySelectorAll('input[type="date"].form-control, input[type="time"].form-control').forEach(input => {
    input.addEventListener('pointerdown', e => {
      const rect = input.getBoundingClientRect();
      const iconZoneStart = rect.right - 44;
      if (e.clientX < iconZoneStart) return;

      e.preventDefault();
      input.focus();
      if (typeof input.showPicker === 'function') {
        try { input.showPicker(); return; } catch { }
      }
      input.click();
    });
  });
}

/* ──────────────────────────────────────────────────────────
   SETTINGS
   ────────────────────────────────────────────────────────── */
const APP_LOCAL_DATA_KEYS = [
  'jobs',
  'appSettings',
  'lastSheetSync',
  'deletedJobIds',
  'calendarDeleteQueue',
  'oracat_last_activity',
  'oracat_logged_in',
];

const sheetAccessState = {
  id: '',
  status: 'idle',
  message: '',
};
let sheetAccessCheckTimer = null;

const appSettingsState = {};
const DEFAULT_DELIVERY_DAYS = 30;
const DEFAULT_JOB_TYPE_LABELS = { ...JOB_TYPE_LABELS };
const DEFAULT_JOB_TYPES = Object.entries(DEFAULT_JOB_TYPE_LABELS).map(([id, label]) => ({
  id,
  label,
  active: true,
  system: true,
  deliveryDays: DEFAULT_DELIVERY_DAYS,
}));

function defaultSettings() {
  return {
    sheetId: '',
    calendarId: CONFIG.CALENDAR_ID || 'primary',
    studioName: '',
    phone: '',
    email: '',
    facebook: '',
    bookingTerms: '',
    hourRate: 1500,
    jobTypes: cloneJobTypes(DEFAULT_JOB_TYPES),
    lastSheetSync: null,
    taxPaidReminders: [],
    welcome_title: '',
    welcome_subtitle: '',
    pricing_title: '',
    pricing_subtitle: '',
    promptpay_id: '',
    thunder_token: '',
    packages: '[]',
  };
}

function setSettingsState(settings = {}, options = {}) {
  const base = options.replace ? defaultSettings() : { ...defaultSettings(), ...appSettingsState };
  const next = {
    ...base,
    ...settings,
  };

  appSettingsState.sheetId = getSpreadsheetId(next.sheetId || '');
  appSettingsState.calendarId = next.calendarId || 'primary';
  appSettingsState.studioName = String(next.studioName || '');
  appSettingsState.phone = String(next.phone || '');
  appSettingsState.email = String(next.email || '');
  appSettingsState.facebook = String(next.facebook || '');
  appSettingsState.bookingTerms = String(next.bookingTerms || '');
  appSettingsState.hourRate = nonNegativeNumber(next.hourRate, 1500);
  appSettingsState.jobTypes = normalizeJobTypeSettings(next.jobTypes);
  appSettingsState.lastSheetSync = next.lastSheetSync || null;
  appSettingsState.taxPaidReminders = normalizeTaxPaidReminders(next.taxPaidReminders);
  
  // Custom API integrations state mapping
  appSettingsState.welcome_title = String(next.welcome_title || '');
  appSettingsState.welcome_subtitle = String(next.welcome_subtitle || '');
  appSettingsState.pricing_title = String(next.pricing_title || '');
  appSettingsState.pricing_subtitle = String(next.pricing_subtitle || '');
  appSettingsState.promptpay_id = String(next.promptpay_id || '');
  appSettingsState.thunder_token = String(next.thunder_token || '');
  appSettingsState.packages = String(next.packages || '[]');

  syncJobTypeLabels(appSettingsState.jobTypes);
  CONFIG.SHEET_ID = appSettingsState.sheetId;
  CONFIG.CALENDAR_ID = appSettingsState.calendarId;
  updateSidebarUserProfile();
}

function cloneJobTypes(types) {
  return (Array.isArray(types) ? types : []).map(type => ({ ...type }));
}

function normalizeJobTypeId(id) {
  return String(id || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeDeliveryDays(value, fallback = DEFAULT_DELIVERY_DAYS) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.round(number));
}

function normalizeJobTypeSettings(jobTypes) {
  const defaults = cloneJobTypes(DEFAULT_JOB_TYPES);
  const defaultIds = new Set(defaults.map(type => type.id));
  const byId = new Map(defaults.map(type => [type.id, type]));
  const customOrder = [];

  (Array.isArray(jobTypes) ? jobTypes : []).forEach(item => {
    const id = normalizeJobTypeId(item?.id);
    const label = String(item?.label || '').trim();
    if (!id || !label) return;
    const existing = byId.get(id);
    const normalized = {
      id,
      label,
      active: item.active !== false,
      system: existing?.system || defaultIds.has(id),
      deliveryDays: normalizeDeliveryDays(item?.deliveryDays, existing?.deliveryDays ?? DEFAULT_DELIVERY_DAYS),
    };
    byId.set(id, normalized);
    if (!defaultIds.has(id) && !customOrder.includes(id)) customOrder.push(id);
  });

  const result = [
    ...defaults.map(type => byId.get(type.id)),
    ...customOrder.map(id => byId.get(id)),
  ].filter(Boolean);

  if (!result.some(type => type.active !== false) && result[0]) result[0].active = true;
  return result;
}

function syncJobTypeLabels(jobTypes) {
  Object.keys(JOB_TYPE_LABELS).forEach(id => delete JOB_TYPE_LABELS[id]);
  Object.assign(JOB_TYPE_LABELS, DEFAULT_JOB_TYPE_LABELS);
  normalizeJobTypeSettings(jobTypes).forEach(type => {
    JOB_TYPE_LABELS[type.id] = type.label;
  });
}

function normalizeTaxPaidReminders(keys) {
  return Array.from(new Set((Array.isArray(keys) ? keys : [])
    .map(key => String(key || '').trim())
    .filter(Boolean)));
}

function resetSettingsState() {
  setSettingsState(defaultSettings(), { replace: true });
}

function getSettings() {
  return {
    ...appSettingsState,
    jobTypes: cloneJobTypes(appSettingsState.jobTypes),
    taxPaidReminders: normalizeTaxPaidReminders(appSettingsState.taxPaidReminders),
  };
}

function configuredSheetId() {
  return getSpreadsheetId(getSettings().sheetId || CONFIG.SHEET_ID || '');
}

function isSheetSetupRequired() {
  return false; // Google Sheets not required with Supabase backend
}

function updateSheetSetupUI() {
  const requiresSetup = false; // Google Sheets not required with Supabase backend
  document.body?.classList.toggle('sheet-required', requiresSetup);

  document.querySelectorAll('.nav-btn').forEach(button => {
    button.disabled = false;
    button.title = '';
  });

  const createButton = document.getElementById('createBookingSheetBtn');
  const createInfo = document.getElementById('sheetCreateInfo');
  if (!createButton) return;

  createButton.disabled = true;
  createButton.textContent = 'ไม่ใช้งาน Google Sheets';

  if (createInfo) {
    createInfo.textContent = 'ระบบใช้ Supabase เป็นฐานข้อมูลหลัก ไม่ต้องตั้งค่า Google Sheet';
  }
}

function enforceSheetSetupGate() {
  updateSheetSetupUI();
  if (!isSheetSetupRequired()) return false;
  const activePage = document.querySelector('.page.active')?.id?.replace('page-', '') || '';
  if (activePage !== 'settings') showPage('settings', { quietGate: true });
  return true;
}

function scheduleSheetAccessCheck() {
  window.clearTimeout(sheetAccessCheckTimer);
  sheetAccessCheckTimer = window.setTimeout(() => verifyCurrentSheetAccess(), 300);
  updateSheetSetupUI();
}

async function verifyCurrentSheetAccess() {
  const sheetId = configuredSheetId();
  sheetAccessState.id = sheetId;
  sheetAccessState.message = '';

  if (!sheetId || !window.firebaseData?.isReady?.()) {
    sheetAccessState.status = 'idle';
    updateSheetSetupUI();
    return;
  }

  if (!window.isGoogleSignedIn?.() || !window.checkSpreadsheetExists) {
    sheetAccessState.status = 'unverified';
    sheetAccessState.message = 'เชื่อมต่อ Google เพื่อให้ระบบตรวจสอบว่า Sheet ID เดิมยังใช้ได้';
    updateSheetSetupUI();
    return;
  }

  sheetAccessState.status = 'checking';
  updateSheetSetupUI();
  const result = await window.checkSpreadsheetExists(sheetId);
  if (sheetAccessState.id !== configuredSheetId()) return;

  if (result.exists === true) {
    sheetAccessState.status = 'exists';
    sheetAccessState.message = result.title || compactId(sheetId);
  } else if (result.exists === false) {
    sheetAccessState.status = 'missing';
    sheetAccessState.message = result.error || 'ตรวจไม่พบ Sheet ID เดิม';
  } else {
    sheetAccessState.status = 'unverified';
    sheetAccessState.message = result.error || 'ยังตรวจสอบ Sheet ID ไม่สำเร็จ';
  }
  updateSheetSetupUI();
}

function loadSettings() {
  resetSettingsState();
  updateSidebarUserProfile();
  updateSheetSetupUI();
}

function updateSidebarUserProfile() {
  const user = window.firebaseData?.currentUser?.();
  const emailEl = document.getElementById('sidebarUserEmail');
  const studioEl = document.getElementById('sidebarUserStudio');

  if (emailEl) {
    emailEl.textContent = user?.email || 'ยังไม่ได้เข้าสู่ระบบ';
  }
  if (studioEl) {
    studioEl.textContent = appSettingsState.studioName || 'ยังไม่ได้ตั้งค่า';
  }
}

function loadSettingsForm() {
  const s = getSettings();
  const nameInput = document.getElementById('settingName');
  const phoneInput = document.getElementById('settingPhone');
  const emailInput = document.getElementById('settingEmail');
  const facebookInput = document.getElementById('settingFacebook');
  const bookingTermsInput = document.getElementById('settingBookingTerms');
  const hourRateInput = document.getElementById('settingHourRate');
  if (nameInput) nameInput.value = s.studioName || '';
  if (phoneInput) phoneInput.value = s.phone || '';
  if (emailInput) emailInput.value = s.email || '';
  if (facebookInput) facebookInput.value = s.facebook || '';
  if (bookingTermsInput) bookingTermsInput.value = s.bookingTerms || '';
  if (hourRateInput) hourRateInput.value = s.hourRate || '';

  // Expose additional settings
  const wtInput = document.getElementById('settingWelcomeTitle');
  if (wtInput) wtInput.value = s.welcome_title || '';
  const wsInput = document.getElementById('settingWelcomeSubtitle');
  if (wsInput) wsInput.value = s.welcome_subtitle || '';
  const prTitleInput = document.getElementById('settingPricingTitle');
  if (prTitleInput) prTitleInput.value = s.pricing_title || '';
  const prSubInput = document.getElementById('settingPricingSubtitle');
  if (prSubInput) prSubInput.value = s.pricing_subtitle || '';
  const ppInput = document.getElementById('settingPromptPay');
  if (ppInput) ppInput.value = s.promptpay_id || '';
  const ttInput = document.getElementById('settingThunderToken');
  if (ttInput) ttInput.value = s.thunder_token || '';

  renderJobTypeSettings();
  renderJobTypeSelect();
  updateSheetSyncInfo();
  scheduleSheetAccessCheck();
  renderPackageSettings();
}

/* ──────────────────────────────────────────────────────────
   PACKAGES & PRICING
   ────────────────────────────────────────────────────────── */
function getPackagesList() {
  try {
    return JSON.parse(appSettingsState.packages || '[]');
  } catch (e) {
    return [];
  }
}

function renderPackageSettings() {
  const list = document.getElementById('packageSettingsList');
  if (!list) return;

  const packages = getPackagesList();
  if (packages.length === 0) {
    list.innerHTML = '<div class="settings-hint">ไม่มีแพ็กเกจราคาขณะนี้</div>';
    return;
  }

  list.innerHTML = packages.map(pkg => `
    <div class="card" style="margin-bottom: 0; padding: 14px; background: rgba(5,5,5,0.4); border: 1px solid var(--border);">
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-bottom: 12px;">
        <span style="font-weight: bold; color: var(--gold-light); font-size: 0.85rem;">แพ็กเกจ: ${appEscHtml(pkg.name)}</span>
        <button class="action-btn del" type="button" data-pkg-action="delete" data-pkg-id="${appEscAttr(pkg.id)}" style="padding: 4px 8px; font-size: 0.75rem;">ลบ</button>
      </div>
      <div class="form-grid" style="display: grid; grid-template-columns: 1fr; gap: 10px;">
        <div class="form-group">
          <label>ชื่อแพ็กเกจ</label>
          <input type="text" class="form-control" data-pkg-field="name" data-pkg-id="${appEscAttr(pkg.id)}" value="${appEscAttr(pkg.name)}" style="font-size: 0.8rem; padding: 8px;" />
        </div>
        <div class="form-group">
          <label>ราคาเริ่มต้น (บาท)</label>
          <input type="text" class="form-control" data-pkg-field="price" data-pkg-id="${appEscAttr(pkg.id)}" value="${appEscAttr(pkg.price)}" style="font-size: 0.8rem; padding: 8px;" />
        </div>
        <div class="form-group">
          <label>ป้ายกำกับพิเศษ (Badge)</label>
          <input type="text" class="form-control" data-pkg-field="badge" data-pkg-id="${appEscAttr(pkg.id)}" value="${appEscAttr(pkg.badge || '')}" style="font-size: 0.8rem; padding: 8px;" />
        </div>
        <div class="form-group full-span">
          <label>รายละเอียด / คุณสมบัติ (บรรทัดละ 1 ข้อ)</label>
          <textarea class="form-control" data-pkg-field="features" data-pkg-id="${appEscAttr(pkg.id)}" rows="3" style="font-size: 0.8rem; padding: 8px; font-family: monospace;">${appEscHtml((pkg.features || []).join('\n'))}</textarea>
        </div>
      </div>
      <button class="btn-primary" type="button" data-pkg-action="save" data-pkg-id="${appEscAttr(pkg.id)}" style="margin-top: 10px; padding: 6px 12px; font-size: 0.8rem; width: auto; align-self: flex-end;">บันทึกแพ็กเกจนี้</button>
    </div>
  `).join('');

  bindPackageActions(list);
}

function bindPackageActions(list) {
  list.querySelectorAll('[data-pkg-action]').forEach(button => {
    button.addEventListener('click', async () => {
      const id = button.dataset.pkgId;
      const action = button.dataset.pkgAction;
      const currentPkgs = getPackagesList();

      if (action === 'delete') {
        if (!confirm('ต้องการลบแพ็กเกจนี้ใช่หรือไม่?')) return;
        const updated = currentPkgs.filter(p => p.id !== id);
        await savePackagesState(updated, 'ลบแพ็กเกจเรียบร้อยแล้ว ✓');
      } else if (action === 'save') {
        const nameVal = list.querySelector(`[data-pkg-field="name"][data-pkg-id="${id}"]`).value.trim();
        const priceVal = list.querySelector(`[data-pkg-field="price"][data-pkg-id="${id}"]`).value.trim();
        const badgeVal = list.querySelector(`[data-pkg-field="badge"][data-pkg-id="${id}"]`).value.trim();
        const featuresVal = list.querySelector(`[data-pkg-field="features"][data-pkg-id="${id}"]`).value.trim();

        if (!nameVal) {
          showToast('ชื่อแพ็กเกจห้ามว่าง', 'error');
          return;
        }

        const updated = currentPkgs.map(p => {
          if (p.id === id) {
            return {
              id: p.id,
              name: nameVal,
              price: priceVal,
              badge: badgeVal,
              features: featuresVal.split('\n').map(f => f.trim()).filter(Boolean)
            };
          }
          return p;
        });

        await savePackagesState(updated, 'บันทึกแก้ไขแพ็กเกจเรียบร้อย ✓');
      }
    });
  });
}

async function addPackageSetting() {
  const nameEl = document.getElementById('newPkgName');
  const priceEl = document.getElementById('newPkgPrice');
  const badgeEl = document.getElementById('newPkgBadge');
  const featuresEl = document.getElementById('newPkgFeatures');

  const name = nameEl?.value.trim();
  const price = priceEl?.value.trim() || '0';
  const badge = badgeEl?.value.trim() || '';
  const featuresStr = featuresEl?.value.trim() || '';

  if (!name) {
    showToast('กรุณากรอกชื่อแพ็กเกจ', 'error');
    return;
  }

  const currentPkgs = getPackagesList();
  const newId = 'pkg_' + Date.now();
  const features = featuresStr.split('\n').map(f => f.trim()).filter(Boolean);

  const updated = [...currentPkgs, { id: newId, name, price, badge, features }];

  const success = await savePackagesState(updated, 'เพิ่มแพ็กเกจเรียบร้อย ✓');
  if (success) {
    if (nameEl) nameEl.value = '';
    if (priceEl) priceEl.value = '';
    if (badgeEl) badgeEl.value = '';
    if (featuresEl) featuresEl.value = '';
  }
}

async function savePackagesState(updatedPackages, successMessage) {
  const token = localStorage.getItem('manager_token');
  if (!token) {
    showToast('กรุณา Login ก่อนบันทึกการตั้งค่า', 'error');
    return false;
  }

  const previous = appSettingsState.packages;
  const packagesJson = JSON.stringify(updatedPackages);
  setSettingsState({ packages: packagesJson });
  renderPackageSettings();

  const apiBase = (typeof API_BASE !== 'undefined' ? API_BASE : null)
    || window.APP_CONFIG?.API_BASE
    || (window.location.hostname === 'localhost' ? 'http://localhost:5000/api' : 'https://oracatapi.onrender.com/api');

  try {
    const res = await fetch(`${apiBase}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ settings: { packages: packagesJson } }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'บันทึกล้มเหลว');
    showToast(successMessage, 'success');
    return true;
  } catch (e) {
    setSettingsState({ packages: previous });
    renderPackageSettings();
    showToast('บันทึกแพ็กเกจล้มเหลว: ' + e.message, 'error');
    return false;
  }
}

function activeJobTypes(selectedType = '') {
  const activeTypes = (appSettingsState.jobTypes || []).filter(type => type.active !== false);
  const selectedId = normalizeJobTypeId(selectedType);
  if (selectedId && !activeTypes.some(type => type.id === selectedId)) {
    activeTypes.push({
      id: selectedId,
      label: JOB_TYPE_LABELS[selectedId] || selectedType,
      active: true,
      system: false,
      readonly: true,
    });
  }
  return activeTypes;
}

function renderJobTypeSelect(selectedType = '') {
  const select = document.getElementById('jobType');
  if (!select) return '';

  const current = normalizeJobTypeId(selectedType || select.value);
  const types = activeJobTypes(current);
  select.innerHTML = types.map(type => (
    `<option value="${appEscAttr(type.id)}">${appEscHtml(type.label)}</option>`
  )).join('');

  const nextValue = types.some(type => type.id === current) ? current : (types[0]?.id || '');
  if (nextValue) select.value = nextValue;
  return nextValue;
}

function renderJobTypeSettings() {
  const list = document.getElementById('jobTypeSettingsList');
  if (!list) return;

  const activeTypes = (appSettingsState.jobTypes || []).filter(type => type.active !== false);
  if (!activeTypes.length) {
    list.innerHTML = '<div class="job-type-empty">ยังไม่มีประเภทงาน</div>';
    return;
  }

  const canRemove = activeTypes.length > 1;
  list.innerHTML = activeTypes.map(type => `
    <div class="job-type-row">
      <div class="job-type-field">
        <label>ประเภทงาน</label>
        <input
          type="text"
          class="form-control"
          id="jobTypeLabel_${appEscAttr(type.id)}"
          value="${appEscAttr(type.label)}"
          aria-label="ชื่อประเภทงาน ${appEscAttr(type.label)}"
        />
      </div>
      <div class="job-type-field job-type-delivery-field">
        <label>ส่งในกี่วัน</label>
        <input
          type="number"
          class="form-control"
          id="jobTypeDelivery_${appEscAttr(type.id)}"
          min="0"
          step="1"
          value="${normalizeDeliveryDays(type.deliveryDays)}"
          aria-label="จำนวนวันส่งงาน ${appEscAttr(type.label)}"
        />
      </div>
      <button class="action-btn" type="button" data-job-type-action="save" data-job-type-id="${appEscAttr(type.id)}">บันทึก</button>
      <button class="action-btn del" type="button" data-job-type-action="remove" data-job-type-id="${appEscAttr(type.id)}" ${canRemove ? '' : 'disabled'}>ลบ</button>
    </div>
  `).join('');
  bindJobTypeSettingsActions(list);
}

function bindJobTypeSettingsActions(list) {
  list.querySelectorAll('[data-job-type-action]').forEach(button => {
    button.addEventListener('click', () => {
      const id = button.dataset.jobTypeId || '';
      if (!id) return;
      if (button.dataset.jobTypeAction === 'save') {
        saveJobTypeSetting(id);
      } else if (button.dataset.jobTypeAction === 'remove') {
        removeJobTypeSetting(id);
      }
    });
  });
}

function makeJobTypeId(label) {
  const slug = normalizeJobTypeId(label);
  const base = slug || 'type';
  const existingIds = new Set((appSettingsState.jobTypes || []).map(type => type.id));
  if (!existingIds.has(base)) return base;

  let nextId = `${base}-${Date.now().toString(36)}`;
  while (existingIds.has(nextId)) nextId = `${base}-${Math.random().toString(36).slice(2, 7)}`;
  return nextId;
}

function refreshJobTypeViews() {
  renderJobTypeSettings();
  renderJobTypeSelect();
  renderQueueTable();
  updateDashboard();
  if (document.getElementById('page-revenue')?.classList.contains('active')) renderRevenue();
  if (document.getElementById('page-documents')?.classList.contains('active')) refreshBookingDocumentJobs();
}

async function persistJobTypeSettings(nextTypes, successMessage) {
  const token = localStorage.getItem('manager_token');
  if (!token) {
    showToast('กรุณา Login ก่อนแก้ไขประเภทงาน', 'error');
    return false;
  }

  const previous = getSettings();
  setSettingsState({ jobTypes: nextTypes });
  refreshJobTypeViews();

  const apiBase = (typeof API_BASE !== 'undefined' ? API_BASE : null)
    || window.APP_CONFIG?.API_BASE
    || (window.location.hostname === 'localhost' ? 'http://localhost:5000/api' : 'https://oracatapi.onrender.com/api');

  try {
    const res = await fetch(`${apiBase}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ settings: { job_types: JSON.stringify(appSettingsState.jobTypes) } }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'บันทึกล้มเหลว');
    showToast(successMessage || 'บันทึกประเภทงานแล้ว ✓', 'success');
    return true;
  } catch (e) {
    setSettingsState(previous, { replace: true });
    refreshJobTypeViews();
    showToast('บันทึกประเภทงานไม่สำเร็จ: ' + (e.message || e), 'error');
    return false;
  }
}

async function addJobTypeSetting() {
  const input = document.getElementById('newJobTypeLabel');
  const label = input?.value.trim() || '';
  if (!label) {
    showToast('กรุณาใส่ชื่อประเภทงาน', 'error');
    return;
  }

  const nextTypes = cloneJobTypes(appSettingsState.jobTypes);
  const existing = nextTypes.find(type => type.label.trim().toLowerCase() === label.toLowerCase());
  if (existing) {
    if (existing.active !== false) {
      showToast('มีประเภทงานนี้อยู่แล้ว', 'error');
      return;
    }
    existing.active = true;
  } else {
    nextTypes.push({
      id: makeJobTypeId(label),
      label,
      active: true,
      system: false,
      deliveryDays: DEFAULT_DELIVERY_DAYS,
    });
  }

  const saved = await persistJobTypeSettings(nextTypes, 'เพิ่มประเภทงานแล้ว ✓');
  if (saved && input) input.value = '';
}

async function saveJobTypeSetting(typeId) {
  const id = normalizeJobTypeId(typeId);
  const input = document.getElementById(`jobTypeLabel_${id}`);
  const deliveryInput = document.getElementById(`jobTypeDelivery_${id}`);
  const label = input?.value.trim() || '';
  if (!id || !label) {
    showToast('ชื่อประเภทงานห้ามว่าง', 'error');
    return;
  }

  const nextTypes = cloneJobTypes(appSettingsState.jobTypes);
  const duplicate = nextTypes.find(type => type.id !== id && type.active !== false && type.label.trim().toLowerCase() === label.toLowerCase());
  if (duplicate) {
    showToast('มีประเภทงานชื่อนี้อยู่แล้ว', 'error');
    return;
  }

  const target = nextTypes.find(type => type.id === id);
  if (!target) return;
  target.label = label;
  target.deliveryDays = normalizeDeliveryDays(deliveryInput?.value, target.deliveryDays ?? DEFAULT_DELIVERY_DAYS);
  await persistJobTypeSettings(nextTypes, 'บันทึกประเภทงานและกำหนดส่งแล้ว ✓');
}

async function removeJobTypeSetting(typeId) {
  const id = normalizeJobTypeId(typeId);
  const nextTypes = cloneJobTypes(appSettingsState.jobTypes);
  const activeCount = nextTypes.filter(type => type.active !== false).length;
  if (activeCount <= 1) {
    showToast('ต้องเหลือประเภทงานอย่างน้อย 1 รายการ', 'error');
    return;
  }

  const target = nextTypes.find(type => type.id === id);
  if (!target) return;
  target.active = false;
  await persistJobTypeSettings(nextTypes, 'ลบประเภทงานออกจาก dropdown แล้ว ✓');
}

function appEscHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function appEscAttr(value) {
  return appEscHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function saveSettings() {
  saveBusinessInfo();
}

async function saveBusinessInfo() {
  const token = localStorage.getItem('manager_token');
  if (!token) {
    showToast('กรุณา Login ก่อนบันทึกการตั้งค่า', 'error');
    return;
  }
  const previous = getSettings();
  const s = getSettings();
  s.studioName = document.getElementById('settingName')?.value.trim() || '';
  s.phone = document.getElementById('settingPhone')?.value.trim() || '';
  s.email = document.getElementById('settingEmail')?.value.trim() || '';
  s.facebook = document.getElementById('settingFacebook')?.value.trim() || '';
  s.bookingTerms = document.getElementById('settingBookingTerms')?.value.trim() || '';
  s.hourRate = Number(document.getElementById('settingHourRate')?.value) || 1500;
  s.welcome_title = document.getElementById('settingWelcomeTitle')?.value.trim() || '';
  s.welcome_subtitle = document.getElementById('settingWelcomeSubtitle')?.value.trim() || '';
  s.pricing_title = document.getElementById('settingPricingTitle')?.value.trim() || '';
  s.pricing_subtitle = document.getElementById('settingPricingSubtitle')?.value.trim() || '';
  s.promptpay_id = document.getElementById('settingPromptPay')?.value.trim() || '';
  s.thunder_token = document.getElementById('settingThunderToken')?.value.trim() || '';

  setSettingsState(s);

  const apiBase = (typeof API_BASE !== 'undefined' ? API_BASE : null)
    || window.APP_CONFIG?.API_BASE
    || (window.location.hostname === 'localhost' ? 'http://localhost:5000/api' : 'https://oracatapi.onrender.com/api');

  try {
    const res = await fetch(`${apiBase}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ settings: {
        studio_name: s.studioName,
        business_phone: s.phone,
        business_email: s.email,
        business_facebook: s.facebook,
        booking_terms: s.bookingTerms,
        hourly_rate: s.hourRate,
        welcome_title: s.welcome_title,
        welcome_subtitle: s.welcome_subtitle,
        pricing_title: s.pricing_title,
        pricing_subtitle: s.pricing_subtitle,
        promptpay_id: s.promptpay_id,
        thunder_token: s.thunder_token,
      }}),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'บันทึกล้มเหลว');
    showToast('บันทึกข้อมูลธุรกิจไปยังระบบฐานข้อมูลแล้ว ✓', 'success');
  } catch (e) {
    setSettingsState(previous, { replace: true });
    loadSettingsForm();
    showToast('บันทึกข้อมูลธุรกิจไม่สำเร็จ: ' + (e.message || e), 'error');
  }
}



function applyCloudSettings(settings) {
  // Normalize Express API snake_case field names → internal camelCase state
  const raw = settings || {};
  const normalized = {
    ...raw,
    studioName: raw.studioName || raw.studio_name || '',
    phone: raw.phone || raw.business_phone || '',
    email: raw.email || raw.business_email || '',
    facebook: raw.facebook || raw.business_facebook || '',
    bookingTerms: raw.bookingTerms || raw.booking_terms || '',
    hourRate: raw.hourRate || raw.hourly_rate || 1500,
    welcome_title: raw.welcome_title || '',
    welcome_subtitle: raw.welcome_subtitle || '',
    pricing_title: raw.pricing_title || '',
    pricing_subtitle: raw.pricing_subtitle || '',
    promptpay_id: raw.promptpay_id || '',
    thunder_token: raw.thunder_token || '',
    packages: raw.packages || '[]',
    jobTypes: raw.jobTypes || (raw.job_types ? (() => { try { return JSON.parse(raw.job_types); } catch(e) { return []; } })() : []),
  };
  setSettingsState(normalized, { replace: true });

  const nameInput = document.getElementById('settingName');
  if (nameInput) nameInput.value = appSettingsState.studioName || '';
  const phoneInput = document.getElementById('settingPhone');
  if (phoneInput) phoneInput.value = appSettingsState.phone || '';
  const emailInput = document.getElementById('settingEmail');
  if (emailInput) emailInput.value = appSettingsState.email || '';
  const facebookInput = document.getElementById('settingFacebook');
  if (facebookInput) facebookInput.value = appSettingsState.facebook || '';
  const bookingTermsInput = document.getElementById('settingBookingTerms');
  if (bookingTermsInput) bookingTermsInput.value = appSettingsState.bookingTerms || '';
  const hourRateInput = document.getElementById('settingHourRate');
  if (hourRateInput) hourRateInput.value = appSettingsState.hourRate || '';

  // Expose additional settings
  const wtInput = document.getElementById('settingWelcomeTitle');
  if (wtInput) wtInput.value = appSettingsState.welcome_title || '';
  const wsInput = document.getElementById('settingWelcomeSubtitle');
  if (wsInput) wsInput.value = appSettingsState.welcome_subtitle || '';
  const prTitleInput = document.getElementById('settingPricingTitle');
  if (prTitleInput) prTitleInput.value = appSettingsState.pricing_title || '';
  const prSubInput = document.getElementById('settingPricingSubtitle');
  if (prSubInput) prSubInput.value = appSettingsState.pricing_subtitle || '';
  const ppInput = document.getElementById('settingPromptPay');
  if (ppInput) ppInput.value = appSettingsState.promptpay_id || '';
  const ttInput = document.getElementById('settingThunderToken');
  if (ttInput) ttInput.value = appSettingsState.thunder_token || '';
  renderJobTypeSettings();
  renderJobTypeSelect();
  updateSheetSyncInfo();
  scheduleSheetAccessCheck();
  updateSidebarUserProfile();
  renderQueueTable();
  updateDashboard();
  renderPackageSettings();
  if (document.getElementById('page-revenue')?.classList.contains('active')) renderRevenue();
  if (document.getElementById('page-documents')?.classList.contains('active')) refreshBookingDocumentJobs();
  routeInitialLanding();
  enforceSheetSetupGate();
}

function setLastSheetSyncInfo(info) {
  setSettingsState({ lastSheetSync: info || null });
  updateSheetSyncInfo();
}

function updateSheetSyncInfo() {
  const isLoggedIn = Boolean(localStorage.getItem('manager_token'));

  const settingsEl = document.getElementById('sheetSyncInfo');
  if (settingsEl) settingsEl.textContent = 'ระบบนี้ใช้ Supabase ไม่ต้อง Sync Google Sheets';

  const sheetSettingEl = document.getElementById('sheetSettingInfo');
  if (sheetSettingEl) {
    sheetSettingEl.textContent = isLoggedIn
      ? 'ระบบเชื่อมต่อ Supabase — ไม่ต้องตั้งค่า Google Sheet'
      : 'กรุณา Login ก่อนใช้งาน';
  }
  updateSheetSetupUI();
}

function refreshAppData() {
  renderQueueTable();
  updateDashboard();
  if (document.getElementById('page-revenue')?.classList.contains('active')) renderRevenue();
  if (document.getElementById('page-tax')?.classList.contains('active')) window.renderTaxCalculator?.();
  if (document.getElementById('page-documents')?.classList.contains('active')) refreshBookingDocumentJobs();
  if (document.getElementById('page-settings')?.classList.contains('active')) loadSettingsForm();
  if (typeof checkLoginAlerts === 'function' && typeof getDeliveryAlerts === 'function') {
    checkLoginAlerts(getDeliveryAlerts(new Date(), getJobs()));
  }
  enforceSheetSetupGate();
}

function clearPersistentAppData() {
  APP_LOCAL_DATA_KEYS.forEach(key => localStorage.removeItem(key));
  Object.keys(localStorage)
    .filter(key => key.startsWith('firebaseImportDone_'))
    .forEach(key => localStorage.removeItem(key));
  window.clearGoogleSyncState?.();
}

function clearAppData(options = {}) {
  window.clearJobsCache?.();
  resetSettingsState();
  window.resetTaxCalculator?.();
  closeJobModal?.({ clearDraft: true });
  closeJobDetailModal?.();
  closeBookingPreviewModal?.();
  [
    'searchInput',
    'filterMonth',
    'filterJobType',
    'filterStatus',
    'settingName',
    'settingPhone',
    'settingEmail',
    'settingFacebook',
    'settingBookingTerms',
    'settingHourRate',
    'newJobTypeLabel',
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  if (options.clearPersistent) clearPersistentAppData();
  updateSheetSyncInfo();
  refreshAppData();
  if (!options.quiet) showToast('ล้างข้อมูลหน้าเว็บแล้ว');
}

window.applyCloudSettings = applyCloudSettings;
window.updateSidebarUserProfile = updateSidebarUserProfile;
window.renderJobTypeSelect = renderJobTypeSelect;
window.addJobTypeSetting = addJobTypeSetting;
window.saveJobTypeSetting = saveJobTypeSetting;
window.removeJobTypeSetting = removeJobTypeSetting;
window.setLastSheetSyncInfo = setLastSheetSyncInfo;
window.clearAppData = clearAppData;
window.refreshAppData = refreshAppData;
window.isSheetSetupRequired = isSheetSetupRequired;
window.scheduleSheetAccessCheck = scheduleSheetAccessCheck;
window.updateLoginGate = updateLoginGate;
window.handleLoginGateAuth = handleLoginGateAuth;

/* ──────────────────────────────────────────────────────────
   TOAST NOTIFICATIONS
   ────────────────────────────────────────────────────────── */
let toastTimer = null;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show' + (type ? ` ${type}` : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); }, 3000);
}

window.showToast = showToast;

/* ──────────────────────────────────────────────────────────
   KEYBOARD SHORTCUTS
   ────────────────────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeLoginAlertModal();
    closeJobDetailModal();
    closeBookingPreviewModal();
    closeJobModal({ preserveDraft: true });
  }
  if (e.key === 'n' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    openJobModal();
  }
});
