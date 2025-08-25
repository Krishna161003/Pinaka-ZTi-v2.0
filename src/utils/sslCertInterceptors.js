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

    // Gate by error message: only CERT-related
    const msg = String(err?.message || '');
    const stack = String(err?.stack || '');
    const combined = (msg + ' ' + stack).toLowerCase();
    const isCert = /err_cert|certificate|ssl|cert_authority_invalid/.test(combined);
    const isRefused = /err_connection_refused|econnrefused|connection refused/.test(combined);

    if (isNetwork && payload.url.startsWith('https://') && isCert && !isRefused) {
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
      const stack = (e && e.stack) || '';
      const combined = (msg + ' ' + stack).toLowerCase();
      const isNetwork = e instanceof TypeError || /failed to fetch|network error/i.test(combined);
      const url = typeof input === 'string' ? input : (input && input.url);
      const method = (init && init.method) || (typeof input === 'object' && input && input.method) || 'GET';
      const payload = toPayloadFromUrl(url || '', method);
      // Only emit for CERT-related failures; suppress for connection refused and unknowns
      const isCert = /err_cert|certificate|ssl|cert_authority_invalid/.test(combined);
      const isRefused = /err_connection_refused|econnrefused|connection refused/.test(combined);
      if (isNetwork && payload.url.startsWith('https://') && isCert && !isRefused) {
        emitSSLError(payload);
      }
      throw e;
    }
  };
}
