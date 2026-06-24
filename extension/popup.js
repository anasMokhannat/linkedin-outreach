/* global chrome */

// Capture handshake (spec §6):
//   extension reads HttpOnly li_at via chrome.cookies (page JS cannot) →
//   POST { liAt } to APP_BASE_URL/api/linkedin/connect over HTTPS with the
//   app's session cookies (credentials: 'include') → backend validates + stores
//   it encrypted in Vault. The cookie value never appears in the popup UI and is
//   never persisted by the extension.

const appUrlInput = document.getElementById('appUrl');
const connectBtn = document.getElementById('connect');
const statusEl = document.getElementById('status');

// Remember the last-used app URL.
chrome.storage.local.get(['appUrl'], (res) => {
  if (res.appUrl) appUrlInput.value = res.appUrl;
});

function setStatus(msg, cls) {
  statusEl.textContent = msg;
  statusEl.className = 'status ' + (cls || '');
}

function getLiAt() {
  return new Promise((resolve, reject) => {
    chrome.cookies.get({ url: 'https://www.linkedin.com', name: 'li_at' }, (cookie) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!cookie || !cookie.value) {
        return reject(new Error('No li_at cookie found — log in to LinkedIn first.'));
      }
      resolve(cookie.value);
    });
  });
}

connectBtn.addEventListener('click', async () => {
  const appUrl = (appUrlInput.value || '').trim().replace(/\/+$/, '');
  if (!appUrl) return setStatus('Enter your app URL first.', 'err');

  connectBtn.disabled = true;
  setStatus('Reading session…');

  try {
    const liAt = await getLiAt();
    chrome.storage.local.set({ appUrl });

    setStatus('Connecting…');
    const res = await fetch(appUrl + '/api/linkedin/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include', // send the app's auth cookies
      body: JSON.stringify({ liAt }),
    });

    if (res.status === 401) {
      setStatus('Sign in to the app in this browser first, then retry.', 'err');
    } else if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setStatus('Failed: ' + (body.error || res.status), 'err');
    } else {
      setStatus('Connected! You can close this and start a sync.', 'ok');
    }
  } catch (e) {
    setStatus(e.message, 'err');
  } finally {
    connectBtn.disabled = false;
  }
});
