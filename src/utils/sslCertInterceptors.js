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
    const stack = String(err?.stack || '').toLowerCase();
    const causeCode = String(err?.cause?.code || err?.cause || '').toLowerCase();
    const blob = `${msg} ${code} ${stack} ${causeCode}`;
    const isSSLError = 
      blob.includes('cert_authority_invalid') ||
      blob.includes('err_cert_authority_invalid') ||
      blob.includes('self signed') ||
      blob.includes('self-signed') ||
      blob.includes('unable to verify') ||
      blob.includes('certificate verify failed') ||
      blob.includes('err_ssl_protocol_error') ||
      blob.includes('ssl');

    // Skip unreachable host errors (not SSL-related)
    const isAddressUnreachable = /address_unreachable|err_address_unreachable/.test(blob);

    // Skip connection refused / timed out (not SSL-related)
    const isRefusedOrTimedOut = /err_connection_refused|econnrefused|err_connection_timed_out|etimedout|timed out|timeout/.test(blob);

    // Emit only for likely SSL-related network issues on HTTPS
    if (isNetwork && payload.url.startsWith('https://') && !isAddressUnreachable && !isRefusedOrTimedOut) {
      // As a final guard, try a quick no-cors probe; if it succeeds, it's not an SSL handshake failure
      try {
        const u = new URL(payload.url);
        const originProbe = `${u.origin}/`;
        // Note: we intentionally do not await too long; a refusal usually rejects immediately, SSL also rejects
        // If probe resolves, suppress the modal (likely CORS)
        return fetch(originProbe, { method: 'GET', mode: 'no-cors', cache: 'no-store' })
          .then(() => Promise.reject(err)) // reachable → suppress emit
          .catch(() => { // unreachable → may be SSL or offline; only emit if not refused/timeout as checked above
            if (isSSLError) emitSSLError(payload);
            return Promise.reject(err);
          });
      } catch (_) {
        if (isSSLError) emitSSLError(payload);
      }
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
      
      // Aggregate error hints
      const blob = `${String(msg).toLowerCase()} ${String(e?.code || '').toLowerCase()} ${String(e?.name || '').toLowerCase()} ${String(e?.cause?.code || e?.cause || '').toLowerCase()} ${String(e?.stack || '').toLowerCase()}`;

      // Check for SSL certificate errors
      const isSSLError = /cert_authority_invalid|self[- ]signed|unable to verify|certificate verify failed|err_ssl_protocol_error/.test(blob);

      // Skip unreachable/refused/timeout (not SSL-related)
      const isAddressUnreachable = /address_unreachable|err_address_unreachable/.test(blob);
      const isRefusedOrTimedOut = /err_connection_refused|econnrefused|err_connection_timed_out|etimedout|timed out|timeout/.test(blob);

      // Emit only for likely SSL-related issues
      if (isNetwork && payload.url.startsWith('https://') && !isAddressUnreachable && !isRefusedOrTimedOut && isSSLError) {
        emitSSLError(payload);
      }
      throw e;
    }
  };
}
