// ============================================================
//  firebase-data.js — Mock Firebase Data Layer using SQL Backend
// ============================================================

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
  ? 'http://localhost:5000/api' 
  : 'https://oracatapi.onrender.com/api';

const state = {
  user: null,
  configured: true,
};

function isFirebaseConfigured() {
  return true;
}

function isAppCheckConfigured() {
  return false;
}

function isFirebaseReady() {
  return !!localStorage.getItem('manager_token');
}

function currentUser() {
  if (!state.user) {
    try {
      state.user = JSON.parse(localStorage.getItem('manager_user') || 'null');
    } catch (_) {}
  }
  return state.user;
}

function getJobsCollectionName() {
  return 'oracat-jobs';
}

function updateFirebaseAuthUI(user) {
  const activeUser = user !== undefined ? user : currentUser();

  if (activeUser) {
    window.updateSidebarUserProfile?.();
    window.updateLoginGate?.({ email: activeUser.username, displayName: activeUser.displayName });
  } else {
    window.updateSidebarUserProfile?.();
    window.updateLoginGate?.(null);
  }
}

// Map SQLite booking data model to frontend Job model
function mapBookingToJob(b) {
  return {
    id: String(b.id),
    client: b.client_name || '',
    type: b.job_type || 'custom',
    date: b.event_date || '',
    startTime: b.start_time || '',
    endTime: b.end_time || '',
    location: b.location || '',
    price: Number(b.price) || 0,
    deposit: Number(b.deposit) || 0,
    depositRefunded: false,
    isCash: Boolean(b.is_cash), // mapping isCash
    status: b.status || 'pending',
    note: b.note || '',
    images: b.slip_image ? [{ id: 'img_1', name: 'slip.jpg', mimeType: 'image/jpeg', size: 100, dataUrl: b.slip_image }] : [],
    bookingDocument: b.slip_image ? { dataUrl: b.slip_image, fileName: 'booking_slip.jpg' } : null,
    createdAt: b.created_at || '',
    updatedAt: b.updated_at || '',
  };
}

// Fetch jobs (approved bookings) from backend Express API
async function refreshJobs() {
  const token = localStorage.getItem('manager_token');
  if (!token) return;

  try {
    const res = await fetch(`${API_BASE}/bookings`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      if (res.status === 401) {
        signOutFirebase();
        return;
      }
      throw new Error('Failed to load bookings');
    }
    const bookings = await res.json();
    
    // In our SQLite backend, approved bookings act as active jobs in the queue.
    // Let's filter bookings by status to match. Wait, the queue can show: pending, confirmed, done, cancelled.
    // Let's map all bookings (excluding rejected) to jobs:
    const activeBookings = bookings.filter(b => b.status !== 'rejected');
    const jobs = activeBookings.map(mapBookingToJob);
    
    window.setJobsFromFirebase?.(jobs);
  } catch (err) {
    console.error('Failed to refresh jobs:', err);
  }
}

// Fetch settings from backend Express API
async function loadSettings() {
  const token = localStorage.getItem('manager_token');
  if (!token) return;

  try {
    const res = await fetch(`${API_BASE}/settings`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Failed to load settings');
    const s = await res.json();

    let jobTypesList = [];
    try {
      if (s.job_types) jobTypesList = JSON.parse(s.job_types);
    } catch (_) {}

    const mapped = {
      sheetId: s.google_sheet_id || '',
      studioName: s.studio_name || '',
      phone: s.business_phone || '',
      email: s.business_email || '',
      facebook: s.business_facebook || '',
      bookingTerms: s.booking_terms || '',
      hourRate: Number(s.hourly_rate) || 1500,
      jobTypes: jobTypesList.map(t => ({
        id: t.id,
        label: t.label,
        active: true,
        system: false,
        deliveryDays: t.days || 30,
        deposit: t.deposit || 1000,
      })),
      lastSheetSync: null,
      taxPaidReminders: [],
      packages: s.packages || '[]',
      // Extra values to fill settings form inputs
      promptpay_id: s.promptpay_id || '',
      thunder_token: s.thunder_token || '',
      welcome_title: s.welcome_title || '',
      welcome_subtitle: s.welcome_subtitle || '',
      pricing_title: s.pricing_title || '',
      pricing_subtitle: s.pricing_subtitle || '',
    };

    window.applyCloudSettings?.(mapped);
    
    // Fill custom inputs if they exist
    const ppEl = document.getElementById('settingPromptPay');
    if (ppEl) ppEl.value = mapped.promptpay_id;
    const ttEl = document.getElementById('settingThunderToken');
    if (ttEl) ttEl.value = mapped.thunder_token;
    const wtEl = document.getElementById('settingWelcomeTitle');
    if (wtEl) wtEl.value = mapped.welcome_title;
    const wsEl = document.getElementById('settingWelcomeSubtitle');
    if (wsEl) wsEl.value = mapped.welcome_subtitle;

  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

async function initFirebaseData() {
  const token = localStorage.getItem('manager_token');
  if (!token) {
    updateFirebaseAuthUI(null);
    return false;
  }

  const user = currentUser();
  updateFirebaseAuthUI(user);

  // Initial load
  await loadSettings();
  await refreshJobs();

  // Load bookings list (from our custom bookings tab)
  if (typeof window.refreshBookingsTab === 'function') {
    window.refreshBookingsTab();
  }
  
  // Load gallery list (from our custom gallery tab)
  if (typeof window.refreshGalleryTab === 'function') {
    window.refreshGalleryTab();
  }

  return true;
}

async function loginAdmin(username, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง');
  }
  const data = await res.json();
  localStorage.setItem('manager_token', data.token);
  localStorage.setItem('manager_user', JSON.stringify(data.user));
  state.user = data.user;
  await initFirebaseData();
  return data.user;
}

async function loginAdminGoogle(credential) {
  const res = await fetch(`${API_BASE}/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential })
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'ยืนยัน Google Token ไม่สำเร็จ');
  }
  const data = await res.json();
  if (data.token) {
    localStorage.setItem('manager_token', data.token);
    localStorage.setItem('manager_user', JSON.stringify({
      id: data.user.sub,
      username: data.user.email,
      displayName: data.user.name,
    }));
    state.user = {
      id: data.user.sub,
      username: data.user.email,
      displayName: data.user.name,
    };
    await initFirebaseData();
    return state.user;
  } else {
    throw new Error('ไม่สามารถเข้าสู่ระบบผ่าน Google ได้: หลังบ้านไม่ได้ออกโทเค็นให้');
  }
}

async function signOutFirebase() {
  localStorage.removeItem('manager_token');
  localStorage.removeItem('manager_user');
  state.user = null;
  
  if (typeof window.clearJobsCache === 'function') {
    window.clearJobsCache();
  }
  
  updateFirebaseAuthUI(null);
  showToast('ออกจากระบบเรียบร้อยแล้ว');
}

async function saveJobToFirebase(job) {
  const token = localStorage.getItem('manager_token');
  if (!token) return false;

  const timeStr = `${job.startTime || '09:00'} - ${job.endTime || '13:00'}`;
  const slipImage = job.images?.[0]?.dataUrl || '';

  const mappedBooking = {
    client_name: job.client || '',
    job_type: job.type || 'custom',
    event_date: job.date || '',
    event_time: timeStr,
    start_time: job.startTime || '',
    end_time: job.endTime || '',
    location: job.location || '',
    price: Number(job.price) || 0,
    deposit: Number(job.deposit) || 0,
    note: job.note || '',
    status: job.status || 'pending',
    slip_image: slipImage,
  };

  // Check if job.id is numeric or start with 'job_'
  const isNew = !job.id || job.id.startsWith('job_');
  const url = isNew ? `${API_BASE}/bookings` : `${API_BASE}/bookings/${job.id}`;
  const method = isNew ? 'POST' : 'PUT';

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(mappedBooking)
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to save job');
  }
  
  await refreshJobs();
  return true;
}

async function saveJobsToFirebase(jobs) {
  for (const job of jobs) {
    await saveJobToFirebase(job);
  }
  return true;
}

async function deleteJobFromFirebase(jobId) {
  const token = localStorage.getItem('manager_token');
  if (!token) return false;

  if (jobId.startsWith('job_')) return true; // skip deleting unsaved local drafts

  const res = await fetch(`${API_BASE}/bookings/${jobId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to delete job');
  }

  await refreshJobs();
  return true;
}

async function saveSettingsToFirebase(settings) {
  const token = localStorage.getItem('manager_token');
  if (!token) return false;

  const backendSettings = {};
  if (settings.studioName !== undefined) backendSettings.studio_name = settings.studioName;
  if (settings.phone !== undefined) backendSettings.business_phone = settings.phone;
  if (settings.email !== undefined) backendSettings.business_email = settings.email;
  if (settings.facebook !== undefined) backendSettings.business_facebook = settings.facebook;
  if (settings.bookingTerms !== undefined) backendSettings.booking_terms = settings.bookingTerms;
  if (settings.hourRate !== undefined) backendSettings.hourly_rate = settings.hourRate;
  if (settings.sheetId !== undefined) backendSettings.google_sheet_id = settings.sheetId;
  
  if (settings.jobTypes !== undefined) {
    const list = settings.jobTypes.map(t => ({
      id: t.id,
      label: t.label,
      days: t.deliveryDays || 30,
      deposit: t.deposit || 1000,
    }));
    backendSettings.job_types = JSON.stringify(list);
  }

  // Handle PromptPay & Thunder token if they are passed
  if (settings.promptpay_id !== undefined) backendSettings.promptpay_id = settings.promptpay_id;
  if (settings.thunder_token !== undefined) backendSettings.thunder_token = settings.thunder_token;
  if (settings.welcome_title !== undefined) backendSettings.welcome_title = settings.welcome_title;
  if (settings.welcome_subtitle !== undefined) backendSettings.welcome_subtitle = settings.welcome_subtitle;
  if (settings.packages !== undefined) backendSettings.packages = settings.packages;
  if (settings.pricing_title !== undefined) backendSettings.pricing_title = settings.pricing_title;
  if (settings.pricing_subtitle !== undefined) backendSettings.pricing_subtitle = settings.pricing_subtitle;

  const res = await fetch(`${API_BASE}/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ settings: backendSettings })
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to save settings');
  }

  await loadSettings();
  return true;
}

window.firebaseData = {
  init: initFirebaseData,
  signInWithCustomToken: () => Promise.resolve(null),
  signInWithGooglePopup: () => Promise.resolve(null),
  login: loginAdmin,
  loginGoogle: loginAdminGoogle,
  signOut: signOutFirebase,
  saveJob: saveJobToFirebase,
  saveJobs: saveJobsToFirebase,
  deleteJob: deleteJobFromFirebase,
  saveSettings: saveSettingsToFirebase,
  isConfigured: isFirebaseConfigured,
  isAppCheckConfigured,
  isReady: isFirebaseReady,
  currentUser,
  jobsCollectionName: getJobsCollectionName,
  updateAuthUI: updateFirebaseAuthUI,
  refreshJobs,
  loadSettings,
  API_BASE,
};

window.initFirebaseData = initFirebaseData;
