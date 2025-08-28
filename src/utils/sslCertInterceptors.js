// Global SSL/network error detector for axios and fetch
// Usage: import './utils/sslCertInterceptors' once at app startup.

import axios from 'axios';

// Simple event bus with last-event replay (short TTL)
const listeners = new Set();
let lastPayload = null;
let lastAt = 0;
const LAST_TTL_MS = 8000; // replay last error within 8s

export function onSSLError(listener) {
  listeners.add(listener);
  // Replay the latest SSL/network error if it is recent
  if (lastPayload && (Date.now() - lastAt) <= LAST_TTL_MS) {
    try { listener(lastPayload); } catch (_) {}
  }
  return () => listeners.delete(listener);
}

function emitSSLError(payload) {
  lastPayload = payload;
  lastAt = Date.now();
  for (const l of Array.from(listeners)) {
    try { l(payload); } catch (_) {}
  }
}

// Normalize to { url, origin, method }
function toPayloadFromUrl(url, method = 'GET') {
  try {
    const u = new URL(url, window.location.href);
    return { url: u.toString(), origin: u.origin, method };
  } catch {
    return { url: String(url || ''), origin: null, method };
  }
}

// Install axios interceptor (default instance)
axios.interceptors.response.use(
  (res) => res,
  (err) => {
    const isNetwork = !err?.response && (err?.code === 'ERR_NETWORK' || /network error/i.test(err?.message || ''));
    const cfg = err?.config || {};
    const method = (cfg.method || 'GET').toUpperCase();
    const url = cfg.baseURL ? new URL(cfg.url || '', cfg.baseURL).toString() : (cfg.url || '');
    const payload = toPayloadFromUrl(url, method);

    // Check for SSL certificate specific errors
    const msg = String(err?.message || '').toLowerCase();
    const code = String(err?.code || '').toLowerCase();
    const isSSLError = 
      code.includes('cert_authority_invalid') ||
      code.includes('err_cert_authority_invalid') ||
      msg.includes('cert_authority_invalid') ||
      msg.includes('self signed') ||
      msg.includes('self-signed') ||
      msg.includes('unable to verify') ||
      msg.includes('certificate verify failed');

    // Emit for any HTTPS network error. The UI will probe/suppress CORS-only failures.
    if (isNetwork && payload.url.startsWith('https://')) {
      emitSSLError(payload);
    }
    return Promise.reject(err);
  }
);

// Patch window.fetch to catch network errors
if (typeof window !== 'undefined' && window.fetch) {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    try {
      const res = await originalFetch(input, init);
      return res;
    } catch (e) {
      const msg = (e && e.message) || '';
      const isNetwork = e instanceof TypeError || /failed to fetch|network error/i.test(msg);
      const url = typeof input === 'string' ? input : (input && input.url);
      const method = (init && init.method) || (typeof input === 'object' && input && input.method) || 'GET';
      const payload = toPayloadFromUrl(url || '', method);
      
      // Check for SSL certificate errors
      const lowerMsg = msg.toLowerCase();
      const isSSLError = 
        lowerMsg.includes('cert_authority_invalid') ||
        lowerMsg.includes('self signed') ||
        lowerMsg.includes('self-signed') ||
        lowerMsg.includes('unable to verify') ||
        lowerMsg.includes('certificate verify failed');

      // Emit for any HTTPS network error. The UI will probe/suppress CORS-only failures.
      if (isNetwork && payload.url.startsWith('https://')) {
        emitSSLError(payload);
      }
      throw e;
    }
  };
}
