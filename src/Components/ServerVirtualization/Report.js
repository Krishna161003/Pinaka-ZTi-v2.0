import React, { useEffect, useState, useRef } from 'react';
import { Divider, Card, Row, Col, Button, notification } from 'antd';
import { useNavigate } from 'react-router-dom';

const getCloudNameFromMetadata = () => {
  let cloudNameMeta = document.querySelector('meta[name="cloud-name"]');
  const fromSession = sessionStorage.getItem('cloudName');
  return fromSession || (cloudNameMeta ? cloudNameMeta.content : 'Cloud');
};

const hostIP = window.location.hostname;
// Stable asset imports to avoid re-decoding/restarting animations on re-renders
const planeGif = require('../../Images/plane.gif');
const completedImage = require('../../Images/completed.png');

const Report = ({ onDeploymentComplete }) => {
  const navigate = useNavigate();
  const cloudName = getCloudNameFromMetadata();
  const [deploymentInProgress, setDeploymentInProgress] = useState(true);
  const finalizedRef = useRef(false);
  const prevDeploymentStatus = useRef(true); // Track previous deployment status
  // Using static asset for GIF; no blob preloading

  // Poll backend for node deployment progress
  useEffect(() => {
    let interval = setInterval(() => {
      fetch(`https://${hostIP}:2020/node-deployment-progress`)
        .then(res => res.json())
        .then(data => {
          if (data && typeof data.in_progress === 'boolean') {
            setDeploymentInProgress(prev => {
              const newStatus = data.in_progress;
              // Show notification when deployment completes
              if (prev === true && newStatus === false) {
                const key = `open${Date.now()}`;
                const btn = (
                  <Button 
                    type="primary" 
                    size="small"
                    onClick={() => {
                      notification.close(key);
                      navigate('/iaas');
                    }}
                  >
                    Go to IaaS
                  </Button>
                );
                notification.success({
                  message: 'Deployment Completed',
                  description: 'Your server virtualization deployment has been successfully completed!',
                  btn,
                  key,
                  duration: 12,
                  placement: 'bottomRight'
                });
              }
              return newStatus;
            });
          }
        })
        .catch(() => {});
    }, 3000);
    // Initial check
    fetch(`https://${hostIP}:2020/node-deployment-progress`)
      .then(res => res.json())
      .then(data => {
        if (data && typeof data.in_progress === 'boolean') {
          const newStatus = data.in_progress;
          setDeploymentInProgress(newStatus);
          prevDeploymentStatus.current = newStatus;
        }
      })
      .catch(() => {});
    return () => clearInterval(interval);
  }, []);

  // Persist behavior when leaving Report tab while deployment is in progress
  useEffect(() => {
    return () => {
      if (deploymentInProgress) {
        try {
          sessionStorage.setItem('serverVirtualization_activeTab', '6');
          sessionStorage.setItem('serverVirtualization_disabledTabs', JSON.stringify({ '1': true, '2': true, '3': true, '4': true, '5': true, '6': false }));
          sessionStorage.setItem('disabledTabs', JSON.stringify({ '1': true, '2': true, '3': true, '4': true, '5': true, '6': false }));
          sessionStorage.setItem('lastMenuPath', '/servervirtualization?tab=6');
          sessionStorage.setItem('lastServerVirtualizationPath', '/servervirtualization?tab=6');
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

  // Clear only flow-specific session data (keep tab/navigation keys intact)
  const clearSVSessionData = () => {
    try {
      const keysToRemove = [
        'sv_licenseStatus',
        'sv_licenseNodes',
        'sv_licenseActivationResults',
        'sv_networkApplyCardStatus',
        'sv_networkApplyForms',
        'sv_networkApplyResult',
        'sv_networkApplyRestartEndTimes',
        'sv_networkApplyBootEndTimes',
        'sv_lastDeploymentNodes',
        'sv_vip',
        'validatedNodes',
        'selectedNodes',
      ];
      keysToRemove.forEach(k => sessionStorage.removeItem(k));
    } catch (_) {}
  };

  // When deployment finishes, finalize deployments in backend (with session fallback)
  useEffect(() => {
    if (!deploymentInProgress && !finalizedRef.current) {
      finalizedRef.current = true;
      const runFinalize = async () => {
        // Try session first
        let nodes = [];
        try {
          const nodesRaw = sessionStorage.getItem('sv_lastDeploymentNodes');
          if (nodesRaw) {
            nodes = JSON.parse(nodesRaw) || [];
          }
        } catch (_) {}

        // If session missing, fetch pending nodes from backend filtered by type=primary
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
            // Build a resilient fetch that tolerates cleared session values
            const fetchCandidates = async (params) => {
              const qs = new URLSearchParams(params).toString();
              const res = await fetch(`https://${hostIP}:5000/api/pending-node-deployments?${qs}`);
              const data = await res.json().catch(() => ({}));
              return res.ok && Array.isArray(data?.rows) ? data.rows : [];
            };

            // Attempt 1: with cloudname (only if valid) + user_id
            const validCloud = cloudName && cloudName !== 'Cloud';
            let base = { status: 'progress', type: 'primary' };
            if (validCloud) base.cloudname = cloudName;
            if (storedUserId) base.user_id = storedUserId;
            let rows = await fetchCandidates(base);

            // Attempt 2: drop cloudname filter
            if ((!rows || rows.length === 0) && validCloud) {
              const { cloudname, ...rest } = base;
              rows = await fetchCandidates(rest);
            }

            // Attempt 3: drop user filter as well
            if (!rows || rows.length === 0) {
              rows = await fetchCandidates({ status: 'progress', type: 'primary' });
            }

            // Attempt 4: sometimes status might already be 'completed' by the time we reach here
            if (!rows || rows.length === 0) {
              rows = await fetchCandidates({ status: 'completed', type: 'primary' });
            }

            if (Array.isArray(rows) && rows.length > 0) {
              nodes = rows.map(r => ({ serverid: r.serverid, serverip: r.serverip }));
            }
          } catch (_) {}
        }

        // Load config map if present (role IPs); missing is OK
        let configMap = {};
        try {
          const configRaw = sessionStorage.getItem('sv_networkApplyResult');
          configMap = configRaw ? JSON.parse(configRaw) : {};
        } catch (_) { configMap = {}; }

        // Process each node
        if (Array.isArray(nodes) && nodes.length > 0) {
          for (const node of nodes) {
            try {
              const form = configMap[node.serverip] || null;
              const roleIps = extractRoleIps(form);
              // 1) Mark node deployment log completed (primary)
              await fetch(`https://${hostIP}:5000/api/node-deployment-activity-log/${encodeURIComponent(node.serverid)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'completed' })
              }).catch(() => {});
              // 2) Finalize node deployment (upsert into deployed_server and activate license)
              const roleStr = Array.isArray(form?.selectedRoles) && form.selectedRoles.length > 0
                ? form.selectedRoles.join(',')
                : 'child';
              await fetch(`https://${hostIP}:5000/api/finalize-node-deployment/${encodeURIComponent(node.serverid)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  role: roleStr,
                  ...roleIps,
                })
              }).catch(() => {});
            } catch (e) {
              // Swallow per-node errors to avoid blocking others
            }
          }
        }

        // After finalization, clear flow-specific session data
        clearSVSessionData();

        if (typeof onDeploymentComplete === 'function') {
          onDeploymentComplete();
        }
      };
      runFinalize().catch(() => {});
    }
  }, [deploymentInProgress, onDeploymentComplete]);

  // Reset SV tabs to defaults after completion when unloading/leaving
  useEffect(() => {
    if (deploymentInProgress === false) {
      const handleBeforeUnload = () => {
        sessionStorage.setItem('serverVirtualization_shouldResetOnNextMount', 'true');
        sessionStorage.setItem('lastMenuPath', '/servervirtualization?tab=1');
        sessionStorage.setItem('lastServerVirtualizationPath', '/servervirtualization?tab=1');
        sessionStorage.setItem('lastZtiPath', '/servervirtualization?tab=1');
        sessionStorage.setItem('serverVirtualization_activeTab', '1');
        sessionStorage.setItem('serverVirtualization_disabledTabs', JSON.stringify({ '2': true, '3': true, '4': true, '5': true, '6': true }));
        sessionStorage.setItem('disabledTabs', JSON.stringify({ '2': true, '3': true, '4': true, '5': true, '6': true }));
      };
      window.addEventListener('beforeunload', handleBeforeUnload);
      return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
        sessionStorage.setItem('serverVirtualization_shouldResetOnNextMount', 'true');
        sessionStorage.setItem('lastMenuPath', '/servervirtualization?tab=1');
        sessionStorage.setItem('lastServerVirtualizationPath', '/servervirtualization?tab=1');
        sessionStorage.setItem('lastZtiPath', '/servervirtualization?tab=1');
        sessionStorage.setItem('serverVirtualization_activeTab', '1');
        sessionStorage.setItem('serverVirtualization_disabledTabs', JSON.stringify({ '2': true, '3': true, '4': true, '5': true, '6': true }));
        sessionStorage.setItem('disabledTabs', JSON.stringify({ '2': true, '3': true, '4': true, '5': true, '6': true }));
      };
    }
  }, [deploymentInProgress]);

  // Build display of node IPs for title
  const getNodeIpsTitle = () => {
    try {
      const raw = sessionStorage.getItem('sv_lastDeploymentNodes');
      if (raw) {
        const arr = JSON.parse(raw);
        const ips = Array.isArray(arr) ? arr.map(n => n?.serverip).filter(Boolean) : [];
        if (ips.length) return ips.join(', ');
      }
    } catch (_) {}
    try {
      const rawMap = sessionStorage.getItem('sv_networkApplyResult');
      if (rawMap) {
        const obj = JSON.parse(rawMap) || {};
        const ips = Object.keys(obj || {});
        if (ips.length) return ips.join(', ');
      }
    } catch (_) {}
    return sessionStorage.getItem('server_ip') || 'N/A';
  };
  const nodeIpsTitle = getNodeIpsTitle();

  return (
    <div style={{ padding: '20px' }}>
      <h5 style={{ display: 'flex', flex: 1, marginLeft: '-2%', marginBottom: '1.25%' }}>
        Node Addition Status
      </h5>
      <Divider />
      <Card title={`Deployment Progress for ${cloudName} (${nodeIpsTitle})`}>
        <Row gutter={24}>
          <Col span={24}>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', width: '880px', marginBottom: '30px' }}>
              {deploymentInProgress ? (
                <>
                  <div style={{ width: 580, height: 180, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '-56px' }}>
                    <img
                      src={planeGif}
                      alt="Deployment Progress"
                      loading="eager"
                      decoding="async"
                      draggable={false}
                      style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', transform: 'translateZ(0)', willChange: 'transform' }}
                    />
                  </div>
                  <div style={{ marginTop: 16, fontWeight: 500 }}>Deployment in progress</div>
                </>
              ) : (
                <>
                  <div style={{ width: 580, height: 180, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '-56px' }}>
                    <img
                      src={completedImage}
                      alt="Deployment Completed"
                      loading="eager"
                      decoding="sync"
                      style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                    />
                  </div>
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
                sessionStorage.setItem('serverVirtualization_shouldResetOnNextMount', 'true');
                sessionStorage.setItem('lastMenuPath', '/iaas');
                sessionStorage.setItem('lastServerVirtualizationPath', '/iaas');
                sessionStorage.setItem('serverVirtualization_activeTab', '1');
                sessionStorage.setItem('serverVirtualization_disabledTabs', JSON.stringify({ '2': true, '3': true, '4': true, '5': true, '6': true }));
                sessionStorage.setItem('disabledTabs', JSON.stringify({ '2': true, '3': true, '4': true, '5': true, '6': true }));
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