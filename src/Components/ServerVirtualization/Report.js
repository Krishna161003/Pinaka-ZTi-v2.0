import React, { useEffect, useState, useRef } from 'react';
import { Divider, Card, Row, Col, Button } from 'antd';
import { useNavigate } from 'react-router-dom';

const getCloudNameFromMetadata = () => {
  let cloudNameMeta = document.querySelector('meta[name="cloud-name"]');
  const fromSession = sessionStorage.getItem('cloudName');
  return fromSession || (cloudNameMeta ? cloudNameMeta.content : 'Cloud');
};

const hostIP = window.location.hostname;

const Report = ({ onDeploymentComplete }) => {
  const navigate = useNavigate();
  const cloudName = getCloudNameFromMetadata();
  const [deploymentInProgress, setDeploymentInProgress] = useState(true);
  const finalizedRef = useRef(false);

  // Placeholder images
  const completedImage = require('../../Images/completed.png');

  // Poll backend for node deployment progress
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

  // When deployment finishes, finalize child deployments in backend (SV storage keys)
  useEffect(() => {
    if (!deploymentInProgress && !finalizedRef.current) {
      finalizedRef.current = true;
      try {
        const nodesRaw = sessionStorage.getItem('sv_lastDeploymentNodes');
        if (!nodesRaw) return;
        const nodes = JSON.parse(nodesRaw) || [];
        const configRaw = sessionStorage.getItem('sv_networkApplyResult');
        const configMap = configRaw ? JSON.parse(configRaw) : {};

        nodes.forEach(async (node) => {
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
        });

        if (typeof onDeploymentComplete === 'function') {
          onDeploymentComplete();
        }
      } catch (_) {}
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

  return (
    <div style={{ padding: '20px' }}>
      <h5 style={{ display: 'flex', flex: 1, marginLeft: '-2%', marginBottom: '1.25%' }}>
        Node Addition Status
      </h5>
      <Divider />
      <Card title={`Server Virtualization Deployment Progress for ${cloudName} (${sessionStorage.getItem('server_ip') || 'N/A'})`}>
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