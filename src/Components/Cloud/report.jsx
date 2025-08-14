import React, { useEffect, useState, useRef } from 'react';
import { Divider, Card, Progress, Row, Col, Flex, Spin, Button, message } from 'antd';
import { CloudOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

const getCloudNameFromMetadata = () => {
  let cloudNameMeta = document.querySelector('meta[name="cloud-name"]');
  return cloudNameMeta ? cloudNameMeta.content : 'Cloud';
};

const hostIP = window.location.hostname;
// Stable asset imports to avoid re-decoding/restarting animations on re-renders
const planeGif = require('../../Images/plane.gif');
const completedImage = require('../../Images/completed.png');

const Report = ({ onDeploymentComplete }) => {
  const navigate = useNavigate();
  const [completionWindowActive, setCompletionWindowActive] = useState(false);
  const completionWindowTimeoutRef = useRef(null);
  const revertedRef = useRef(false);
  const cloudName = getCloudNameFromMetadata();
  const [percent, setPercent] = useState(0);
  const [completedLogs, setCompletedLogs] = useState([]);
  const [error, setError] = useState(null);
  const [deploymentPollingStopped, setDeploymentPollingStopped] = useState(false);
  const serveridRef = useRef(sessionStorage.getItem('currentCloudServerid') || null);
  const logStartedRef = useRef(false);
  const intervalRef = useRef(null);
  const finalizedRef = useRef(false);
  // Keep a stable reference to the GIF across re-renders
  const planeGifRef = useRef(planeGif);
  // Blob URL for gif to avoid decode restarts/pauses
  const [gifUrl, setGifUrl] = useState(null);

  // Preload GIF as Blob and use its object URL for more stable playback
  useEffect(() => {
    let revokedUrl = null;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(planeGifRef.current, { cache: 'force-cache' });
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        planeGifRef.current = url;
        setGifUrl(url); // trigger render using blob URL
        revokedUrl = url;
      } catch (_) {
        // fallback: keep original asset url
      }
    })();
    return () => {
      cancelled = true;
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
    };
  }, []);

  // Backend deployment progress polling
  const [deploymentInProgress, setDeploymentInProgress] = useState(true);

  useEffect(() => {
    let interval = setInterval(() => {
      fetch(`https://${hostIP}:2020/node-deployment-progress`)
        .then(res => res.json())
        .then(data => {
          if (data && typeof data.in_progress === 'boolean') {
            setDeploymentInProgress(data.in_progress);
          }
        })
        .catch(() => {});
    }, 3000);
    // Initial check
    fetch(`https://${hostIP}:2020/node-deployment-progress`)
      .then(res => res.json())
      .then(data => {
        if (data && typeof data.in_progress === 'boolean') {
          setDeploymentInProgress(data.in_progress);
        }
      })
      .catch(() => {});
    return () => clearInterval(interval);
  }, []);

  // Persist behavior when leaving Report tab:
  // - If deployment is in progress, ensure returning opens Report (tab 5) with tabs 1-4 disabled
  // - If deployment completed (handled below), reset tabs to default via another effect
  useEffect(() => {
    return () => {
      if (deploymentInProgress) {
        try {
          sessionStorage.setItem('cloud_activeTab', '5');
          sessionStorage.setItem('cloud_disabledTabs', JSON.stringify({ '1': true, '2': true, '3': true, '4': true, '5': false }));
          sessionStorage.setItem('lastMenuPath', '/addnode?tab=5');
          sessionStorage.setItem('lastCloudPath', '/addnode?tab=5');
        } catch (_) {}
      }
    };
  }, [deploymentInProgress]);

  // Helper to extract role IPs from saved form
  const extractRoleIps = (form) => {
    const findIp = (name) => {
      const row = (form?.tableData || []).find(r => Array.isArray(r.type) ? r.type.includes(name) : r.type === name);
      return row?.ip || '';
    };
    return {
      Management: findIp('Management'),
      Storage: findIp('Storage'),
      External_Traffic: findIp('External Traffic'),
      VXLAN: findIp('VXLAN'),
    };
  };

  // Clear only Cloud flow-specific session data (keep tab/navigation keys intact)
  const clearCloudSessionData = () => {
    try {
      const keysToRemove = [
        'cloud_discoveryResults',
        'cloud_validationResults',
        'cloud_licenseActivationResults',
        'cloud_selectedNodes',
        'cloud_licenseNodes',
        'cloud_networkApplyCardStatus',
        'cloud_networkApplyForms',
        'cloud_networkApplyResult',
        'cloud_networkApplyRestartEndTimes',
        'cloud_networkApplyBootEndTimes',
        'cloud_lastDeploymentNodes',
      ];
      keysToRemove.forEach(k => sessionStorage.removeItem(k));
    } catch (_) {}
  };

  // When deployment finishes, finalize child deployments in backend (with session fallback)
  useEffect(() => {
    if (!deploymentInProgress && !finalizedRef.current) {
      finalizedRef.current = true;
      const runFinalize = async () => {
        // Try session first
        let nodes = [];
        try {
          const nodesRaw = sessionStorage.getItem('cloud_lastDeploymentNodes');
          if (nodesRaw) nodes = JSON.parse(nodesRaw) || [];
        } catch (_) {}

        // If session missing, fetch pending secondary nodes from backend
        if (!nodes || nodes.length === 0) {
          try {
            let storedUserId = '';
            try {
              const loginRaw = sessionStorage.getItem('loginDetails');
              if (loginRaw) {
                const loginObj = JSON.parse(loginRaw);
                storedUserId = loginObj?.data?.id || '';
              }
            } catch (_) { storedUserId = ''; }
            if (!storedUserId) {
              storedUserId = sessionStorage.getItem('user_id') || sessionStorage.getItem('userId') || '';
            }
            const params = { status: 'progress', cloudname: cloudName };
            if (storedUserId) params.user_id = storedUserId;
            const qs = new URLSearchParams(params).toString();
            const res = await fetch(`https://${hostIP}:5000/api/pending-child-deployments?${qs}`);
            const data = await res.json().catch(() => ({}));
            if (res.ok && Array.isArray(data?.rows)) {
              nodes = data.rows.map(r => ({ serverid: r.serverid, serverip: r.serverip, type: 'secondary' }));
            }
          } catch (_) {}
        }

        // Load config map if present; OK if missing
        let configMap = {};
        try {
          const configRaw = sessionStorage.getItem('cloud_networkApplyResult');
          configMap = configRaw ? JSON.parse(configRaw) : {};
        } catch (_) { configMap = {}; }

        // Process each node
        if (Array.isArray(nodes) && nodes.length > 0) {
          for (const node of nodes) {
            try {
              const form = configMap[node.serverip] || null;
              const roleIps = extractRoleIps(form);
              // 1) Mark child deployment log completed
              await fetch(`https://${hostIP}:5000/api/child-deployment-activity-log/${encodeURIComponent(node.serverid)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'completed' })
              }).catch(() => {});
              // 2) Finalize child deployment (insert/update child_node)
              await fetch(`https://${hostIP}:5000/api/finalize-child-deployment/${encodeURIComponent(node.serverid)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  role: node.type || 'child',
                  ...roleIps,
                })
              }).catch(() => {});
            } catch (e) {
              // Swallow per-node errors to avoid blocking others
            }
          }
        }

        // After finalization, clear flow-specific session data
        clearCloudSessionData();

        // Notify parent if needed
        if (typeof onDeploymentComplete === 'function') {
          onDeploymentComplete();
        }
      };
      runFinalize().catch(() => {});
    }
  }, [deploymentInProgress, onDeploymentComplete]);

  useEffect(() => {
    if (deploymentInProgress === false) {
      const handleBeforeUnload = () => {
        sessionStorage.setItem('cloud_shouldResetOnNextMount', 'true');
        sessionStorage.setItem('lastMenuPath', '/addnode?tab=1');
        sessionStorage.setItem('lastCloudPath', '/addnode?tab=1');
        sessionStorage.setItem('lastZtiPath', '/addnode?tab=1');
        sessionStorage.setItem('lastAddnodePath', '/addnode?tab=1');
        sessionStorage.setItem('cloud_activeTab', '1');
        // Disable tabs 2-5 after completion (default mode)
        sessionStorage.setItem('cloud_disabledTabs', JSON.stringify({ "2": true, "3": true, "4": true, "5": true }));
      };

      window.addEventListener('beforeunload', handleBeforeUnload);
      return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
        sessionStorage.setItem('cloud_shouldResetOnNextMount', 'true');
        sessionStorage.setItem('lastMenuPath', '/addnode?tab=1');
        sessionStorage.setItem('lastCloudPath', '/addnode?tab=1');
        sessionStorage.setItem('lastZtiPath', '/addnode?tab=1');
        sessionStorage.setItem('lastAddnodePath', '/addnode?tab=1');
        sessionStorage.setItem('cloud_activeTab', '1');
        // Disable tabs 2-5 after completion (default mode)
        sessionStorage.setItem('cloud_disabledTabs', JSON.stringify({ "2": true, "3": true, "4": true, "5": true }));
      };
    }
  }, [deploymentInProgress]);

  return (
    <div style={{ padding: '20px' }}>
      <h5 style={{ display: "flex", flex: "1", marginLeft: "-2%", marginBottom: "1.25%" }}>
        Node Addition Status
      </h5>
      <Divider />
      <Card title={`Cloud Deployment Progress for ${cloudName} (${sessionStorage.getItem('cloud_server_ip') || 'N/A'})`}>
        <Row gutter={24}>
          <Col span={24}>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: 250 }}>
              {deploymentInProgress ? (
                <>
                  <img
                    src={gifUrl || planeGifRef.current}
                    alt="Deployment Progress"
                    loading="eager"
                    decoding="async"
                    draggable={false}
                    style={{ width: 280, height: 280, objectFit: 'contain', display: 'block', transform: 'translateZ(0)', willChange: 'transform' }}
                  />
                  <div style={{ marginTop: 16, fontWeight: 500 }}>Deployment in progress</div>
                </>
              ) : (
                <>
                  <img
                    src={completedImage}
                    alt="Deployment Completed"
                    loading="eager"
                    decoding="sync"
                    style={{ width: 280, height: 280, objectFit: 'contain', display: 'block' }}
                  />
                  <div style={{ marginTop: 16, fontWeight: 500 }}>Deployment completed</div>
                </>
              )}
            </div>
          </Col>
        </Row>
      </Card>
      {!deploymentInProgress && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20, width: '75px' }}>
          <Button
            type="primary"
            onClick={() => {
              try {
                sessionStorage.setItem('cloud_shouldResetOnNextMount', 'true');
                sessionStorage.setItem('lastMenuPath', '/iaas');
                sessionStorage.setItem('lastCloudPath', '/iaas');
                sessionStorage.setItem('cloud_activeTab', '1');
                sessionStorage.setItem('cloud_disabledTabs', JSON.stringify({ "2": true, "3": true, "4": true, "5": true }));
              } catch (_) {}
              navigate('/iaas');
            }}
          >
            Go to IaaS
          </Button>
        </div>
      )}
    </div>
  );
};

export default Report;
