import React, { useEffect, useState, useRef } from 'react';
import { Divider, Card, Progress, Row, Col, Flex, Spin, Button, message, notification } from 'antd';
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
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);
  const [fadeClass, setFadeClass] = useState('fade-in');
  // Using static asset for GIF; no blob preloading

  // Deployment progress messages
  const deploymentMessages = [
    'Deployment in progress...',
    'Sit back and relax...',
    'Adding Squadrons...',
    'Powering up your infrastructure with extra squadrons...',
  ];

  // Backend deployment progress polling
  const [deploymentInProgress, setDeploymentInProgress] = useState(true);
  const prevDeploymentStatus = useRef(true); // Track previous deployment status

  // Message rotation effect for deployment progress
  useEffect(() => {
    if (!deploymentInProgress) return;

    const messageInterval = setInterval(() => {
      setFadeClass('fade-out');
      
      setTimeout(() => {
        setCurrentMessageIndex(prev => 
          prev === deploymentMessages.length - 1 ? 0 : prev + 1
        );
        setFadeClass('fade-in');
      }, 600); // Increased to 600ms for smoother transition
    }, 4000); // Increased to 4 seconds between messages

    return () => clearInterval(messageInterval);
  }, [deploymentInProgress, deploymentMessages.length]);

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
                  onClick={() => {
                    try {
                      sessionStorage.setItem('cloud_shouldResetOnNextMount', 'true');
                      sessionStorage.setItem('lastMenuPath', '/iaas');
                      sessionStorage.setItem('lastCloudPath', '/iaas');
                      sessionStorage.setItem('cloud_activeTab', '1');
                      sessionStorage.setItem('cloud_disabledTabs', JSON.stringify({ "2": true, "3": true, "4": true, "5": true }));
                    } catch (_) {}
                    notification.destroy(key);
                    navigate('/iaas');
                  }}
                >
                  Go to IaaS
                </Button>
                );
                notification.success({
                  message: 'Deployment Completed',
                  description: 'Your cloud deployment has been successfully completed!',
                  btn,
                  key,
                  duration: 12,
                  placement: 'topRight'
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
            // Build a resilient fetch that tolerates cleared session values
            const fetchCandidates = async (params) => {
              const qs = new URLSearchParams(params).toString();
              const res = await fetch(`https://${hostIP}:5000/api/pending-child-deployments?${qs}`);
              const data = await res.json().catch(() => ({}));
              return res.ok && Array.isArray(data?.rows) ? data.rows : [];
            };

            // Attempt 1: with cloudname (only if valid) + user_id
            const validCloud = cloudName && cloudName !== 'Cloud';
            let base = { status: 'progress' };
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
              rows = await fetchCandidates({ status: 'progress' });
            }

            // Attempt 4: sometimes status might already be 'completed' by the time we reach here
            if (!rows || rows.length === 0) {
              rows = await fetchCandidates({ status: 'completed' });
            }

            if (Array.isArray(rows) && rows.length > 0) {
              nodes = rows.map(r => ({ serverid: r.serverid, serverip: r.serverip, type: 'secondary' }));
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

  // Build display of node IPs for title
  const getNodeIpsTitle = () => {
    try {
      const raw = sessionStorage.getItem('cloud_lastDeploymentNodes');
      if (raw) {
        const arr = JSON.parse(raw);
        const ips = Array.isArray(arr) ? arr.map(n => n?.serverip).filter(Boolean) : [];
        if (ips.length) return ips.join(', ');
      }
    } catch (_) {}
    try {
      const rawMap = sessionStorage.getItem('cloud_networkApplyResult');
      if (rawMap) {
        const obj = JSON.parse(rawMap) || {};
        const ips = Object.keys(obj || {});
        if (ips.length) return ips.join(', ');
      }
    } catch (_) {}
    return sessionStorage.getItem('cloud_server_ip') || 'N/A';
  };
  const nodeIpsTitle = getNodeIpsTitle();

  return (
    <div style={{ padding: '20px' }}>
      <h5 style={{ display: "flex", flex: "1", marginLeft: "-2%", marginBottom: "1.25%" }}>
        Node Addition Status
      </h5>
      <Divider />
      <Card title={`Deployment Progress for ${cloudName} (${nodeIpsTitle})`}>
        <Row gutter={24}>
          <Col span={24}>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', width: '100%', marginBottom: '30px' }}>
              {deploymentInProgress ? (
                <>
                  <div style={{ width: 580, height: 180, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
                    <img
                      src={planeGif}
                      alt="Deployment Progress"
                      loading="eager"
                      decoding="async"
                      draggable={false}
                      style={{ width: '750px', height: '350px', objectFit: 'contain', display: 'block', transform: 'translateZ(0)', willChange: 'transform' }}
                    />
                  </div>
                  <div 
                    className={fadeClass}
                    style={{ 
                      marginTop: 16, 
                      fontWeight: 600,
                      fontSize: '18px',
                      transition: 'opacity 1.2s ease-in-out',
                      opacity: fadeClass === 'fade-in' ? 1 : 0,
                      minHeight: '28px',
                      textAlign: 'center'
                    }}
                  >
                    {deploymentMessages[currentMessageIndex]}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ width: 580, height: 180, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
                    <img
                      src={completedImage}
                      alt="Deployment Completed"
                      loading="eager"
                      decoding="sync"
                      style={{ width: '750px', height: '350px', objectFit: 'contain', display: 'block' }}
                    />
                  </div>
                  <div style={{ marginTop: 16, fontWeight: 600, fontSize: '18px', textAlign: 'center' }}>Deployment completed</div>
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
