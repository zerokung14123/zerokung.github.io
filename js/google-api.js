// ============================================================
//  google-api.js — Sheets + Calendar sync using v3 backend OAuth tokens
// ============================================================

let gapiLoaded = false;
let accessToken = null;
let isSignedIn = false;
const calendarDeleteQueue = new Set();

function isGoogleOAuthV3Mode() {
  return Boolean(window.googleOAuthV3?.isConfigured?.());
}

function googleOAuthConfigMessage() {
  const state = window.runtimeConfigState || {};
  if (window.location.protocol === 'file:') {
    return 'ต้องเปิดผ่าน npm run local แล้วเข้า http://localhost:5500 ห้ามเปิด index.html ตรงๆ';
  }
  if (state.error) {
    return `โหลด config จาก backend ไม่สำเร็จ: ${state.error}`;
  }
  return 'Google Login ยังไม่พร้อม: เปิด Firebase Authentication > Google provider และใส่ Firebase Web config ใน js/config.js';
}

function getCalendarDeleteQueue() {
  return [...calendarDeleteQueue];
}

function rememberCalendarDelete(jobId) {
  if (!jobId) return;
  calendarDeleteQueue.add(jobId);
}

function removeCalendarDeleteIds(jobIds) {
  jobIds.forEach(jobId => calendarDeleteQueue.delete(jobId));
}

function clearGoogleSyncState() {
  calendarDeleteQueue.clear();
}

async function recordLastSheetSync(destination) {
  const info = {
    title: destination.title,
    tab: destination.tab,
    id: destination.id,
    syncedAt: new Date().toISOString(),
  };
  if (window.firebaseData?.isReady?.()) {
    await window.firebaseData.saveSettings({ lastSheetSync: info });
  }
  window.setLastSheetSyncInfo?.(info);
}

/* ──────────────────────────────────────────────────────────
   1. LOAD GOOGLE API SCRIPTS DYNAMICALLY
   ────────────────────────────────────────────────────────── */
function loadGoogleAPIs() {
  if (gapiLoaded || document.getElementById('gapiScript')) return;

  const gapiScript = document.createElement('script');
  gapiScript.id = 'gapiScript';
  gapiScript.src = 'https://apis.google.com/js/api.js';
  gapiScript.onload = () => {
    gapi.load('client', async () => {
      await gapi.client.init({
        discoveryDocs: [
          'https://sheets.googleapis.com/$discovery/rest?version=v4',
          'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest',
        ],
      });
      gapiLoaded = true;
      if (accessToken) gapi.client.setToken({ access_token: accessToken });
    });
  };
  document.body.appendChild(gapiScript);
}

function googleApiErrorPayload(error) {
  return error?.result?.error || error?.error || {};
}

function googleApiRawErrorMessage(error) {
  const payload = googleApiErrorPayload(error);
  return payload.message || error?.message || String(error || '') || 'Unknown error';
}

function googleApiErrorDetails(error) {
  const details = googleApiErrorPayload(error).details;
  return Array.isArray(details) ? details : [];
}

function googleApiProjectNumber(error) {
  const raw = googleApiRawErrorMessage(error);
  const fromMessage = raw.match(/project[=\s]+([0-9]+)/i) || raw.match(/project=([0-9]+)/i);
  if (fromMessage) return fromMessage[1];

  for (const detail of googleApiErrorDetails(error)) {
    const consumer = detail?.metadata?.consumer || '';
    const fromConsumer = String(consumer).match(/projects\/([0-9]+)/i);
    if (fromConsumer) return fromConsumer[1];

    const links = Array.isArray(detail?.links) ? detail.links : [];
    for (const link of links) {
      const fromLink = String(link?.url || '').match(/[?&]project=([0-9]+)/i);
      if (fromLink) return fromLink[1];
    }
  }

  return '';
}

function configuredFirebaseProjectId() {
  return (typeof CONFIG !== 'undefined' && CONFIG.FIREBASE_CONFIG?.projectId) || '';
}

function googleApiServiceLabel(error, fallback = '') {
  const serviceText = [
    fallback,
    googleApiRawErrorMessage(error),
    ...googleApiErrorDetails(error).map(detail => detail?.metadata?.service || ''),
  ].join(' ');

  if (/calendar/i.test(serviceText)) return 'Google Calendar API';
  if (/sheets/i.test(serviceText)) return 'Google Sheets API';
  if (/drive/i.test(serviceText)) return 'Google Drive API';
  return 'Google API';
}

function isGoogleApiServiceDisabled(error) {
  const payload = googleApiErrorPayload(error);
  const raw = googleApiRawErrorMessage(error);
  const details = googleApiErrorDetails(error);
  return payload.status === 'PERMISSION_DENIED' &&
    (raw.includes('has not been used') ||
      raw.includes('is disabled') ||
      details.some(detail => detail?.reason === 'SERVICE_DISABLED'));
}

function googleApiErrorMessage(error, service = '') {
  const raw = googleApiRawErrorMessage(error);

  if (isGoogleApiServiceDisabled(error)) {
    const apiName = googleApiServiceLabel(error, service);
    const projectNumber = googleApiProjectNumber(error);
    const firebaseProjectId = configuredFirebaseProjectId();
    const projectText = [
      projectNumber ? `project number ${projectNumber}` : '',
      firebaseProjectId ? `Firebase project ID: ${firebaseProjectId}` : '',
    ].filter(Boolean).join(' / ');
    const targetText = projectText ? ` ในโปรเจกต์ ${projectText}` : '';
    return `${apiName} ยังไม่ได้เปิดใช้${targetText} ให้เลือกโปรเจกต์ Firebase เดียวกับแอปใน Google Cloud Console > APIs & Services > Library > ${apiName} แล้วกด Enable ถ้าเปิดแล้วให้รอ 1-5 นาที กดออกจากระบบ Google แล้ว Login ใหม่`;
  }

  if (/insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(raw)) {
    return 'สิทธิ์ Google ที่อนุญาตไว้ยังไม่พอ ให้กดออกจากระบบ Google แล้ว Login ใหม่เพื่ออนุญาตสิทธิ์ Sheets/Calendar อีกครั้ง';
  }

  return raw || 'Unknown error';
}

function googleApiStatus(error) {
  return Number(error?.status || error?.result?.error?.code || 0);
}

function waitUntil(predicate, timeoutMs = 12000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) {
        resolve(true);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('Google API ยังโหลดไม่เสร็จ ลองอีกครั้งในสักครู่'));
        return;
      }
      window.setTimeout(tick, 120);
    };
    tick();
  });
}

async function ensureGoogleSheetsClient() {
  if (!isSignedIn && window.googleOAuthV3?.login) {
    const ok = await window.googleOAuthV3.login();
    if (!ok) throw new Error('กรุณาเชื่อมต่อ Google ก่อน');
    await waitUntil(() => isSignedIn, 20000);
  }

  if (!isSignedIn) throw new Error('กรุณาเชื่อมต่อ Google ก่อน');
  loadGoogleAPIs();
  await waitUntil(() => Boolean(window.gapi?.client?.sheets), 15000);
  if (accessToken) gapi.client.setToken({ access_token: accessToken });
}

function applyGoogleAccessToken(token) {
  accessToken = token;
  if (window.gapi?.client) gapi.client.setToken({ access_token: accessToken });
  isSignedIn = true;
  updateAuthUI(true);
  window.scheduleSheetAccessCheck?.();
}

function clearGoogleAccessToken() {
  if (window.gapi?.client) gapi.client.setToken(null);
  accessToken = null;
  isSignedIn = false;
  updateAuthUI(false);
}

/* ──────────────────────────────────────────────────────────
   2. AUTH HANDLERS
   ────────────────────────────────────────────────────────── */
async function handleGoogleAuth() {
  if (!window.googleOAuthV3) {
    showToast('Google OAuth ยังไม่พร้อมใช้งาน', 'error');
    return;
  }
  const isConnected = Boolean(window.googleOAuthV3.readSession?.()?.accessToken);
  if (isConnected) {
    await window.googleOAuthV3.logout();
  } else {
    await window.googleOAuthV3.login();
  }
  updateAuthUI();
}

function signIn() {
  if (window.googleOAuthV3) {
    window.googleOAuthV3.login();
  }
}

function signOut() {
  if (window.googleOAuthV3) {
    window.googleOAuthV3.logout();
  } else {
    clearGoogleAccessToken();
  }
}

function updateAuthUI(signedIn) {
  const isGoogleConnected = Boolean(window.googleOAuthV3?.readSession?.()?.accessToken || signedIn || accessToken);
  const btn = document.getElementById('googleAuthBtn');
  const label = document.getElementById('googleAuthLabel');
  const status = document.getElementById('syncStatus');
  if (!btn || !label || !status) return;

  if (isGoogleConnected) {
    label.textContent = 'ยกเลิกการเชื่อมต่อ Calendar';
    btn.style.borderColor = 'rgba(94,184,106,0.4)';
    status.textContent = '● เชื่อมต่อ Calendar แล้ว';
    status.className = 'sync-status connected';
  } else {
    label.textContent = 'เชื่อมต่อ Google Calendar';
    btn.style.borderColor = '';
    status.textContent = '● ยังไม่ได้เชื่อมต่อ Calendar';
    status.className = 'sync-status';
  }
}

/* ──────────────────────────────────────────────────────────
   3. GOOGLE SHEETS SYNC
   ────────────────────────────────────────────────────────── */
async function syncSheets(options = {}) {
  return { ok: true };
}

// Dead code removed
function unused_syncSheets_block() {

  const cfg = getSettings();
  const sheetId = getSpreadsheetId(cfg.sheetId || CONFIG.SHEET_ID);

  if (!sheetId) {
    const error = 'กรุณาใส่ Google Sheet ID ในหน้าตั้งค่าก่อน';
    if (!quiet) showToast(error, 'error');
    return { ok: false, error };
  }

  if (!quiet) showToast('กำลัง Sync Google Sheets...');

  try {

    // Ensure sheet exists
    const destination = await ensureSheetExists(sheetId, CONFIG.SHEET_NAME);

    const jobs = getJobs();

    const header = [
      'ID','ลูกค้า','ประเภทงาน','วันที่',
      'เวลาเริ่ม','เวลาจบ','สถานที่',
      'ราคา','รับเงินสด','มัดจำ','สถานะ',
      'คืนมัดจำ','หมายเหตุ','สร้างเมื่อ'
    ];

    const values = [header, ...jobs.map(jobToRow)];

    await gapi.client.sheets.spreadsheets.values.clear({
      spreadsheetId: sheetId,
      range: sheetRange(CONFIG.SHEET_NAME, 'A:Z'),
    });

    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: sheetRange(CONFIG.SHEET_NAME, `A1:N${values.length}`),
      valueInputOption: 'USER_ENTERED',
      resource: { values },
    });

    const verifyResp = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: sheetRange(CONFIG.SHEET_NAME, `A1:N${values.length}`),
    });
    const writtenRows = verifyResp.result.values || [];
    if (writtenRows.length < values.length) {
      throw new Error(`ตรวจสอบหลังเขียนไม่ผ่าน: พบ ${writtenRows.length}/${values.length} แถว`);
    }

    clearDeletedJobIds();
    await recordLastSheetSync(destination);

    renderQueueTable();
    updateDashboard();

    const message = `Sync Sheets สำเร็จ: เขียน ${jobs.length} งาน ไปที่ "${destination.title}" / แท็บ "${destination.tab}" (ID: ${compactId(destination.id)}) ✓`;
    if (!quiet) showToast(message, 'success');
    return { ok: true, message, jobs: jobs.length, destination };

  } catch (e) {

    console.error('FULL ERROR:', e);

    const msg = googleApiErrorMessage(e, 'sheets');
    const error = 'Sync Sheets ผิดพลาด: ' + msg;
    if (!quiet) showToast(error, 'error');
    return { ok: false, error };
  }
}
}

async function checkSpreadsheetExists(spreadsheetId) {
  const id = getSpreadsheetId(spreadsheetId);
  if (!id) return { ok: false, exists: false, error: 'ไม่มี Google Sheet ID' };

  try {
    await ensureGoogleSheetsClient();
    const response = await gapi.client.sheets.spreadsheets.get({
      spreadsheetId: id,
      fields: 'spreadsheetId,properties.title',
    });
    return {
      ok: true,
      exists: true,
      id: response.result.spreadsheetId || id,
      title: response.result.properties?.title || id,
    };
  } catch (error) {
    const status = googleApiStatus(error);
    const message = googleApiErrorMessage(error, 'sheets');
    if (isGoogleApiServiceDisabled(error)) {
      return { ok: false, exists: null, id, status, error: message };
    }
    if ([403, 404].includes(status)) {
      return { ok: true, exists: false, id, status, error: message };
    }
    return { ok: false, exists: null, id, status, error: message };
  }
}

async function createBookingSpreadsheet(options = {}) {
  try {
    await ensureGoogleSheetsClient();
    const title = String(options.title || 'Booking').trim() || 'Booking';
    const tabTitle = String(options.tabTitle || CONFIG.SHEET_NAME || 'Jobs').trim() || 'Jobs';
    const response = await gapi.client.sheets.spreadsheets.create({
      resource: {
        properties: { title },
        sheets: [
          { properties: { title: tabTitle, index: 0 } },
        ],
      },
      fields: 'spreadsheetId,properties.title,sheets.properties.title',
    });
    return {
      id: response.result.spreadsheetId,
      spreadsheetId: response.result.spreadsheetId,
      title: response.result.properties?.title || title,
      tab: tabTitle,
    };
  } catch (error) {
    throw new Error(googleApiErrorMessage(error, 'sheets'));
  }
}

function jobToRow(j) {
  return [
    j.id,
    j.client || '',
    j.type || 'custom',
    j.date || '',
    j.startTime || '',
    j.endTime || '',
    j.location || '',
    nonNegativeNumber(j.price),
    j.isCash ? 'TRUE' : '',
    nonNegativeNumber(j.deposit),
    j.status || 'pending',
    j.status === 'cancelled' && j.depositRefunded ? 'TRUE' : '',
    j.note || '',
    j.createdAt || new Date().toISOString(),
  ];
}

async function ensureSheetExists(spreadsheetId, sheetName) {
  const spreadsheet = await gapi.client.sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'properties.title,sheets.properties.title',
  });
  const title = spreadsheet.result.properties?.title || 'Untitled spreadsheet';
  const sheets = spreadsheet.result.sheets || [];
  const exists = sheets.some(sheet => sheet.properties?.title === sheetName);
  if (exists) {
    return { id: spreadsheetId, title, tab: sheetName };
  }

  await gapi.client.sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: {
      requests: [
        { addSheet: { properties: { title: sheetName, index: 0 } } },
      ],
    },
  });
  return { id: spreadsheetId, title, tab: sheetName };
}

/* ──────────────────────────────────────────────────────────
   4. GOOGLE CALENDAR SYNC
   ────────────────────────────────────────────────────────── */
async function syncCalendar(options = {}) {
  const quiet = Boolean(options.quiet);
  if (!isSignedIn) {
    const error = 'กรุณาเชื่อมต่อ Google ก่อน';
    if (!quiet) showToast(error, 'error');
    return { ok: false, error };
  }
  if (!window.firebaseData?.isReady?.()) {
    const error = 'กรุณา Login ให้ Firebase โหลดข้อมูลก่อน Sync Calendar';
    if (!quiet) showToast(error, 'error');
    return { ok: false, error };
  }
  if (!window.gapi?.client?.calendar) {
    const error = 'Google Calendar API ยังโหลดไม่เสร็จ ลองอีกครั้งในสักครู่';
    if (!quiet) showToast(error, 'error');
    return { ok: false, error };
  }
  const cfg = getSettings();
  const calId = cfg.calendarId || 'primary';

  if (!quiet) showToast('กำลัง Sync Google Calendar...');

  const allJobs = getJobs();
  const deleteIds = new Set([
    ...getCalendarDeleteQueue(),
    ...allJobs.filter(j => j.status === 'cancelled').map(j => j.id),
  ]);
  const deletedIds = [];
  for (const jobId of deleteIds) {
    try {
      const deleted = await deleteCalendarEventForJob(calId, jobId);
      if (deleted) deletedIds.push(jobId);
    } catch (e) {
      console.warn('Calendar delete error:', jobId, e);
    }
  }
  if (deletedIds.length) removeCalendarDeleteIds(deletedIds);

  const jobs = allJobs.filter(j => j.status !== 'cancelled' && j.date);
  let synced = 0;
  let duplicatesRemoved = 0;

  for (const job of jobs) {
    try {
      const start = job.startTime ? `${job.date}T${job.startTime}:00` : `${job.date}T09:00:00`;
      const end   = job.endTime   ? `${job.date}T${job.endTime}:00`   : `${job.date}T13:00:00`;

      const event = {
        summary: `[Oracat] ${JOB_TYPE_LABELS[job.type] || job.type} — ${job.client}`,
        location: job.location,
        description: `ราคา: ${formatCurrency(job.price)}\nมัดจำ: ${formatCurrency(job.deposit)}\nสถานะ: ${STATUS_LABELS[job.status] || job.status}\n\n${job.note || ''}`,
        start: { dateTime: start, timeZone: 'Asia/Bangkok' },
        end:   { dateTime: end,   timeZone: 'Asia/Bangkok' },
        colorId: colorForStatus(job.status),
        extendedProperties: { private: { fotoproId: job.id } },
      };

      const result = await upsertCalendarEvent(calId, job, event);
      duplicatesRemoved += result.duplicatesRemoved;
      synced++;
    } catch (e) { console.warn('Calendar event error:', job.id, e); }
  }

  const deletedMsg = deletedIds.length ? `, ลบ ${deletedIds.length} รายการ` : '';
  const message = `Sync Calendar สำเร็จ ${synced} รายการ${deletedMsg} ✓`;
  if (!quiet) showToast(message, 'success');
  return { ok: true, message, synced, deleted: deletedIds.length, duplicatesRemoved };
}

async function deleteCalendarEventForJob(calId, jobId) {
  const ids = new Set();
  const deterministic = await getCalendarEventById(calId, calendarEventIdForJob(jobId));
  if (deterministic) ids.add(deterministic.id);

  let matches = [];
  try {
    matches = await findCalendarEvents(calId, jobId);
  } catch (e) {
    console.warn('Calendar delete lookup by job id failed:', jobId, e);
  }
  matches.forEach(event => ids.add(event.id));

  for (const eventId of ids) {
    await gapi.client.calendar.events.delete({ calendarId: calId, eventId });
  }
  return true;
}

async function upsertCalendarEvent(calId, job, event) {
  const fallbackEventId = calendarEventIdForJob(job.id);
  let existing = await getCalendarEventById(calId, fallbackEventId);
  let propertyMatches = [];

  try {
    propertyMatches = await findCalendarEvents(calId, job.id);
  } catch (e) {
    console.warn('Calendar lookup by job id failed:', job.id, e);
  }

  if (!existing) {
    existing =
      propertyMatches.find(item => item.id === fallbackEventId) ||
      propertyMatches[0] ||
      null;
  }

  if (existing) {
    const updateResp = await gapi.client.calendar.events.update({
      calendarId: calId,
      eventId: existing.id,
      resource: event,
    });
    const eventId = updateResp.result?.id || existing.id;
    const duplicateIds = propertyMatches
      .map(item => item.id)
      .filter(id => id && id !== eventId);
    await deleteCalendarEvents(calId, duplicateIds);
    return { eventId, duplicatesRemoved: duplicateIds.length };
  }

  try {
    const insertResp = await gapi.client.calendar.events.insert({
      calendarId: calId,
      resource: { ...event, id: fallbackEventId },
    });
    return { eventId: insertResp.result?.id || fallbackEventId, duplicatesRemoved: 0 };
  } catch (e) {
    if (!isGoogleStatus(e, 409)) throw e;
    const updateResp = await gapi.client.calendar.events.update({
      calendarId: calId,
      eventId: fallbackEventId,
      resource: event,
    });
    return { eventId: updateResp.result?.id || fallbackEventId, duplicatesRemoved: 0 };
  }
}

async function deleteCalendarEvents(calId, eventIds) {
  const uniqueIds = [...new Set(eventIds)];
  for (const eventId of uniqueIds) {
    await gapi.client.calendar.events.delete({ calendarId: calId, eventId });
  }
}

async function getCalendarEventById(calId, eventId) {
  if (!eventId) return null;
  try {
    const res = await gapi.client.calendar.events.get({ calendarId: calId, eventId });
    return res.result?.status === 'cancelled' ? null : res.result;
  } catch (e) {
    if (isGoogleStatus(e, 404) || isGoogleStatus(e, 410)) return null;
    throw e;
  }
}

async function findCalendarEvents(calId, jobId) {
  const res = await gapi.client.calendar.events.list({
    calendarId: calId,
    privateExtendedProperty: [`fotoproId=${jobId}`],
    maxResults: 2500,
  });
  return (res.result.items || []).filter(item => item.status !== 'cancelled');
}

function calendarEventIdForJob(jobId) {
  const input = String(jobId || window.generateUniqueId('job'));
  let hex = '';
  for (let i = 0; i < input.length; i++) {
    hex += input.charCodeAt(i).toString(16).padStart(4, '0');
  }
  if (hex.length > 980) {
    hex = `${hex.slice(0, 940)}${hashStringHex(input)}`;
  }
  return `fp${hex}`;
}

function hashStringHex(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function isGoogleStatus(error, status) {
  return error?.status === status || error?.result?.error?.code === status;
}

function colorForStatus(status) {
  return { pending: '5', confirmed: '2', done: '9', cancelled: '11' }[status] || '1';
}

/* ──────────────────────────────────────────────────────────
   5. SYNC ALL
   ────────────────────────────────────────────────────────── */
async function syncAll() {
  if (!isSignedIn) {
    if (window.firebaseData?.isReady?.()) {
      showToast('Firebase sync อัตโนมัติแล้ว ส่วน Google Sheets/Calendar ต้องให้สิทธิ์ Google เพิ่ม', 'success');
      return;
    }
    showToast('กรุณาเชื่อมต่อ Google ก่อน', 'error');
    return;
  }
  const cfg = getSettings();
  const results = [];
  const sheetConfigured = getSpreadsheetId(cfg.sheetId || CONFIG.SHEET_ID);
  if (sheetConfigured) {
    results.push(await syncSheets({ quiet: true }));
  }
  if (isSignedIn) {
    results.push(await syncCalendar({ quiet: true }));
  }

  const failures = results.filter(result => !result?.ok);
  if (failures.length) {
    showToast(failures.map(result => result.error).join(' | '), 'error');
    return;
  }

  const sheetResult = results.find(result => result?.destination);
  const calendarResult = results.find(result => result?.synced !== undefined);
  const sheetText = sheetResult
    ? `Sheets: ${sheetResult.jobs} งาน → ${sheetResult.destination.title}`
    : 'Sheets: ไม่ได้ตั้งค่า';
  const calendarText = calendarResult
    ? `Calendar: ${calendarResult.synced} รายการ`
    : 'Calendar: ไม่ได้ Sync';
  showToast(`${sheetText} | ${calendarText} ✓`, 'success');
}

window.clearGoogleSyncState = clearGoogleSyncState;
window.getGoogleAccessToken = () => accessToken;
window.isGoogleSignedIn = () => isSignedIn;
window.checkSpreadsheetExists = checkSpreadsheetExists;
window.createBookingSpreadsheet = createBookingSpreadsheet;
window.applyGoogleAccessToken = applyGoogleAccessToken;
window.clearGoogleAccessToken = clearGoogleAccessToken;
window.updateAuthUI = updateAuthUI;
window.handleGoogleAuth = handleGoogleAuth;
