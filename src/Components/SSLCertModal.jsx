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
    // Subscribe once; probe origin before showing to avoid popups after SSL is accepted
    const unsub = onSSLError(async (p) => {
      lastPayloadRef.current = p || null;
      const now = Date.now();
      if (now < cooldownUntilRef.current) return; // still in cooldown

      const origin = p?.origin || null;
      const url = p?.url || null;
      // Always re-probe even if previously marked OK. If probe fails, drop from OK set and show modal.
      const probe = async () => {
        // 1) Probe the exact URL with no-cors: if it succeeds, it's a CORS-only failure → suppress
        if (url) {
          try {
            await fetch(url, { method: 'GET', mode: 'no-cors', cache: 'no-store' });
            if (origin) {
              okOriginsRef.current.add(origin);
              persistOkOrigins();
            }
            return true;
          } catch (_) { /* continue to origin probe */ }
        }
        // 2) Probe the origin
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
      if (ok) {
        return;
      } else {
        if (origin && okOriginsRef.current.has(origin)) {
          okOriginsRef.current.delete(origin);
          persistOkOrigins();
        }
        // Show the modal
        setPayload(p || null);
        if (!visible) setVisible(true);
      }
    });
    return () => {
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
