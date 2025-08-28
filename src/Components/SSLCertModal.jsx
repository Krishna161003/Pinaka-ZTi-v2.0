import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Button, Typography, Space, Alert } from 'antd';
import { WarningOutlined, SyncOutlined, LinkOutlined } from '@ant-design/icons';
import { onSSLError } from '../utils/sslCertInterceptors';

const { Text } = Typography;

function normalizeOrigins(payload) {
  const origin = payload?.origin;
  return origin ? [origin] : [];
}

export default function SSLCertModal() {
  const [visible, setVisible] = useState(false);
  const [payload, setPayload] = useState(null);
  const [retrying, setRetrying] = useState(false);

  // Debounce and cooldown to avoid frequent popups
  const debounceTimerRef = useRef(null);
  const cooldownUntilRef = useRef(0); // timestamp ms; ignore events before this time
  const lastPayloadRef = useRef(null); // keep the latest event while debouncing
  const okOriginsRef = useRef(new Set()); // origins that have been verified reachable (SSL accepted)
  const storageKey = 'ssl_ok_origins';

  // Load persisted OK origins on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          okOriginsRef.current = new Set(arr.filter(Boolean));
        }
      }
    } catch (_) {}
  }, []);

  const persistOkOrigins = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(Array.from(okOriginsRef.current)));
    } catch (_) {}
  };

  useEffect(() => {
    // Subscribe once; debounce and probe before showing
    const unsub = onSSLError((p) => {
      // Ignore while visible
      if (visible) return;

      lastPayloadRef.current = p || null;
      const now = Date.now();
      if (now < cooldownUntilRef.current) {
        return; // still in cooldown
      }

      // Debounce rapid bursts
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(async () => {
        const payloadNow = lastPayloadRef.current;
        const origin = payloadNow?.origin || null;
        const url = payloadNow?.url || null;

        const probe = async () => {
          // 1) Probe exact URL; success means CORS-only → suppress
          if (url) {
            try {
              await fetch(url, { method: 'GET', mode: 'no-cors', cache: 'no-store' });
              if (origin) {
                okOriginsRef.current.add(origin);
                persistOkOrigins();
              }
              return true;
            } catch (_) { /* continue */ }
          }
          // 2) Probe origin
          if (origin) {
            try {
              await fetch(origin + '/', { method: 'GET', mode: 'no-cors', cache: 'no-store' });
              okOriginsRef.current.add(origin);
              persistOkOrigins();
              return true;
            } catch (_) { /* fallthrough */ }
          }
          return false;
        };

        const ok = await probe();
        if (ok) return;

        if (origin && okOriginsRef.current.has(origin)) {
          okOriginsRef.current.delete(origin);
          persistOkOrigins();
        }
        setPayload(payloadNow || null);
        setVisible(true);
      }, 600);
    });
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      unsub();
    };
  }, [visible]);

  const handleClose = () => {
    setVisible(false);
    cooldownUntilRef.current = Date.now() + 30000; // cooldown (ms) to prevent frequent popups
  };

  const origins = useMemo(() => normalizeOrigins(payload), [payload]);
  const displayOrigin = useMemo(() => {
    if (payload?.origin) return payload.origin;
    const url = payload?.url;
    if (!url) return null;
    try {
      const u = new URL(url, window.location.href);
      return u.origin;
    } catch (_) {
      return null;
    }
  }, [payload]);

  const handleOpen = (origin) => {
    try {
      window.open(origin + '/', '_blank', 'noopener');
    } catch (_) {}
  };

  const handleRetry = () => {
    setRetrying(true);
    // Simple approach: full page reload to re-trigger all fetches
    // This is acceptable here since SSL accept requires a navigation anyway.
    window.location.reload();
  };

  return (
    <Modal
      open={visible}
      onCancel={handleClose}
      footer={null}
      centered
      title={
        <span>
          <WarningOutlined style={{ color: '#faad14', marginRight: 8 }} />
          Backend connection blocked (SSL/CORS)
        </span>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Alert
          type="warning"
          message="Your browser blocked requests to the backend (possible SSL trust or CORS policy)."
          description={
            <>
              <div>Open the backend once and accept the certificate.</div>
              {(payload?.origin || payload?.url) && (
                <div style={{ marginTop: 8 }}>
                  Last failed request: <Text code>{payload?.method || 'GET'}</Text> <Text code>{payload?.origin ? (payload.origin + '/') : payload?.url}</Text>
                </div>
              )}
            </>
          }
          showIcon
        />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {origins.map((o) => (
            <Button
              key={o}
              onClick={() => handleOpen(o)}
              icon={<LinkOutlined />}
              type="default"
              style={{ borderColor: '#1677ff', color: '#1677ff', borderRadius: 20 }}
            >
              Open {o}
            </Button>
          ))}

          {/* <Button
            onClick={handleRetry}
            icon={<SyncOutlined spin={retrying} />}
            type="default"
            style={{ borderColor: '#1677ff', color: '#1677ff', borderRadius: 20 }}
          >
            Refresh
          </Button> */}
        </div>
      </Space>
    </Modal>
  );
}
