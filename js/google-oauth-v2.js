// Google OAuth v3 Token Flow helper.
// Connects directly to Google Calendar and Google Sheets APIs client-side.
const googleOAuthV3 = (() => {
  const STATE_KEY = 'fotoManagerV3GoogleSession';
  const ACTIVITY_KEY = 'fotoManagerV3LastActiveAt';
  const GIS_SCRIPT_ID = 'gisCodeClientScript';
  let tokenClient = null;
  let session = readSession();

  function readSession() {
    try {
      return JSON.parse(localStorage.getItem(STATE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function writeSession(data) {
    session = data || {};
    if (session.accessToken) {
      localStorage.setItem(STATE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(STATE_KEY);
    }
  }

  function isConfigured() {
    return true; // Statically available via Client ID
  }

  function markActivity() {
    localStorage.setItem(ACTIVITY_KEY, Date.now().toString());
  }

  function isIdleExpired() {
    const lastActive = Number(localStorage.getItem(ACTIVITY_KEY) || 0);
    return lastActive && (Date.now() - lastActive > 24 * 60 * 60 * 1000); // 24 hours idle limit
  }

  function loadGisScript() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const existing = document.getElementById(GIS_SCRIPT_ID) || document.getElementById('gisScript');
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Google Identity script failed')), { once: true });
        if (window.google?.accounts?.oauth2) resolve();
        return;
      }

      const script = document.createElement('script');
      script.id = GIS_SCRIPT_ID;
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Google Identity script failed'));
      document.head.appendChild(script);
    });
  }

  async function ensureTokenClient() {
    await loadGisScript();
    if (tokenClient) return tokenClient;

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: '629659023739-3s6q51voaeb9koebh7rm63l1c3dihdi1.apps.googleusercontent.com',
      scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/calendar',
      callback: (response) => {
        if (response.error) {
          showToast('Google integration failed: ' + response.error, 'error');
          return;
        }
        const token = response.access_token;
        window.applyGoogleAccessToken?.(token, { source: 'oauth-token-client' });
        
        writeSession({
          accessToken: token,
          expiresAt: Date.now() + Number(response.expires_in || 3600) * 1000,
          user: { email: 'Connected', displayName: 'Google Sync' }
        });
        
        markActivity();
        window.updateAuthUI?.();
        showToast('เชื่อมต่อ Google สำเร็จ ✓', 'success');
      }
    });
    return tokenClient;
  }

  async function login() {
    try {
      const client = await ensureTokenClient();
      client.requestAccessToken({ prompt: 'consent' });
      return true;
    } catch (error) {
      console.error('Google login failed:', error);
      showToast('เชื่อมต่อ Google ล้มเหลว: ' + error.message, 'error');
      return false;
    }
  }

  async function logout(options = {}) {
    writeSession({});
    localStorage.removeItem(ACTIVITY_KEY);
    window.clearGoogleAccessToken?.({ revoke: false });
    window.updateAuthUI?.();
    if (!options.quiet) showToast('ยกเลิกการเชื่อมต่อ Google แล้ว');
  }

  async function toggle() {
    if (session?.accessToken) {
      await logout();
      return;
    }
    await login();
  }

  async function refresh() {
    if (isIdleExpired()) {
      await logout({ quiet: true });
      return false;
    }
    return Boolean(session?.accessToken);
  }

  async function init() {
    if (isIdleExpired() || !session?.accessToken) {
      await logout({ quiet: true });
      return false;
    }
    if (session.expiresAt && session.expiresAt < Date.now()) {
      await logout({ quiet: true });
      return false;
    }
    window.applyGoogleAccessToken?.(session.accessToken, { source: 'init-session' });
    window.updateAuthUI?.();
    return true;
  }

  return {
    init,
    login,
    logout,
    toggle,
    refresh,
    isConfigured,
    markActivity,
    readSession,
    writeSession
  };
})();

window.googleOAuthV3 = googleOAuthV3;
