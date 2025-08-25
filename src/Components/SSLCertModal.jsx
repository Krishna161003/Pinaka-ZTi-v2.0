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

  useEffect(() => {
    // Subscribe once and show immediately on network/SSL/CORS errors
    const unsub = onSSLError((p) => {
      lastPayloadRef.current = p || null;
      const now = Date.now();
      if (now < cooldownUntilRef.current) return; // still in cooldown

      const origin = p?.origin || null;
      // If this origin has already been verified ok (SSL accepted), do nothing
      if (origin && okOriginsRef.current.has(origin)) return;

      // Update payload and open immediately
      setPayload(p || null);
      if (!visible) setVisible(true);
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
              <div>If it's SSL trust: open the backend origin below and accept the certificate.</div>
              <div>If it's CORS: ensure the backend sends Access-Control-Allow-Origin for the frontend's origin.</div>
              {displayOrigin && (
                <div style={{ marginTop: 8 }}>
                  Last failed request: <Text code>{payload?.method || 'GET'}</Text> <Text code>{displayOrigin}</Text>
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
