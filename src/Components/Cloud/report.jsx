import React, { useEffect, useState, useRef } from 'react';
import { Divider, Card, Progress, Row, Col, Flex, Spin, Button, message } from 'antd';
import { CloudOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

const getCloudNameFromMetadata = () => {
  let cloudNameMeta = document.querySelector('meta[name="cloud-name"]');
  return cloudNameMeta ? cloudNameMeta.content : 'Cloud';
};

const hostIP = window.location.hostname;

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

  // Backend deployment progress polling
  const [deploymentInProgress, setDeploymentInProgress] = useState(true);
  // Placeholder for completed image path
  const completedImage = require('../../Images/completed.png'); // Change later

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

  // When deployment finishes, finalize child deployments in backend
  useEffect(() => {
    if (!deploymentInProgress && !finalizedRef.current) {
      finalizedRef.current = true;
      try {
        const nodesRaw = sessionStorage.getItem('cloud_lastDeploymentNodes');
        if (!nodesRaw) return;
        const nodes = JSON.parse(nodesRaw) || [];
        const configRaw = sessionStorage.getItem('cloud_networkApplyResult');
        const configMap = configRaw ? JSON.parse(configRaw) : {};

        nodes.forEach(async (node) => {
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
        });
      } catch (_) {}
    }
  }, [deploymentInProgress]);

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
                    src={require('./../../Images/plane.gif')}
                    alt="Deployment Progress"
                    style={{ width: 280, height: 280, objectFit: 'contain' }}
                  />
                  <div style={{ marginTop: 16, fontWeight: 500 }}>Deployment in progress</div>
                </>
              ) : (
                <>
                  <img
                    src={completedImage}
                    alt="Deployment Completed"
                    style={{ width: 280, height: 280, objectFit: 'contain' }}
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
