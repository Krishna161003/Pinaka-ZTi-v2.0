import React, { useEffect, useState, useRef } from 'react';
import { Divider, Card, Progress, Row, Col, Flex, Spin, Button } from 'antd';
import { CloudOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

const getCloudName = () => {
  const fromSession = sessionStorage.getItem('cloudName');
  if (fromSession) return fromSession;
  const meta = document.querySelector('meta[name="cloud-name"]');
  return meta ? meta.content : 'Default';
};

const hostIP = window.location.hostname;

const Report = ({ ibn, onDeploymentComplete }) => {
  const navigate = useNavigate();
  const [completionWindowActive, setCompletionWindowActive] = useState(false);
  const completionWindowTimeoutRef = useRef(null);
  const revertedRef = useRef(false);
  const cloudName = getCloudName();
  const [percent, setPercent] = useState(0);
  const [completedLogs, setCompletedLogs] = useState([]);
  const [error, setError] = useState(null);
  const [deploymentPollingStopped, setDeploymentPollingStopped] = useState(false);

  // Track serverid for this deployment (from sessionStorage only)
  const serveridRef = React.useRef(sessionStorage.getItem('currentServerid') || null);

  const intervalRef = useRef(null);
  useEffect(() => {
    let isMounted = true;
    let completedTime = null;
    let stopTimeout = null;

    // Debug: Log each time fetchProgress runs and the percent value
    const debugFetchProgress = (data) => {
      console.log('fetchProgress polled:', {
        percent: data.percent,
        completed_steps: data.completed_steps,
        serveridRef: serveridRef.current,
        sessionStorageServerid: sessionStorage.getItem('currentServerid')
      });
    };

    // Helper to mark deployment as completed
    const logDeploymentComplete = async () => {
      if (!serveridRef.current) return;
      const currentServerid = serveridRef.current;
      serveridRef.current = null; // Prevent duplicate calls immediately
      try {
        // Mark as completed
        await fetch(`https://${hostIP}:5000/api/deployment-activity-log/${currentServerid}`, {
          method: 'PATCH'
        });

        // Finalize deployment (transfer to appropriate table)
        // Determine server_type based on deployment type or user selection
        const server_type = 'host'; // Default to 'host', you can modify this logic

        // Normalize license from sessionStorage
        const lsRaw = sessionStorage.getItem('licenseStatus') || '{}';
        const ls = JSON.parse(lsRaw);
        const lsTypeStr = String(ls?.type || '').toLowerCase();
        const lsPerpetual = lsTypeStr === 'perpetual' || lsTypeStr === 'perpectual';
        // If license already activated, set start_date to today and end_date to null (frontend mirror of backend)
        if (String(ls?.status || '').toLowerCase() === 'activated') {
          const today = new Date().toISOString().split('T')[0];
          const updated = {
            ...ls,
            period: lsPerpetual ? null : (ls?.period ?? null),
            start_date: today,
            end_date: null,
          };
          sessionStorage.setItem('licenseStatus', JSON.stringify(updated));
        }
        // Re-read after potential update to ensure we send normalized values
        const lsNow = JSON.parse(sessionStorage.getItem('licenseStatus') || '{}');

        await fetch(`https://${hostIP}:5000/api/finalize-deployment/${currentServerid}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            server_type,
            license_code: lsNow?.license_code || null,
            license_type: lsNow?.type || null,
            license_period: (String(lsNow?.type || '').toLowerCase() === 'perpetual' || String(lsNow?.type || '').toLowerCase() === 'perpectual') ? null : (lsNow?.period || null),
            license_start_date: lsNow?.start_date || null,
            license_end_date: lsNow?.end_date ?? null,
            role: server_type === 'host' ? 'master' : 'worker',
            host_serverid: server_type === 'child' ? 'parent-host-id' : null, // Only needed for child nodes
            Management: sessionStorage.getItem('Management') || null,
            External_Traffic: sessionStorage.getItem('External_Traffic') || null,
            Storage: sessionStorage.getItem('Storage') || null,
            VXLAN: sessionStorage.getItem('VXLAN') || null
          })
        });

        console.log(`Deployment finalized as ${server_type}`);
        sessionStorage.removeItem('currentServerid');
        if (typeof onDeploymentComplete === 'function') {
          onDeploymentComplete();
        }
      } catch (e) {
        console.error('Error completing deployment:', e);
      }
    };

    // Helper to revert status to progress if needed
    const revertToProgress = async () => {
      if (!serveridRef.current) return;
      try {
        await fetch(`https://${hostIP}:5000/api/deployment-activity-log/${serveridRef.current}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'progress' })
        });
        revertedRef.current = true;
        console.log('Deployment status reverted to progress due to drop in percent.');
      } catch (e) {
        console.error('Failed to revert deployment status:', e);
      }
    };

    const fetchProgress = async () => {
      try {
        const res = await fetch(`https://${hostIP}:2020/deployment-progress`);
        if (isMounted) {
          if (res.ok) {
            const data = await res.json();
            setPercent(data.percent || 0);
            setCompletedLogs(data.completed_steps || []);
            setError(null);

            debugFetchProgress(data);

            // Stop polling IMMEDIATELY if deployment is complete
            if ((data.percent || 0) === 100) {
              if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
              }
              setDeploymentPollingStopped(true);
            }

            // Log deployment completion in DB if just completed
            if ((data.percent || 0) === 100 && serveridRef.current) {
              await logDeploymentComplete();
            }

            // Start 3-min window after deployment completes
            if ((data.percent || 0) === 100 && !completedTime) {
              completedTime = Date.now();
              setCompletionWindowActive(true);
              revertedRef.current = false;
              if (completionWindowTimeoutRef.current) clearTimeout(completionWindowTimeoutRef.current);
              completionWindowTimeoutRef.current = setTimeout(() => {
                setCompletionWindowActive(false);
                revertedRef.current = false;
              }, 180000); // 3 minutes
              // Set a timeout to stop polling after 5 minutes (as before)
              stopTimeout = setTimeout(() => {
                if (intervalRef.current) clearInterval(intervalRef.current);
              }, 300000); // 5 minutes
            }

            // If in the 3-min window and percent drops below 100, revert status
            if (
              completionWindowActive &&
              (data.percent || 0) < 100 &&
              !revertedRef.current &&
              serveridRef.current
            ) {
              revertToProgress();
            }
          } else {
            setPercent(0);
            setCompletedLogs([]);
            setError(null);
          }
        }
      } catch (err) {
        if (isMounted) setError('Failed to connect to backend. Please check your network or server.');
      }
    };

    // Start polling progress
    fetchProgress();
    intervalRef.current = setInterval(fetchProgress, 2000);

    return () => {
      isMounted = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (stopTimeout) clearTimeout(stopTimeout);
      if (completionWindowTimeoutRef.current) clearTimeout(completionWindowTimeoutRef.current);
    };
  }, [cloudName, completionWindowActive, onDeploymentComplete, deploymentPollingStopped]);

  // Define all possible steps as in backend
  const allSteps = [
    'Step 1: Initialization',
    'Step 2: Resources created',
    'Step 3: Configuration applied',
    'Step 4: Services started',
    'Step 5: Finalizing deployment',
    'Deployment Completed'
  ];

  // Render steps: completed, in progress, future
  let progressList = [];
  let foundInProgress = false;
  for (let i = 0; i < allSteps.length; i++) {
    if (i < completedLogs.length) {
      // Completed step
      progressList.push(<li key={i}>{allSteps[i]}</li>);
    } else if (!foundInProgress) {
      // First incomplete step is in progress, add loader
      progressList.push(
        <li key={i} style={{ display: 'flex', alignItems: 'center' }}>
          <em>{allSteps[i].replace('Step', 'Step') + ' in progress'}</em>
          <Spin size="small" style={{ marginLeft: 8 }} />
        </li>
      );
      foundInProgress = true;
    } else {
      // Future steps
      progressList.push(<li key={i} style={{ color: '#bbb' }}>{allSteps[i]}</li>);
    }
  }

  // Set reset flag if deployment is complete and user leaves Report tab (SPA navigation or browser unload)
  // const location = useLocation();
  useEffect(() => {
    if (percent === 100) {
      const handleBeforeUnload = () => {
        sessionStorage.setItem('serverVirtualization_shouldResetOnNextMount', 'true');
        sessionStorage.setItem('lastMenuPath', '/servervirtualization?tab=1');
        sessionStorage.setItem('lastServerVirtualizationPath', '/servervirtualization?tab=1');
        sessionStorage.setItem('lastZtiPath', '/servervirtualization?tab=1');
        sessionStorage.setItem('serverVirtualization_activeTab', '1');
        sessionStorage.setItem('disabledTabs', JSON.stringify({ "2": true, "3": true, "4": true, "5": true, "6": true }));
        sessionStorage.setItem('serverVirtualization_disabledTabs', JSON.stringify({ "2": true, "3": true, "4": true, "5": true, "6": true })); 
      };
      window.addEventListener('beforeunload', handleBeforeUnload);
      return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
        sessionStorage.setItem('serverVirtualization_shouldResetOnNextMount', 'true');
        sessionStorage.setItem('lastMenuPath', '/servervirtualization?tab=1');
        sessionStorage.setItem('lastServerVirtualizationPath', '/servervirtualization?tab=1');
        sessionStorage.setItem('lastZtiPath', '/servervirtualization?tab=1');
        sessionStorage.setItem('serverVirtualization_activeTab', '1');
        sessionStorage.setItem('disabledTabs', JSON.stringify({ "2": true, "3": true, "4": true, "5": true, "6": true }));
        sessionStorage.setItem('serverVirtualization_disabledTabs', JSON.stringify({ "2": true, "3": true, "4": true, "5": true, "6": true })); 
      };
    }
  }, [percent]);

  // // Also run disabling logic if navigating away from Report (SPA navigation)
  // useEffect(() => {
  //   if (percent === 100) {
  //     return () => {
  //       sessionStorage.setItem('serverVirtualization_shouldResetOnNextMount', 'true');
  //       sessionStorage.setItem('lastMenuPath', '/servervirtualization?tab=1');
  //       sessionStorage.setItem('lastServerVirtualizationPath', '/servervirtualization?tab=1');
  //       sessionStorage.setItem('lastZtiPath', '/servervirtualization?tab=1');
  //       sessionStorage.setItem('serverVirtualization_activeTab', '1');
  //       sessionStorage.setItem('disabledTabs', JSON.stringify({ "2": true, "3": true, "4": true, "5": true, "6": true }));
  //       sessionStorage.setItem('serverVirtualization_disabledTabs', JSON.stringify({ "2": true, "3": true, "4": true, "5": true, "6": true })); 
  //     };
  //   }
  // }, [location.pathname, percent]);
  
  return (
    <div style={{ padding: '20px' }}>
      <h5 style={{ display: "flex", flex: "1", marginLeft: "-2%", marginBottom: "1.25%" }}>
        <CloudOutlined />
        &nbsp;&nbsp;{cloudName} Cloud
      </h5>
      <Divider />
      <Card title={`Progress Report for ${cloudName} Cloud (${sessionStorage.getItem('server_ip')})`}>
        <Row gutter={24}>
          <Col span={24}>
            <Flex gap="small" vertical style={{ marginBottom: '20px' }}>
              <Progress percent={percent} status={percent === 100 ? "success" : "active"} />
            </Flex>
            {error && <div style={{ color: 'red', marginBottom: 8 }}>{error}</div>}
            <div
              style={{
                border: '1px solid #d9d9d9',
                borderRadius: '4px',
                padding: '12px',
                backgroundColor: '#fafafa',
              }}
            >
              <strong>Deployment Progress:</strong>
              <ul style={{ paddingLeft: '20px', marginTop: '10px' }}>
                {progressList}
              </ul>
            </div>
            {percent === 100 && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20, width: '75px' }}>
                <Button type="primary" onClick={() => {
                  sessionStorage.setItem('serverVirtualization_shouldResetOnNextMount', 'true');
                  sessionStorage.setItem('lastMenuPath', '/iaas');
                  sessionStorage.setItem('lastServerVirtualizationPath', '/iaas');
                  sessionStorage.setItem('lastZtiPath', '/iaas');
                  sessionStorage.setItem('serverVirtualization_activeTab', '1');
                  navigate('/iaas');
                }}>
                  Go to IaaS
                </Button>
              </div>
            )}
          </Col>
        </Row>
      </Card>
    </div>
  );
};

export default Report;