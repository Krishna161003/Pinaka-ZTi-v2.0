import React, { useEffect, useMemo, useState } from 'react';
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

  useEffect(() => {
    // Subscribe once
    const unsub = onSSLError((p) => {
      setPayload(p || null);
      setVisible(true);
    });
    return unsub;
  }, []);

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
      onCancel={() => setVisible(false)}
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
              {payload?.url && (
                <div style={{ marginTop: 8 }}>
                  Last failed request: <Text code>{payload.method || 'GET'}</Text> <Text code>{payload.url}</Text>
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
