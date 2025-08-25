import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Button, Typography, Space, Alert } from 'antd';
import { WarningOutlined, SyncOutlined, LinkOutlined } from '@ant-design/icons';
import { onSSLError } from '../utils/sslCertInterceptors';

const { Text } = Typography;

function normalizeOrigins(payload) {
  const list = [];
  if (payload?.origin) list.push(payload.origin);
  // Add common backends for convenience when payload missing
  const host = window.location.hostname;
  const common = [
    `https://${host}:2020`, // Flask
    `https://${host}:5000`, // Node DB API
  ];
  for (const o of common) {
    if (!list.includes(o)) list.push(o);
  }
  return list;
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
    // Subscribe once
    const unsub = onSSLError((p) => {
      lastPayloadRef.current = p || null;
      const now = Date.now();
      if (now < cooldownUntilRef.current) return; // still in cooldown

      const origin = p?.origin || null;

      // If this origin has already been verified ok (SSL accepted), do nothing
      if (origin && okOriginsRef.current.has(origin)) return;

      // Update payload immediately so UI shows correct origin when it opens
      setPayload(p || null);

      // If already visible, don't schedule another
      if (visible) return;

      // Reset any existing debounce
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      // Debounce 5s, then probe the origin with no-cors to confirm SSL still blocks
      debounceTimerRef.current = setTimeout(async () => {
        debounceTimerRef.current = null;
        // Skip if cooldown started or already visible
        if (Date.now() < cooldownUntilRef.current || visible) return;

        // If we have an origin, try probing it; if probe resolves, mark origin ok and do not show modal
        if (origin) {
          try {
            await fetch(origin + '/', { method: 'GET', mode: 'no-cors', cache: 'no-store' });
            okOriginsRef.current.add(origin);
            return; // reachable (likely cert accepted); suppress popup
          } catch (_) {
            // Probe failed; proceed to show modal
          }
        }

        // Still failing; show the modal
        setPayload(lastPayloadRef.current);
        setVisible(true);
      }, 5000);
    });
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      unsub();
    };
  }, [visible]);

  const handleClose = () => {
    setVisible(false);
    cooldownUntilRef.current = Date.now() + 30000; // cooldown (ms) to prevent frequent popups
  };

  const origins = useMemo(() => normalizeOrigins(payload), [payload]);

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
          Backend connection blocked by SSL
        </span>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Alert
          type="warning"
          message="Your browser blocked requests to the backend because its SSL certificate is not trusted yet."
          description={
            <>
              <div>Open the backend once and accept the certificate, then click Refresh.</div>
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

          <Button
            onClick={handleRetry}
            icon={<SyncOutlined spin={retrying} />}
            type="default"
            style={{ borderColor: '#1677ff', color: '#1677ff', borderRadius: 20 }}
          >
            Refresh
          </Button>
        </div>
      </Space>
    </Modal>
  );
}
