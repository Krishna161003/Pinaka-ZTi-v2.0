// Global SSL/network error detector for axios and fetch
// Usage: import './utils/sslCertInterceptors' once at app startup.

import axios from 'axios';

// Simple event bus
const listeners = new Set();

export function onSSLError(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitSSLError(payload) {
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

    // Only prompt for https targets
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
      if (isNetwork && payload.url.startsWith('https://')) {
        emitSSLError(payload);
      }
      throw e;
    }
  };
}
