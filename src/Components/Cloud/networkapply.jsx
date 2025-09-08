import React, { useState, useEffect } from 'react';
import { Card, Table, Input, Select, Button, Form, Radio, Checkbox, Divider, Typography, Space, Tooltip, message, Spin, Modal, notification } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { buildNetworkConfigPayload } from './networkapply.format';
import { buildDeployConfigPayload } from './networkapply.deployformat';
import { SSH_CONFIG, getStorageKey, parseSSHError, createSSHTimeoutNotification, validateSSHConfig, fetchWithRetry, validateSSHResponse } from '../../utils/sshConfig';

const hostIP = window.location.hostname;

// Global notification manager for Cloud Network Apply
if (!window.__cloudGlobalNotifications) {
  window.__cloudGlobalNotifications = {
    notifications: {},
    showNotification: function (key, message, description, onRetry) {
      // Close any existing notification with the same key
      if (this.notifications[key]) {
        notification.close(this.notifications[key]);
      }

      // Create new notification with retry button
      const notificationKey = `cloud-notification-${Date.now()}`;
      this.notifications[key] = notificationKey;

      notification.warning({
        key: notificationKey,
        message: message,
        description: (
          <div>
            <div style={{ marginBottom: 8 }}>{description}</div>
            <Button
              type="primary"
              size="small"
              onClick={() => {
                notification.close(notificationKey);
                delete this.notifications[key];
                if (onRetry) onRetry();
              }}
            >
              Retry Connection
            </Button>
          </div>
        ),
        duration: 0, // Don't auto-close
      });
    },
    closeNotification: function (key) {
      if (this.notifications[key]) {
        notification.close(this.notifications[key]);
        delete this.notifications[key];
      }
    }
  };
}

const NetworkApply = ({ onGoToReport, onRemoveNode, onUndoRemoveNode } = {}) => {
  const [hostServerId, setHostServerId] = useState(() => sessionStorage.getItem('host_server_id') || '');
  const [firstCloudName, setFirstCloudName] = useState(() => sessionStorage.getItem('cloud_first_cloudname') || '');

  const { Option } = Select;
  const ipRegex = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.|$)){4}$/;
  const subnetRegex = /^(255|254|252|248|240|224|192|128|0+)\.((255|254|252|248|240|224|192|128|0+)\.){2}(255|254|252|248|240|224|192|128|0+)$/;
  // Get the nodes from sessionStorage (as in Addnode.jsx)
  function getLicenseNodes() {
    const saved = sessionStorage.getItem('cloud_licenseNodes');
    return saved ? JSON.parse(saved) : [];
  }

  const RESTART_DURATION = 3000; // ms
  const BOOT_DURATION = 5000; // ms after restart
  const RESTART_ENDTIME_KEY = getStorageKey('cloud', 'RESTART_ENDTIME_KEY_PREFIX');
  const BOOT_ENDTIME_KEY = getStorageKey('cloud', 'BOOT_ENDTIME_KEY_PREFIX');
  // Persisted hostname map for Cloud: ip -> hostname (SQDN-XX)
  const CLOUD_HOSTNAME_MAP_KEY = getStorageKey('cloud', 'HOSTNAME_MAP_KEY_PREFIX');

  // SSH polling constants and keys - using standardized config
  const POLL_DELAY_MS = SSH_CONFIG.POLL_DELAY_MS;
  const POLL_INTERVAL_MS = SSH_CONFIG.POLL_INTERVAL_MS;
  const POLL_MAX_POLLS = SSH_CONFIG.POLL_MAX_POLLS;
  const SSH_DELAY_START_KEY = getStorageKey('cloud', 'DELAY_START_KEY_PREFIX');
  const RESTART_MSG_THROTTLE_MS = SSH_CONFIG.RESTART_MSG_THROTTLE_MS;

  // Delay start helpers
  const getDelayStartMap = () => {
    try {
      const raw = sessionStorage.getItem(SSH_DELAY_START_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  };

  const setDelayStartForIp = (ip, ts) => {
    try {
      const map = getDelayStartMap();
      if (ts) map[ip] = ts; else delete map[ip];
      sessionStorage.setItem(SSH_DELAY_START_KEY, JSON.stringify(map));
    } catch (_) { }
  };

  // Throttled restart info
  function infoRestartThrottled(ip) {
    try {
      const now = Date.now();
      if (!window.__cloudRestartInfoTs) window.__cloudRestartInfoTs = {};
      const last = window.__cloudRestartInfoTs[ip] || 0;
      if (now - last > RESTART_MSG_THROTTLE_MS) {
        window.__cloudRestartInfoTs[ip] = now;
        // message.info('Node restarting...');
      }
    } catch (_) { }
  }

  // Cross-menu navigation and notifications
  function navigateToNetworkApply() {
    try {
      const savedDisabled = sessionStorage.getItem('cloud_disabledTabs');
      const disabledTabs = savedDisabled ? JSON.parse(savedDisabled) : {};
      disabledTabs['4'] = false;
      sessionStorage.setItem('cloud_disabledTabs', JSON.stringify(disabledTabs));
      sessionStorage.setItem('cloud_activeTab', '4');
    } catch (_) { }
    try {
      const url = new URL(window.location.href);
      url.pathname = '/addnode';
      url.searchParams.set('tab', '4');
      window.location.href = url.toString();
    } catch (_) {
      window.location.href = '/addnode?tab=4';
    }
  }

  const notifySshSuccess = (ip) => {
    // Suppress redirect notification if already on Network Apply tab
    if (window.__cloudMountedNetworkApply) return;
    try { const active = sessionStorage.getItem('cloud_activeTab'); if (active === '4') return; } catch (_) { }
    const key = `cloud-ssh-${ip}`;
    notification.open({
      key,
      message: 'Node online',
      description: `Node ${ip} is back online.`,
      btn: (
        <Button type="link" onClick={navigateToNetworkApply}>
          Open Network Apply
        </Button>
      ),
      duration: 8,
    });
  };

  const notifySshTimeout = (ip) => {
    // Suppress redirect notification if already on Network Apply tab
    if (window.__cloudMountedNetworkApply) return;
    try { const active = sessionStorage.getItem('cloud_activeTab'); if (active === '4') return; } catch (_) { }

    // Global notification system will handle the persistent notification
    // We don't need to show a separate notification here as it's handled in beginInterval

    // Only show the in-app notification if not using global notifications
    if (!window.__cloudGlobalNotifications) {
      const key = `cloud-ssh-${ip}`;
      notification.open({
        key,
        message: 'SSH polling timeout',
        description: `Timeout while waiting for ${ip}.`,
        btn: (
          <Button type="link" onClick={navigateToNetworkApply}>
            Open Network Apply
          </Button>
        ),
        duration: 10,
      });
    }
  };

  const getCloudHostnameMap = () => {
    try {
      const raw = sessionStorage.getItem(CLOUD_HOSTNAME_MAP_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  };

  const saveCloudHostnameMap = (map) => {
    try { sessionStorage.setItem(CLOUD_HOSTNAME_MAP_KEY, JSON.stringify(map)); } catch (_) { }
  };

  const nextAvailableHostname = (usedSet, preferredNumber = 1) => {
    const make = (n) => `SQDN-${String(n).padStart(3, '0')}`;
    let n = Math.max(1, preferredNumber);
    while (usedSet.has(make(n))) n++;
    return make(n);
  };

  // Helper function to get network apply result from sessionStorage
  const getNetworkApplyResult = () => {
    const resultRaw = sessionStorage.getItem('cloud_networkApplyResult');
    if (resultRaw) {
      try {
        return JSON.parse(resultRaw);
      } catch (e) {
        return {};
      }
    }
    return {};
  };

  // Helper function to store form data in sessionStorage
  const storeFormData = (nodeIp, form) => {
    const networkApplyResult = getNetworkApplyResult();
    networkApplyResult[nodeIp] = {
      ...form,
      // Persist cloud name alongside each node definition
      cloudname: firstCloudName || sessionStorage.getItem('cloud_first_cloudname') || '',
      tableData: Array.isArray(form.tableData) ? form.tableData.map(row => ({ ...row, type: row.type })) : [],
    };
    sessionStorage.setItem('cloud_networkApplyResult', JSON.stringify(networkApplyResult));
  };

  // Helper function to get license details from sessionStorage
  const getLicenseDetailsMap = () => {
    const saved = sessionStorage.getItem('cloud_licenseActivationResults');
    if (!saved) return {};
    try {
      const arr = JSON.parse(saved);
      const map = {};
      for (const row of arr) {
        if (row.ip && row.details) map[row.ip] = row.details;
      }
      return map;
    } catch {
      return {};
    }
  };

  const [licenseNodes, setLicenseNodes] = useState(getLicenseNodes());

  // Synchronize licenseNodes with sessionStorage changes (for when new nodes are added from other components)
  useEffect(() => {
    const handleStorageChange = () => {
      const currentNodes = getLicenseNodes();
      setLicenseNodes(prev => {
        // Only update if nodes actually changed to avoid unnecessary re-renders
        const prevIps = prev.map(n => n.ip).sort();
        const currentIps = currentNodes.map(n => n.ip).sort();
        if (JSON.stringify(prevIps) !== JSON.stringify(currentIps)) {
          return currentNodes;
        }
        return prev;
      });
    };

    // Listen for storage events (cross-tab changes)
    window.addEventListener('storage', handleStorageChange);

    // Also check periodically for same-tab changes (like from LicenseActivation)
    const interval = setInterval(handleStorageChange, 500);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  // Track mounted state globally to allow background polling to update storage without setState leaks
  useEffect(() => {
    window.__cloudMountedNetworkApply = true;
    return () => {
      window.__cloudMountedNetworkApply = false;
      // Cleanup any global notifications when component unmounts
      if (window.__cloudPolling) {
        Object.keys(window.__cloudPolling).forEach(ip => {
          if (window.__cloudGlobalNotifications) {
            window.__cloudGlobalNotifications.closeNotification(`ssh-timeout-${ip}`);
          }
        });
      }
    };
  }, []);

  // Helper: update card status in sessionStorage by IP (to persist across navigation)
  const setCardStatusForIpInSession = (ip, nextStatus) => {
    try {
      const savedFormsRaw = sessionStorage.getItem('cloud_networkApplyForms');
      const savedStatusRaw = sessionStorage.getItem('cloud_networkApplyCardStatus');
      if (!savedFormsRaw || !savedStatusRaw) return;
      const formsArr = JSON.parse(savedFormsRaw);
      const statusArr = JSON.parse(savedStatusRaw);
      const idx = formsArr.findIndex(f => f && f.ip === ip);
      if (idx === -1) return;
      const merged = {
        ...(statusArr[idx] || { loading: false, applied: false }),
        ...nextStatus,
      };
      const nextStatusArr = [...statusArr];
      nextStatusArr[idx] = merged;
      sessionStorage.setItem('cloud_networkApplyCardStatus', JSON.stringify(nextStatusArr));
    } catch (_) { }
  };

  // Dynamic per-node disks and interfaces
  const [nodeDisks, setNodeDisks] = useState({});
  const [nodeInterfaces, setNodeInterfaces] = useState({});

  // Fetch disks and interfaces for a node
  const fetchNodeData = async (ip, useManagementIP = false, formData = null) => {
    // If network changes are applied and useManagementIP is true, determine the correct IP to use
    let targetIP = ip;
    if (useManagementIP && formData) {
      if (formData.configType === 'default') {
        // For default configuration, use the primary type interface IP
        const primaryRow = formData.tableData?.find(row => row.type === 'primary');
        targetIP = primaryRow?.ip || ip; // fallback to original IP if primary not found
      } else if (formData.configType === 'segregated') {
        // For segregated configuration, use the management type interface IP
        const mgmtRow = formData.tableData?.find(row =>
          Array.isArray(row.type) ? row.type.includes('Mgmt') : row.type === 'Mgmt'
        );
        targetIP = mgmtRow?.ip || ip; // fallback to original IP if Mgmt not found
      }
    }

    try {
      const [diskRes, ifaceRes] = await Promise.all([
        fetch(`https://${targetIP}:2020/get-disks`).then(r => r.json()),
        fetch(`https://${targetIP}:2020/get-interfaces`).then(r => r.json()),
      ]);

      // Map disks to include all necessary properties
      const formattedDisks = (diskRes.disks || []).map(disk => {
        const name = disk?.name ?? '';
        const size = disk?.size ?? '';
        const wwn = disk?.wwn ?? '';
        const id = wwn || `${name}|${size}`; // stable string id
        const label = `${name || 'Disk'} (${size || 'N/A'})`;
        const display = wwn ? `${name} (${size}, ${wwn})` : label;
        return { name, size, wwn, id, label, value: id, display };
      });

      setNodeDisks(prev => ({ ...prev, [ip]: formattedDisks }));
      const normalizedIfaces = (ifaceRes.interfaces || [])
        .map(i => {
          if (typeof i === 'string') return { iface: i };
          if (i && typeof i === 'object' && i.iface) return { iface: i.iface };
          return null;
        })
        .filter(Boolean);
      setNodeInterfaces(prev => ({ ...prev, [ip]: normalizedIfaces }));

      if (useManagementIP && targetIP !== ip) {
        message.success(`Successfully fetched data from ${targetIP} (management interface)`);
      }
    } catch (e) {
      console.error(`Failed to fetch data from node ${targetIP}:`, e);
      if (useManagementIP && targetIP !== ip) {
        message.error(`Failed to fetch data from ${targetIP} (management interface): ${e.message}`);
      } else {
        message.error(`Failed to fetch data from node ${targetIP}: ${e.message}`);
      }
    }
  };

  // On mount, fetch for all nodes that haven't been applied yet and fetch host server_id and first cloudname
  useEffect(() => {
    // Remove automatic fetching of node data on mount
    // Only fetch host server_id from backend
    async function fetchHostServerId() {
      try {
        const userId = JSON.parse(sessionStorage.getItem('loginDetails'))?.data?.id;
        const url = userId
          ? `https://${hostIP}:5000/api/first-host-serverid?userId=${encodeURIComponent(userId)}`
          : `https://${hostIP}:5000/api/first-host-serverid`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.server_id) {
          setHostServerId(data.server_id);
          sessionStorage.setItem('host_server_id', data.server_id);
        }
      } catch (e) {
        setHostServerId('');
      }
    }
    async function fetchFirstCloudname() {
      try {
        const url = `https://${hostIP}:5000/api/first-cloudname`;
        const res = await fetch(url);
        const data = await res.json();
        if (data && typeof data.cloudname !== 'undefined') {
          setFirstCloudName(data.cloudname || '');
          sessionStorage.setItem('cloud_first_cloudname', data.cloudname || '');
        }
      } catch (_) { }
    }
    fetchHostServerId();
    fetchFirstCloudname();
  }, [licenseNodes]);

  // Per-card loading and applied state, restore from sessionStorage if available
  const getInitialCardStatus = () => {
    const saved = sessionStorage.getItem('cloud_networkApplyCardStatus');
    if (saved) return JSON.parse(saved);
    return licenseNodes.map(() => ({ loading: false, applied: false }));
  };
  const [cardStatus, setCardStatus] = useState(getInitialCardStatus);
  // Per-card button loading for backend validation phase (before SSH polling)
  const [btnLoading, setBtnLoading] = useState(() => (Array.isArray(licenseNodes) ? licenseNodes.map(() => false) : []));
  // For loader recovery timers
  const timerRefs = React.useRef([]);
  // Store last removed node data for Undo
  const lastRemovedRef = React.useRef(null);
  // Restore forms from sessionStorage if available and merge with license details
  const getInitialForms = () => {
    // Get saved license details
    const licenseDetailsMap = getLicenseDetailsMap();
    // Get hostname map
    const hostnameMap = getCloudHostnameMap();

    // Get saved forms from sessionStorage if they exist
    const savedForms = sessionStorage.getItem('cloud_networkApplyForms');
    if (savedForms) {
      try {
        const forms = JSON.parse(savedForms);
        // Merge license details into saved forms and normalize fields
        return forms.map(form => ({
          ...form,
          hostname: form.hostname || hostnameMap[form.ip] || '',
          licenseType: licenseDetailsMap[form.ip]?.type || form.licenseType || '-',
          licensePeriod: licenseDetailsMap[form.ip]?.period || form.licensePeriod || '-',
          licenseCode: licenseDetailsMap[form.ip]?.licenseCode || form.licenseCode || '-',
          selectedDisks: Array.isArray(form.selectedDisks)
            ? form.selectedDisks.map(d => {
              if (typeof d === 'string') return d;
              if (d && typeof d === 'object') {
                return d.wwn || d.id || d.value || d.label || d.name || JSON.stringify(d);
              }
              return String(d ?? '');
            })
            : [],
          // Ensure roles are an array of strings
          selectedRoles: Array.isArray(form.selectedRoles)
            ? form.selectedRoles.filter(Boolean)
            : (typeof form.selectedRoles === 'string' && form.selectedRoles.length > 0
              ? form.selectedRoles.split(',').map(s => s.trim()).filter(Boolean)
              : []),
        }));
      } catch (e) {
        console.error('Failed to parse saved forms:', e);
      }
    }

    // If no saved forms or error, create new forms with license details
    return licenseNodes.map(node => ({
      ip: node.ip,
      configType: 'default',
      useBond: false,
      tableData: generateRows('default', false),
      defaultGateway: '',
      defaultGatewayError: '',
      hostname: hostnameMap[node.ip] || '',
      licenseType: licenseDetailsMap[node.ip]?.type || '-',
      licensePeriod: licenseDetailsMap[node.ip]?.period || '-',
      licenseCode: licenseDetailsMap[node.ip]?.licenseCode || '-',
      selectedDisks: [],
      diskError: '',
      selectedRoles: [],
      roleError: '',
    }));
  };
  const [forms, setForms] = useState(getInitialForms);
  // Global deploy button loading state
  const [deployLoading, setDeployLoading] = useState(false);
  // Force-enable selectors to allow corrections after validation failure
  const [forceEnableRoles, setForceEnableRoles] = useState({});
  const [forceEnableDisks, setForceEnableDisks] = useState({});

  // If licenseNodes changes (e.g. after license activation), restore from sessionStorage if available, else reset
  useEffect(() => {
    const savedForms = sessionStorage.getItem('cloud_networkApplyForms');
    const savedStatus = sessionStorage.getItem('cloud_networkApplyCardStatus');
    const savedLicenseDetails = getLicenseDetailsMap();
    const hostnameMap = getCloudHostnameMap();

    let updatedStatus; // Declare updatedStatus here so it's accessible later

    if (savedForms && savedStatus) {
      // Merge saved forms with any updated license details and add forms for new nodes
      const parsedForms = JSON.parse(savedForms);
      const parsedStatus = JSON.parse(savedStatus);

      // Create forms for all licenseNodes, preserving existing ones
      const updatedForms = licenseNodes.map((node, index) => {
        // Find existing form for this node
        const existingForm = parsedForms.find(f => f.ip === node.ip);
        if (existingForm) {
          // Update existing form with latest license details
          return {
            ...existingForm,
            licenseType: savedLicenseDetails[node.ip]?.type || existingForm.licenseType || '-',
            licensePeriod: savedLicenseDetails[node.ip]?.period || existingForm.licensePeriod || '-',
            licenseCode: savedLicenseDetails[node.ip]?.licenseCode || existingForm.licenseCode || '-',
            hostname: existingForm.hostname || hostnameMap[node.ip] || '',
            selectedDisks: Array.isArray(existingForm.selectedDisks)
              ? existingForm.selectedDisks.map(d => {
                if (typeof d === 'string') return d;
                if (d && typeof d === 'object') {
                  return d.wwn || d.id || d.value || d.label || d.name || JSON.stringify(d);
                }
                return String(d ?? '');
              })
              : [],
          };
        } else {
          // Create new form for new node
          return {
            ip: node.ip,
            configType: 'default',
            useBond: false,
            tableData: generateRows('default', false),
            defaultGateway: '',
            defaultGatewayError: '',
            hostname: hostnameMap[node.ip] || '',
            licenseType: savedLicenseDetails[node.ip]?.type || '-',
            licensePeriod: savedLicenseDetails[node.ip]?.period || '-',
            licenseCode: savedLicenseDetails[node.ip]?.licenseCode || '-',
            selectedDisks: [],
            diskError: '',
            selectedRoles: [],
            roleError: '',
          };
        }
      });

      // Create card status for all licenseNodes, preserving existing ones
      updatedStatus = licenseNodes.map((node, index) => {
        // Find existing status for this node
        const existingFormIndex = parsedForms.findIndex(f => f.ip === node.ip);
        if (existingFormIndex !== -1 && parsedStatus[existingFormIndex]) {
          return parsedStatus[existingFormIndex];
        } else {
          // Default status for new node
          return { loading: false, applied: false };
        }
      });

      setForms(updatedForms);
      setCardStatus(updatedStatus);
      // Reset per-card button loaders to idle for current forms length
      setBtnLoading(updatedForms.map(() => false));
    } else {
      // No saved forms, create fresh ones for all nodes
      const newForms = licenseNodes.map(node => ({
        ip: node.ip,
        configType: 'default',
        useBond: false,
        tableData: generateRows('default', false),
        defaultGateway: '',
        defaultGatewayError: '',
        hostname: hostnameMap[node.ip] || '',
        licenseType: savedLicenseDetails[node.ip]?.type || '-',
        licensePeriod: savedLicenseDetails[node.ip]?.period || '-',
        licenseCode: savedLicenseDetails[node.ip]?.licenseCode || '-',
        selectedDisks: [],
        diskError: '',
        selectedRoles: [],
        roleError: '',
      }));

      updatedStatus = licenseNodes.map(() => ({ loading: false, applied: false })); // Define updatedStatus here as well

      setForms(newForms);
      setCardStatus(updatedStatus);
      setBtnLoading(licenseNodes.map(() => false));
    }
  }, [licenseNodes]);

  // Loader recovery: keep loader until SSH polling succeeds or times out; do NOT auto-apply based on timers
  useEffect(() => {
    const restartEndTimesRaw = sessionStorage.getItem(RESTART_ENDTIME_KEY);
    const bootEndTimesRaw = sessionStorage.getItem(BOOT_ENDTIME_KEY);
    const restartEndTimes = restartEndTimesRaw ? JSON.parse(restartEndTimesRaw) : {};
    const bootEndTimes = bootEndTimesRaw ? JSON.parse(bootEndTimesRaw) : {};
    const now = Date.now();
    // For storing results
    let networkApplyResult = getNetworkApplyResult();
    cardStatus.forEach((status, idx) => {
      if (!status.loading) {
        // If not loading, ensure timer is cleared
        if (timerRefs.current[idx]) {
          clearTimeout(timerRefs.current[idx]);
          timerRefs.current[idx] = null;
        }
        // If applied and not yet stored, store the result (for robustness)
        if (status.applied) {
          const nodeIp = forms[idx]?.ip || `node${idx + 1}`;
          if (!networkApplyResult[nodeIp]) {
            storeFormData(nodeIp, forms[idx]);
          }
        }
      }
    });
    // Also, on every render, clean up any timers for cards that are no longer loading
    cardStatus.forEach((status, idx) => {
      if (!status.loading && timerRefs.current[idx]) {
        clearTimeout(timerRefs.current[idx]);
        timerRefs.current[idx] = null;
      }
    });
    // Persist the result object
    sessionStorage.setItem('cloud_networkApplyResult', JSON.stringify(networkApplyResult));
  }, [cardStatus, forms]);

  // Persist forms and cardStatus to sessionStorage on change
  useEffect(() => {
    sessionStorage.setItem('cloud_networkApplyForms', JSON.stringify(forms));
  }, [forms]);

  useEffect(() => {
    sessionStorage.setItem('cloud_networkApplyCardStatus', JSON.stringify(cardStatus));
  }, [cardStatus]);

  // Recover SSH polling timers after reload/navigation based on persisted delay-start timestamps
  useEffect(() => {
    if (!Array.isArray(forms) || forms.length === 0) return;
    const delayMap = getDelayStartMap();

    forms.forEach((f, idx) => {
      const ip = f?.ip;
      if (!ip) return;

      // Determine the correct SSH target IP based on config type
      let ssh_target_ip;
      if (f.configType === 'default') {
        // For default config, use primary type interface IP
        const primaryRow = f.tableData?.find(row => row.type === 'primary');
        ssh_target_ip = primaryRow?.ip || ip; // fallback to main IP if primary not found
      } else if (f.configType === 'segregated') {
        // For segregated config, use Mgmt type interface IP
        const MgmtRow = f.tableData?.find(row =>
          Array.isArray(row.type) ? row.type.includes('Mgmt') : row.type === 'Mgmt'
        );
        ssh_target_ip = MgmtRow?.ip || ip; // fallback to main IP if Mgmt not found
      } else {
        // Fallback to main node IP for any other config type
        ssh_target_ip = ip;
      }

      const status = cardStatus[idx] || {};
      if (!status.loading || status.applied) return;

      // Skip if timers already exist for this IP
      if ((window.__cloudPolling && window.__cloudPolling[ssh_target_ip]) || (window.__cloudPollingStart && window.__cloudPollingStart[ssh_target_ip])) return;

      const startAt = delayMap[ssh_target_ip] || 0;
      const elapsed = startAt ? (Date.now() - startAt) : 0;
      const remaining = Math.max(POLL_DELAY_MS - elapsed, 0);

      const beginInterval = () => {
        let pollCount = 0;
        const pollInterval = setInterval(() => {
          pollCount++;
          // Stop polling if we've exceeded the maximum attempts
          if (pollCount > POLL_MAX_POLLS) {
            clearInterval(pollInterval);
            setCardStatusForIpInSession(ip, { loading: false, applied: false });
            if (window.__cloudMountedNetworkApply) {
              setCardStatus(prev => prev.map((s, i) => i === idx ? { loading: false, applied: false } : s));
            }

            // Show persistent retry notification using global notification system
            const key = `ssh-timeout-${ssh_target_ip}`;
            if (window.__cloudGlobalNotifications) {
              // Capture variables in closure for retry function
              const retryTargetIp = ssh_target_ip;
              const retryOriginalIp = ip;
              const retryIdx = idx;

              const timeoutNotification = createSSHTimeoutNotification(retryTargetIp, 'cloud', () => {
                // Re-trigger backend scheduling and re-schedule frontend polling with delay
                const ssh_user = SSH_CONFIG.username;
                const ssh_pass = '';
                const ssh_key = '';

                message.info(`Retrying SSH polling for ${retryTargetIp}. Will begin after 2 minutes.`);

                try {
                  fetch(`https://${hostIP}:2020/poll-ssh-status`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ips: [retryTargetIp], ssh_user, ssh_pass, ssh_key })
                  }).then(() => {
                    // Reset the card status to loading state for retry
                    setCardStatusForIpInSession(retryOriginalIp, { loading: true, applied: false });
                    if (window.__cloudMountedNetworkApply) {
                      setCardStatus(prev => {
                        const currentIdx = prev.findIndex((_, i) => forms[i]?.ip === retryOriginalIp);
                        return prev.map((s, i) => i === currentIdx ? { loading: true, applied: false } : s);
                      });
                    }
                  }).catch(err => {
                    message.error(`Failed to restart SSH polling for ${retryTargetIp}: ${err.message}`);
                    // Ensure loader stays off if retry setup fails
                    setCardStatusForIpInSession(retryOriginalIp, { loading: false, applied: false });
                    if (window.__cloudMountedNetworkApply) {
                      setCardStatus(prev => {
                        const currentIdx = prev.findIndex((_, i) => forms[i]?.ip === retryOriginalIp);
                        return prev.map((s, i) => i === currentIdx ? { loading: false, applied: false } : s);
                      });
                    }
                  });
                } catch (_) {
                  message.error(`Failed to restart SSH polling for ${retryTargetIp}`);
                  // Ensure loader stays off if retry setup fails
                  setCardStatusForIpInSession(retryOriginalIp, { loading: false, applied: false });
                  if (window.__cloudMountedNetworkApply) {
                    setCardStatus(prev => {
                      const currentIdx = prev.findIndex((_, i) => forms[i]?.ip === retryOriginalIp);
                      return prev.map((s, i) => i === currentIdx ? { loading: false, applied: false } : s);
                    });
                  }
                }

                // Clear any existing timers and set a fresh delayed start
                try {
                  if (window.__cloudPolling && window.__cloudPolling[retryTargetIp]) {
                    clearInterval(window.__cloudPolling[retryTargetIp]);
                    delete window.__cloudPolling[retryTargetIp];
                  }
                  if (window.__cloudPollingStart && window.__cloudPollingStart[retryTargetIp]) {
                    clearTimeout(window.__cloudPollingStart[retryTargetIp]);
                    delete window.__cloudPollingStart[retryTargetIp];
                  }
                } catch (_) { }

                setDelayStartForIp(retryTargetIp, Date.now());
                const to = setTimeout(() => {
                  beginInterval();
                  if (window.__cloudPollingStart && window.__cloudPollingStart[retryTargetIp]) {
                    delete window.__cloudPollingStart[retryTargetIp];
                  }
                }, POLL_DELAY_MS);
                if (!window.__cloudPollingStart) window.__cloudPollingStart = {};
                window.__cloudPollingStart[retryTargetIp] = to;
              }
              );
            }

            message.error(`SSH polling timeout for ${ssh_target_ip}. Please check the node manually.`);
            if (window.__cloudPolling) delete window.__cloudPolling[ssh_target_ip];
            setDelayStartForIp(ssh_target_ip, null);
            return;
          }

          fetchWithRetry(`https://${hostIP}:2020/check-ssh-status?ip=${encodeURIComponent(ssh_target_ip)}`)
            .then(res => res.json())
            .then(data => {
              // Validate response to ensure data integrity
              const validatedData = validateSSHResponse(data, ssh_target_ip);

              if (validatedData.status === 'success' && validatedData.ip === ssh_target_ip) {
                setCardStatusForIpInSession(forms[idx]?.ip || ssh_target_ip, { loading: false, applied: true });
                if (window.__cloudMountedNetworkApply) {
                  setCardStatus(prev => prev.map((s, i) => i === idx ? { loading: false, applied: true } : s));
                }
                message.success(`Node ${data.ip} is back online!`);
                notifySshSuccess(ssh_target_ip);
                clearInterval(pollInterval);
                if (window.__cloudPolling) delete window.__cloudPolling[ssh_target_ip];
                if (window.__cloudPollingStart && window.__cloudPollingStart[ssh_target_ip]) {
                  delete window.__cloudPollingStart[ssh_target_ip];
                }
                setDelayStartForIp(ssh_target_ip, null);
                // Ensure form data is stored
                const nodeForm = forms[idx];
                const nodeIp = nodeForm?.ip || `node${idx + 1}`;
                if (nodeForm) storeFormData(nodeIp, nodeForm);
                // Note: After network changes are applied, the node IPs may have changed.
                // Automatic data fetching is disabled. Use "Refetch Data" button if needed.
              } else if (data.status === 'fail' && data.ip === ssh_target_ip) {
                infoRestartThrottled(ssh_target_ip);
              }
            })
            .catch(err => {
              console.error('SSH status check failed:', err);
              message.error(`SSH polling failed: ${err.message}. ${SSH_CONFIG.MESSAGES.RESPONSE_LOST}`);
              // On persistent network errors in recovery mode, stop polling to prevent stuck loader
              if (pollCount > POLL_MAX_POLLS / 2) {
                clearInterval(pollInterval);
                setCardStatusForIpInSession(forms[idx]?.ip || ssh_target_ip, { loading: false, applied: false });
                if (window.__cloudMountedNetworkApply) {
                  setCardStatus(prev => prev.map((s, i) => i === idx ? { loading: false, applied: false } : s));
                }
                if (window.__cloudPolling) delete window.__cloudPolling[ssh_target_ip];
                setDelayStartForIp(ssh_target_ip, null);
                message.error(`SSH polling failed due to network errors for ${ssh_target_ip}. Please check connectivity.`);
              }
            });
        }, POLL_INTERVAL_MS);

        if (!window.__cloudPolling) window.__cloudPolling = {};
        window.__cloudPolling[ssh_target_ip] = pollInterval;
      };

      if (remaining > 0) {
        const to = setTimeout(() => {
          beginInterval();
          if (window.__cloudPollingStart && window.__cloudPollingStart[ssh_target_ip]) {
            delete window.__cloudPollingStart[ssh_target_ip];
          }
        }, remaining);
        if (!window.__cloudPollingStart) window.__cloudPollingStart = {};
        window.__cloudPollingStart[ssh_target_ip] = to;
      } else {
        beginInterval();
      }
    });
  }, [forms, cardStatus]);

  function handleDiskChange(idx, value) {
    setForms(prev => prev.map((f, i) => i === idx ? { ...f, selectedDisks: value, diskError: '' } : f));
  }
  function handleRoleChange(idx, value) {
    setForms(prev => prev.map((f, i) => {
      if (i !== idx) return f;
      const hasStorage = Array.isArray(value) && value.includes('Storage');
      return {
        ...f,
        selectedRoles: value,
        roleError: '',
        // If Storage is not selected, disk selection is not mandatory; clear any prior disk error
        diskError: hasStorage ? f.diskError : ''
      };
    }));
  }

  function generateRows(configType, useBond) {
    const count = configType === 'default' ? 2 : 4;
    return Array.from({ length: count }, (_, i) => ({
      key: i,
      ip: '',
      subnet: '',
      dns: '',
      gateway: '',
      interface: useBond ? [] : '',
      bondName: '',
      vlanId: '',
      mtu: '',
      type: configType === 'default' ? '' : [],
      errors: {},
    }));
  }

  const handleConfigTypeChange = (idx, value) => {
    setForms(prev => prev.map((f, i) => i === idx ? {
      ...f,
      configType: value,
      tableData: generateRows(value, f.useBond)
    } : f));
  };
  const handleUseBondChange = (idx, checked) => {
    setForms(prev => prev.map((f, i) => i === idx ? {
      ...f,
      useBond: checked,
      tableData: generateRows(f.configType, checked)
    } : f));
  };
  // Reset handler for a specific node
  const handleReset = (idx) => {
    setForms(prev => prev.map((f, i) => i === idx ? {
      ...f,
      configType: 'default',
      useBond: false,
      tableData: generateRows('default', false),
      defaultGateway: '',
      defaultGatewayError: '',
    } : f));
  };

  const handleCellChange = (nodeIdx, rowIdx, field, value) => {
    setForms(prev => prev.map((f, i) => {
      if (i !== nodeIdx) return f;
      const updated = [...f.tableData];
      const row = { ...updated[rowIdx] };
      if (!row.errors) row.errors = {};

      if (field === 'type' && f.configType === 'default') {
        row.type = value;
        // Enforce primary/secondary mutual exclusivity
        const otherIndex = rowIdx === 0 ? 1 : 0;
        const otherRow = updated[otherIndex];
        if (value === 'primary') {
          otherRow.type = 'secondary';
        } else if (value === 'secondary') {
          otherRow.type = 'primary';
        }
        updated[otherIndex] = otherRow;
      } else if (field === 'type' && f.configType === 'segregated') {
        // In segregated mode, only one type can be selected per interface row
        let nextTypes = Array.isArray(value) ? value : [];

        // Limit to one type selection per row
        if (nextTypes.length > 1) {
          nextTypes = [nextTypes[nextTypes.length - 1]]; // Keep only the last selected
        }

        // Ensure only one row can have External_Traffic
        const someOtherHasExternal = updated.some((r, idx) => idx !== rowIdx && Array.isArray(r.type) && r.type.includes('External_Traffic'));
        if (nextTypes.includes('External_Traffic')) {
          if (someOtherHasExternal) {
            // Remove External_Traffic and notify
            nextTypes = nextTypes.filter(t => t !== 'External_Traffic');
            try { message.warning('Only one interface can be set to External_Traffic per node.'); } catch (_) { }
          }
        }

        // Handle Mgmt exclusivity - can only be on one interface
        if (nextTypes.includes('Mgmt')) {
          const someOtherHasMgmt = updated.some((r, idx) => idx !== rowIdx && Array.isArray(r.type) && r.type.includes('Mgmt'));
          if (someOtherHasMgmt) {
            // Remove Mgmt from other rows
            updated.forEach((r, idx) => {
              if (idx !== rowIdx && Array.isArray(r.type) && r.type.includes('Mgmt')) {
                r.type = r.type.filter(t => t !== 'Mgmt');
              }
            });
          }
        }

        row.type = nextTypes;
        // When External_Traffic selected for this row, clear IP/Subnet and related errors
        if (Array.isArray(row.type) && row.type.includes('External_Traffic')) {
          row.ip = '';
          row.subnet = '';
          if (row.errors) {
            delete row.errors.ip;
            delete row.errors.subnet;
            delete row.errors.dns;
          }
        }
        updated[rowIdx] = row;
        return { ...f, tableData: updated };
      } else if (field === 'defaultGateway') {
        // Handle default gateway separately
        const newForm = { ...f, defaultGateway: value };
        if (!ipRegex.test(value)) {
          newForm.defaultGatewayError = 'Should be a valid address';
        } else {
          newForm.defaultGatewayError = '';
        }
        return newForm;
      } else {
        row[field] = value;
        // Validation for IP/DNS/Gateway
        if (["ip", "dns", "gateway"].includes(field)) {
          if (!ipRegex.test(value)) {
            row.errors[field] = 'Should be a valid address';
          } else {
            // Duplicate IP check for segregated mode
            if (field === "ip" && f.configType === "segregated") {
              const isDuplicate = updated.some((r, i) => i !== rowIdx && r.ip === value && value);
              if (isDuplicate) {
                row.errors.ip = 'Duplicate IP address in another row';
              } else {
                delete row.errors.ip;
              }
            } else {
              delete row.errors[field];
            }
          }
        }
        // Validation for subnet
        if (field === 'subnet') {
          if (!subnetRegex.test(value)) {
            row.errors[field] = 'Invalid subnet format';
          } else {
            delete row.errors[field];
          }
        }
        // Validation for interface (bonding: max 2)
        if (field === 'interface') {
          if (f.useBond && Array.isArray(value) && value.length > 2) {
            value = value.slice(0, 2);
          }
          row.interface = value;
        }
        // Validation for bondName uniqueness
        if (field === 'bondName') {
          const isDuplicate = updated.some((r, i) => i !== rowIdx && r.bondName === value);
          if (isDuplicate) {
            row.errors[field] = 'Bond name must be unique';
          } else {
            delete row.errors[field];
          }
        }
        // Validation for VLAN ID
        if (field === 'vlanId') {
          if (value && !/^(409[0-4]|40[0-8][0-9]|[1-3][0-9]{3}|[1-9][0-9]{1,2}|[1-9])$/.test(value)) {
            row.errors[field] = 'VLAN ID must be 1-4094';
          } else {
            // Always clear the error when the field is empty or valid
            delete row.errors[field];
          }
        }
        // MTU field doesn't need validation as it's a dropdown
      }
      updated[rowIdx] = row;
      return { ...f, tableData: updated };
    }));
  };


  const getColumns = (form, nodeIdx) => {
    const baseColumns = [
      {
        title: 'SL.NO',
        key: 'slno',
        render: (_, __, index) => <span>{index + 1}</span>,
      },
    ];
    const bondColumn = {
      title: 'Bond Name',
      dataIndex: 'bondName',
      render: (_, record, rowIdx) => (
        <Form.Item
          validateStatus={record.errors?.bondName ? 'error' : ''}
          help={record.errors?.bondName}
          style={{ marginBottom: 0 }}
        >
          <Input
            value={record.bondName ?? ''}
            placeholder="Enter Bond Name"
            onChange={e => handleCellChange(nodeIdx, rowIdx, 'bondName', e.target.value)}
            disabled={cardStatus[nodeIdx]?.loading || cardStatus[nodeIdx]?.applied}
          />
        </Form.Item>
      ),
    };

    const vlanColumn = {
      title: 'VLAN ID',
      dataIndex: 'vlanId',
      render: (_, record, rowIdx) => (
        <Tooltip placement='right' title="VLAN ID (1-4094, optional)">
          <Form.Item
            validateStatus={record.errors?.vlanId ? 'error' : ''}
            help={record.errors?.vlanId}
            style={{ marginBottom: 0 }}
          >
            <Input
              value={record.vlanId ?? ''}
              placeholder="Enter VLAN ID (optional)"
              onChange={e => handleCellChange(nodeIdx, rowIdx, 'vlanId', e.target.value)}
              disabled={cardStatus[nodeIdx]?.loading || cardStatus[nodeIdx]?.applied}
            />
          </Form.Item>
        </Tooltip>
      ),
    };

    const mtuColumn = {
      title: 'MTU',
      dataIndex: 'mtu',
      render: (_, record, rowIdx) => (
        <Tooltip placement='right' title="MTU (optional)">
          <Form.Item
            style={{ marginBottom: 0 }}
          >
            <Select
              value={record.mtu || undefined}
              placeholder="Select MTU (optional)"
              onChange={value => handleCellChange(nodeIdx, rowIdx, 'mtu', value)}
              disabled={cardStatus[nodeIdx]?.loading || cardStatus[nodeIdx]?.applied}
              allowClear
              style={{ width: '100%' }}
            >
              <Option value="1500">1500</Option>
              <Option value="9000">9000</Option>
            </Select>
          </Form.Item>
        </Tooltip>
      ),
    };

    const mainColumns = [
      {
        title: 'Interfaces Required',
        dataIndex: 'interface',
        render: (_, record, rowIdx) => {
          const selectedInterfaces = form.tableData
            .filter((_, i) => i !== rowIdx)
            .flatMap(row => {
              if (form.useBond && Array.isArray(row.interface)) return row.interface;
              if (!form.useBond && row.interface) return [row.interface];
              return [];
            });
          const currentSelection = form.useBond
            ? Array.isArray(record.interface) ? record.interface : []
            : record.interface ? [record.interface] : [];
          const availableInterfaces = (nodeInterfaces[form.ip] || []).filter(
            (iface) =>
              !selectedInterfaces.includes(iface.iface) || currentSelection.includes(iface.iface)
          ) || [];
          return (
            <Select
              mode={form.useBond ? 'multiple' : undefined}
              style={{ width: '100%' }}
              value={record.interface || undefined}
              allowClear
              placeholder="Select interface"
              onChange={(value) => {
                if (form.useBond && Array.isArray(value) && value.length > 2) {
                  value = value.slice(0, 2);
                }
                handleCellChange(nodeIdx, rowIdx, 'interface', value);
              }}
              maxTagCount={2}
              disabled={cardStatus[nodeIdx]?.loading || cardStatus[nodeIdx]?.applied}
            >
              {availableInterfaces.map((ifaceObj) => (
                <Option key={ifaceObj.iface} value={ifaceObj.iface}>
                  {ifaceObj.iface}
                </Option>
              ))}
            </Select>
          );
        },
      },
      {
        title: 'Type',
        dataIndex: 'type',
        render: (_, record, rowIdx) => {
          // Get all types that are already selected on other interfaces
          const getAvailableTypes = () => {
            if (form.configType !== 'segregated') {
              // For default mode, get selected primary/secondary types
              const selectedTypes = new Set();
              form.tableData.forEach((row, i) => {
                if (i !== rowIdx && row.type) {
                  selectedTypes.add(row.type);
                }
              });
              return selectedTypes;
            }

            // Get all types already selected in other rows
            const selectedTypes = new Set();
            form.tableData.forEach((row, i) => {
              if (i !== rowIdx && Array.isArray(row.type)) {
                row.type.forEach(t => selectedTypes.add(t));
              }
            });

            return selectedTypes;
          };

          const selectedTypes = getAvailableTypes();

          let MgmtTaken = false;
          let externalTaken = false;

          if (form.configType === 'segregated') {
            MgmtTaken = selectedTypes?.has('Mgmt') && !(Array.isArray(record.type) && record.type.includes('Mgmt'));
            externalTaken = selectedTypes?.has('External_Traffic') && !(Array.isArray(record.type) && record.type.includes('External_Traffic'));
          }
          const currentTypes = Array.isArray(record.type) ? record.type : [];

          // const hasExt = Array.isArray(record.type) && record.type.includes('External_Traffic');
          return (
            <Select
              mode={form.configType === 'segregated' ? "multiple" : undefined} // Only use multiple mode in segregated mode
              allowClear
              style={{ width: '100%' }}
              value={record.type || undefined}
              placeholder="Select type"
              onChange={value => handleCellChange(nodeIdx, rowIdx, 'type', value)}
              disabled={cardStatus[nodeIdx]?.loading || cardStatus[nodeIdx]?.applied}
              maxTagCount={1}
            >
              {form.configType === 'segregated' ? (
                <>
                  {/* Show Mgmt option only if not selected elsewhere or currently selected here */}
                  {(!selectedTypes.has('Mgmt') || currentTypes.includes('Mgmt')) && (
                    <Option value="Mgmt">
                      <Tooltip placement="right" title="Management">
                        Mgmt
                      </Tooltip>
                    </Option>
                  )}

                  {/* Show VXLAN option only if not selected elsewhere or currently selected here */}
                  {(!selectedTypes.has('VXLAN') || currentTypes.includes('VXLAN')) && (
                    <Option value="VXLAN">
                      <Tooltip placement="right" title="VXLAN">
                        VXLAN
                      </Tooltip>
                    </Option>
                  )}

                  {/* Show Storage option only if not selected elsewhere or currently selected here */}
                  {(!selectedTypes.has('Storage') || currentTypes.includes('Storage')) && (
                    <Option value="Storage">
                      <Tooltip placement="right" title="Storage">
                        Storage
                      </Tooltip>
                    </Option>
                  )}

                  {/* Show External_Traffic option only if not selected elsewhere or currently selected here */}
                  {(!selectedTypes.has('External_Traffic') || currentTypes.includes('External_Traffic')) && (
                    <Option value="External_Traffic">
                      <Tooltip placement="right" title="External_Traffic">
                        External_Traffic
                      </Tooltip>
                    </Option>
                  )}
                </>
              ) : (
                // Default mode - implement mutual exclusivity for primary/secondary
                <>
                  {selectedTypes.has('primary') && record.type !== 'primary' ? null : (
                    <Option value="primary">
                      <Tooltip placement="right" title="Primary">
                        Primary
                      </Tooltip>
                    </Option>
                  )}
                  {selectedTypes.has('secondary') && record.type !== 'secondary' ? null : (
                    <Option value="secondary">
                      <Tooltip placement="right" title="Secondary">
                        Secondary
                      </Tooltip>
                    </Option>
                  )}
                </>
              )}
            </Select>
          );
        },
      },
      {
        title: 'IP ADDRESS',
        dataIndex: 'ip',
        render: (_, record, rowIdx) => (
          <Form.Item
            validateStatus={record.errors?.ip ? 'error' : ''}
            help={record.errors?.ip}
            style={{ marginBottom: 0 }}
          >
            <Input
              value={record.ip}
              placeholder="Enter IP Address"
              onChange={e => handleCellChange(nodeIdx, rowIdx, 'ip', e.target.value)}
              disabled={(cardStatus[nodeIdx]?.loading || cardStatus[nodeIdx]?.applied) || (form.configType === 'default' && record.type === 'secondary') || (form.configType === 'segregated' && Array.isArray(record.type) && record.type.includes('External_Traffic'))}
            />
          </Form.Item>
        ),
      },
      {
        title: 'SUBNET MASK',
        dataIndex: 'subnet',
        render: (_, record, rowIdx) => (
          <Form.Item
            validateStatus={record.errors?.subnet ? 'error' : ''}
            help={record.errors?.subnet}
            style={{ marginBottom: 0 }}
          >
            <Input
              value={record.subnet}
              placeholder="Enter Subnet"
              onChange={e => handleCellChange(nodeIdx, rowIdx, 'subnet', e.target.value)}
              disabled={(cardStatus[nodeIdx]?.loading || cardStatus[nodeIdx]?.applied) || (form.configType === 'default' && record.type === 'secondary') || (form.configType === 'segregated' && Array.isArray(record.type) && record.type.includes('External_Traffic'))}
            />
          </Form.Item>
        ),
      },
      {
        title: 'DNS Servers',
        dataIndex: 'dns',
        render: (_, record, rowIdx) => (
          <Form.Item
            validateStatus={record.errors?.dns ? 'error' : ''}
            help={record.errors?.dns}
            style={{ marginBottom: 0 }}
          >
            <Input
              value={record.dns}
              placeholder="Enter Nameserver"
              onChange={e => handleCellChange(nodeIdx, rowIdx, 'dns', e.target.value)}
              disabled={(cardStatus[nodeIdx]?.loading || cardStatus[nodeIdx]?.applied) || (form.configType === 'default' && record.type === 'secondary') || (form.configType === 'segregated' && Array.isArray(record.type) && record.type.includes('External_Traffic'))}
            />
          </Form.Item>
        ),
      },
    ];
    return [
      ...baseColumns,
      ...(form.useBond ? [bondColumn] : []),
      ...mainColumns,
      ...[vlanColumn],
      ...[mtuColumn],
    ];
  };

  const handleSubmit = async (nodeIdx) => {
    if (cardStatus[nodeIdx].loading || cardStatus[nodeIdx].applied) return;
    // Validate all rows for this node
    const form = forms[nodeIdx];

    // Enforce only one of each type in segregated mode
    if (form.configType === 'segregated') {
      const typeOccurrences = {};

      // Count occurrences of each type across all rows
      form.tableData.forEach(row => {
        if (Array.isArray(row.type)) {
          row.type.forEach(type => {
            typeOccurrences[type] = (typeOccurrences[type] || 0) + 1;
          });
        }
      });

      // Check for duplicate types
      const duplicateTypes = Object.entries(typeOccurrences)
        .filter(([type, count]) => count > 1)
        .map(([type]) => type);

      if (duplicateTypes.length > 0) {
        message.error(`Each type can only be selected once across all interfaces. Duplicate types: ${duplicateTypes.join(', ')}`);
        return;
      }
    }

    // Enforce only one External_Traffic in segregated mode
    if (form.configType === 'segregated') {
      const extCount = form.tableData.reduce((acc, r) => acc + (Array.isArray(r.type) && r.type.includes('External_Traffic') ? 1 : 0), 0);
      if (extCount > 1) {
        message.error('Only one interface can be set to External_Traffic per node.');
        return;
      }
    }
    // Enforce only one Mgmt in segregated mode
    if (form.configType === 'segregated') {
      const mgmtCount = form.tableData.reduce((acc, r) => acc + (Array.isArray(r.type) && r.type.includes('Mgmt') ? 1 : 0), 0);
      if (mgmtCount > 1) {
        message.error('Only one interface can be set to Mgmt per node.');
        return;
      }
    }
    for (let i = 0; i < form.tableData.length; i++) {
      const row = form.tableData[i];
      if (form.useBond && !row.bondName?.trim()) {
        message.error(`Row ${i + 1}: Please enter a Bond Name.`);
        return;
      }
      if (!row.type || (Array.isArray(row.type) && row.type.length === 0)) {
        message.error(`Row ${i + 1}: Please select a Type.`);
        return;
      }
      const isExternal = form.configType === 'segregated' && Array.isArray(row.type) && row.type.includes('External_Traffic');
      // Validate required fields (skip for secondary in default mode and External_Traffic in segregated)
      if (!(form.configType === 'default' && ((Array.isArray(row.type) && row.type.includes('secondary')) || row.type === 'secondary')) && !isExternal) {
        for (const field of ['ip', 'subnet', 'dns']) {
          if (!row[field]) {
            message.error(`Row ${i + 1}: Please enter ${field.toUpperCase()}.`);
            return;
          }
        }
      }
      // Ignore IP/Subnet/DNS errors for External_Traffic rows
      const filteredErrors = { ...(row.errors || {}) };
      if (isExternal) {
        delete filteredErrors.ip;
        delete filteredErrors.subnet;
        delete filteredErrors.dns;
      }
      // VLAN ID validation should not block Apply Change operation
      delete filteredErrors.vlanId;
      if (Object.keys(filteredErrors).length > 0) {
        message.error(`Row ${i + 1} contains invalid entries. Please fix them.`);
        return;
      }
    }
    // Validate default gateway
    if (!form.defaultGateway) {
      setForms(prev => prev.map((f, i) => i === nodeIdx ? { ...f, defaultGatewayError: 'Required' } : f));
      message.error('Please enter Default Gateway.');
      return;
    }
    if (!ipRegex.test(form.defaultGateway)) {
      setForms(prev => prev.map((f, i) => i === nodeIdx ? { ...f, defaultGatewayError: 'Invalid IP' } : f));
      message.error('Default Gateway must be a valid IP address.');
      return;
    }
    // Validate roles first
    if (!form.selectedRoles || form.selectedRoles.length === 0) {
      setForms(prev => prev.map((f, i) => i === nodeIdx ? { ...f, roleError: 'At least one role required' } : f));
      message.error('Please select at least one role.');
      return;
    } else {
      setForms(prev => prev.map((f, i) => i === nodeIdx ? { ...f, roleError: '' } : f));
    }
    // Validate disks only if 'Storage' role is selected
    const requiresDisks = Array.isArray(form.selectedRoles) && form.selectedRoles.includes('Storage');
    if (requiresDisks) {
      if (!form.selectedDisks || form.selectedDisks.length === 0) {
        setForms(prev => prev.map((f, i) => i === nodeIdx ? { ...f, diskError: 'At least one disk required' } : f));
        message.error('Please select at least one disk.');
        return;
      } else {
        setForms(prev => prev.map((f, i) => i === nodeIdx ? { ...f, diskError: '' } : f));
      }
    } else {
      // Not required; clear any stale disk error
      setForms(prev => prev.map((f, i) => i === nodeIdx ? { ...f, diskError: '' } : f));
    }
    // Submit logic here (API call or sessionStorage)
    // Immediately disable fields/table by setting loading=true; show button loader too
    setBtnLoading(prev => {
      const next = [...prev];
      next[nodeIdx] = true;
      return next;
    });
    setCardStatus(prev => prev.map((s, i) => i === nodeIdx ? { ...s, loading: true } : s));
    // Persist loader state immediately by IP to survive navigation
    setCardStatusForIpInSession(form.ip, { loading: true, applied: false });
    // Determine how many servers are already deployed to compute hostname starting index
    let deployedCount = 0;
    try {
      const loginDetails = JSON.parse(sessionStorage.getItem('loginDetails'));
      const user_id_param = loginDetails?.data?.id || '';
      const cloudnameParam = firstCloudName || sessionStorage.getItem('cloud_first_cloudname') || '';
      const qs = new URLSearchParams({ cloudname: cloudnameParam, ...(user_id_param ? { user_id: user_id_param } : {}) }).toString();
      const ipsRes = await fetch(`https://${hostIP}:5000/api/deployed-server-ips?${qs}`);
      const ipsData = await ipsRes.json().catch(() => ({}));
      if (ipsRes.ok && Array.isArray(ipsData.ips)) {
        deployedCount = ipsData.ips.length;
      }
    } catch (_) { }

    const existingMap = getCloudHostnameMap();
    const used = new Set(Object.values(existingMap || {}));
    const preferred = deployedCount + nodeIdx + 1;
    // Use existing hostname from form if available, otherwise generate a new one
    const assigned = form.hostname || existingMap[form.ip] || nextAvailableHostname(used, preferred);
    if (!existingMap[form.ip]) {
      existingMap[form.ip] = assigned;
      saveCloudHostnameMap(existingMap);
    }

    const payloadBase = buildNetworkConfigPayload({ ...form, hostname: assigned });
    const payload = {
      ...payloadBase,
      hostname: assigned,
      license_code: form.licenseCode || null,
      license_type: form.licenseType || null,
      license_period: form.licensePeriod || null,
    };
    fetch(`https://${form.ip}:2020/submit-network-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(res => res.json())
      .then(result => {
        if (result.success) {
          // Keep fields disabled (loading stays true); stop button spinner and proceed to polling
          setBtnLoading(prev => {
            const next = [...prev];
            next[nodeIdx] = false;
            return next;
          });
          // Store restartEndTime and bootEndTime in sessionStorage
          const restartEndTimesRaw = sessionStorage.getItem(RESTART_ENDTIME_KEY);
          const bootEndTimesRaw = sessionStorage.getItem(BOOT_ENDTIME_KEY);
          const restartEndTimes = restartEndTimesRaw ? JSON.parse(restartEndTimesRaw) : {};
          const bootEndTimes = bootEndTimesRaw ? JSON.parse(bootEndTimesRaw) : {};
          const now = Date.now();
          const restartEnd = now + RESTART_DURATION;
          const bootEnd = restartEnd + BOOT_DURATION;
          restartEndTimes[nodeIdx] = restartEnd;
          bootEndTimes[nodeIdx] = bootEnd;
          sessionStorage.setItem(RESTART_ENDTIME_KEY, JSON.stringify(restartEndTimes));
          sessionStorage.setItem(BOOT_ENDTIME_KEY, JSON.stringify(bootEndTimes));

          // --- SSH Polling Section ---
          // Determine the correct IP to use for SSH polling based on config type
          let ssh_target_ip;
          if (form.configType === 'default') {
            // For default config, use primary type interface IP
            const primaryRow = form.tableData?.find(row => row.type === 'primary');
            ssh_target_ip = primaryRow?.ip || form.ip; // fallback to main IP if primary not found
          } else if (form.configType === 'segregated') {
            // For segregated config, use Mgmt type interface IP
            const MgmtRow = form.tableData?.find(row =>
              Array.isArray(row.type) ? row.type.includes('Mgmt') : row.type === 'Mgmt'
            );
            ssh_target_ip = MgmtRow?.ip || form.ip; // fallback to main IP if Mgmt not found
          } else {
            // Fallback to main node IP for any other config type
            ssh_target_ip = form.ip;
          }

          // Gather all required info for the polling API
          const node_ip = ssh_target_ip; // Use the determined target IP for SSH
          const ssh_user = 'pinakasupport';
          const ssh_pass = ''; // Do not use password authentication
          const ssh_key = ''; // Leave empty to use server-side .pem file (ps_key.pem)

          // Note: Backend will use the .pem file on disk (e.g., flask-back/ps_key.pem). No passwords are used.

          // Clear any existing polling timers for this IP before starting new ones
          if (window.__cloudPolling && window.__cloudPolling[node_ip]) {
            clearInterval(window.__cloudPolling[node_ip]);
            delete window.__cloudPolling[node_ip];
          }
          if (window.__cloudPollingStart && window.__cloudPollingStart[node_ip]) {
            clearTimeout(window.__cloudPollingStart[node_ip]);
            delete window.__cloudPollingStart[node_ip];
          }

          // Start the polling by POSTing the IP to backend
          fetch(`https://${hostIP}:2020/poll-ssh-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ips: [node_ip], ssh_user, ssh_pass, ssh_key })
          }).then(res => res.json()).then(data => {
            if (data.success) {
              message.info(`SSH polling scheduled for ${node_ip}. Will begin after 90 seconds.`);
            }
          }).then(() => {
            // Persist delay start timestamp and schedule delayed start (to match backend delay)
            setDelayStartForIp(node_ip, Date.now());

            const beginInterval = () => {
              let pollCount = 0;
              const pollInterval = setInterval(() => {
                pollCount++;
                // Stop polling if we've exceeded the maximum attempts
                if (pollCount > POLL_MAX_POLLS) {
                  clearInterval(pollInterval);
                  // Ensure we clear any existing polling before updating state
                  if (window.__cloudPolling[node_ip]) {
                    clearInterval(window.__cloudPolling[node_ip]);
                    delete window.__cloudPolling[node_ip];
                  }
                  setCardStatusForIpInSession(form.ip, { loading: false, applied: false });
                  if (window.__cloudMountedNetworkApply) {
                    setCardStatus(prev => prev.map((s, i) => i === nodeIdx ? { loading: false, applied: false } : s));
                  }
                  notifySshTimeout(node_ip);
                  message.error(`SSH polling timeout for ${node_ip}. Please check the node manually.`);
                  if (window.__cloudPolling) delete window.__cloudPolling[node_ip];
                  setDelayStartForIp(node_ip, null);
                  return;
                }

                fetchWithRetry(`https://${hostIP}:2020/check-ssh-status?ip=${encodeURIComponent(node_ip)}`)
                  .then(res => res.json())
                  .then(data => {
                    // Validate response to ensure data integrity
                    let validatedData;
                    try {
                      validatedData = validateSSHResponse(data, node_ip);
                    } catch (validationError) {
                      console.warn(`SSH response validation failed for ${node_ip}:`, validationError.message);
                      // Continue with unvalidated data but log the issue
                      validatedData = { ...data, validated: false };
                    }

                    if (validatedData.status === 'success' && validatedData.ip === node_ip) {
                      // Ensure we clear any existing polling before updating state
                      if (window.__cloudPolling[node_ip]) {
                        clearInterval(window.__cloudPolling[node_ip]);
                        delete window.__cloudPolling[node_ip];
                      }

                      // Persist status to sessionStorage so it reflects on remount or in other menus
                      setCardStatusForIpInSession(form.ip, { loading: false, applied: true });
                      if (window.__cloudMountedNetworkApply) {
                        setCardStatus(prev => prev.map((s, i) => i === nodeIdx ? { loading: false, applied: true } : s));
                      }
                      message.success(`Node ${validatedData.ip} is back online!`);
                      notifySshSuccess(node_ip);

                      // Clear any existing polling timers for this IP
                      if (window.__cloudPolling) delete window.__cloudPolling[node_ip];
                      if (window.__cloudPollingStart && window.__cloudPollingStart[node_ip]) {
                        delete window.__cloudPollingStart[node_ip];
                      }
                      setDelayStartForIp(node_ip, null);

                      // Store the form data for this node in sessionStorage
                      const nodeIp = form.ip || `node${nodeIdx + 1}`;
                      storeFormData(nodeIp, form);

                      // Note: After network changes are applied, the node IPs may have changed.
                      // Automatic data fetching is disabled. Use "Refetch Data" button if needed.
                    } else if (data.status === 'fail' && data.ip === node_ip) {
                      infoRestartThrottled(node_ip);
                    }
                  })
                  .catch(err => {
                    console.error('SSH status check failed:', err);
                    message.error(`SSH polling failed: ${err.message}. ${SSH_CONFIG.MESSAGES.RESPONSE_LOST}`);
                    // On persistent network errors, ensure we don't get stuck in loading state
                    if (pollCount > POLL_MAX_POLLS / 2) { // After half the attempts failed
                      // Ensure we clear any existing polling before updating state
                      if (window.__cloudPolling[node_ip]) {
                        clearInterval(window.__cloudPolling[node_ip]);
                        delete window.__cloudPolling[node_ip];
                      }
                      setCardStatusForIpInSession(form.ip, { loading: false, applied: false });
                      if (window.__cloudMountedNetworkApply) {
                        setCardStatus(prev => prev.map((s, i) => i === nodeIdx ? { loading: false, applied: false } : s));
                      }
                      if (window.__cloudPolling) delete window.__cloudPolling[node_ip];
                      setDelayStartForIp(node_ip, null);
                      message.error(`SSH polling failed due to network errors for ${node_ip}. Please check connectivity.`);
                    }
                  });
              }, POLL_INTERVAL_MS);

              // Store the interval reference globally (do not clear on unmount to allow background polling)
              if (!window.__cloudPolling) window.__cloudPolling = {};
              window.__cloudPolling[node_ip] = pollInterval;
            };

            const startPollingTimeout = setTimeout(() => {
              beginInterval();
              if (window.__cloudPollingStart && window.__cloudPollingStart[node_ip]) {
                delete window.__cloudPollingStart[node_ip];
              }
            }, POLL_DELAY_MS);

            if (!window.__cloudPollingStart) window.__cloudPollingStart = {};
            window.__cloudPollingStart[node_ip] = startPollingTimeout;
          }).catch(err => {
            console.error('SSH polling setup failed:', err);
            // If polling setup fails, ensure loader is turned off
            setCardStatusForIpInSession(form.ip, { loading: false, applied: false });
            if (window.__cloudMountedNetworkApply) {
              setCardStatus(prev => prev.map((s, i) => i === nodeIdx ? { loading: false, applied: false } : s));
            }
            message.error(`Failed to start SSH polling for ${node_ip}: ${err.message}. Please check network connectivity.`);

            // Clear any existing polling timers for this IP
            if (window.__cloudPolling && window.__cloudPolling[node_ip]) {
              clearInterval(window.__cloudPolling[node_ip]);
              delete window.__cloudPolling[node_ip];
            }
            if (window.__cloudPollingStart && window.__cloudPollingStart[node_ip]) {
              clearTimeout(window.__cloudPollingStart[node_ip]);
              delete window.__cloudPollingStart[node_ip];
            }
          });
          // --- End SSH Polling Section ---


          timerRefs.current[nodeIdx] = setTimeout(() => {
            // message.success(`Network config for node ${form.ip} applied! Node restarting...`);
          }, RESTART_DURATION);
        } else {
          // Validation failed on backend, stop button loader for user to correct
          setBtnLoading(prev => {
            const next = [...prev];
            next[nodeIdx] = false;
            return next;
          });
          // Re-enable fields/table
          setCardStatus(prev => prev.map((s, i) => i === nodeIdx ? { ...s, loading: false, applied: false } : s));
          setCardStatusForIpInSession(form.ip, { loading: false, applied: false });
          message.error(result.message || 'Failed to apply network configuration.');
        }
      })
      .catch(err => {
        // Network error during validation, stop button loader
        setBtnLoading(prev => {
          const next = [...prev];
          next[nodeIdx] = false;
          return next;
        });
        // Re-enable fields/table on error
        setCardStatus(prev => prev.map((s, i) => i === nodeIdx ? { ...s, loading: false, applied: false } : s));
        setCardStatusForIpInSession(form.ip, { loading: false, applied: false });
        message.error('Network error: ' + err.message);
      });
    return;

  };

  // Clean up only internal timers on unmount; keep global polling running in background
  useEffect(() => {
    return () => {
      timerRefs.current.forEach(t => t && clearTimeout(t));
      // Do not clear window.__cloudPolling or __cloudPollingStart here, to allow background progress
    };
  }, []);

  // Remove Node handlers with confirmation and Undo
  const handleUndoRemoveNode = () => {
    const payload = lastRemovedRef.current;
    if (!payload) return;
    const { idx, ip, form, status, licenseNode, networkApplyResultEntry, hostname, laEntry, laIndex, delayTs, hostnameMapSnapshot } = payload;

    // Safety: clear any global timers and existing SSH notifications for this IP before restoring
    try {
      if (window.__cloudPolling && window.__cloudPolling[ip]) {
        clearInterval(window.__cloudPolling[ip]);
        delete window.__cloudPolling[ip];
      }
      if (window.__cloudPollingStart && window.__cloudPollingStart[ip]) {
        clearTimeout(window.__cloudPollingStart[ip]);
        delete window.__cloudPollingStart[ip];
      }
    } catch (_) { }
    try { notification.close(`cloud-ssh-${ip}`); } catch (_) { }
    // Restore delay start timestamp so polling can recover if it was in progress
    if (delayTs) {
      try { setDelayStartForIp(ip, delayTs); } catch (_) { }
    }

    // Restore forms, statuses, btn loading
    setForms(prev => {
      const next = [...prev];
      next.splice(Math.min(Math.max(idx, 0), next.length), 0, form);
      sessionStorage.setItem('cloud_networkApplyForms', JSON.stringify(next));
      return next;
    });
    setCardStatus(prev => {
      const next = [...prev];
      next.splice(Math.min(Math.max(idx, 0), next.length), 0, status || { loading: false, applied: false });
      sessionStorage.setItem('cloud_networkApplyCardStatus', JSON.stringify(next));
      return next;
    });
    setBtnLoading(prev => {
      const next = [...prev];
      next.splice(Math.min(Math.max(idx, 0), next.length), 0, false);
      return next;
    });

    // Restore licenseNodes and persist
    setLicenseNodes(prev => {
      const arr = [...prev];
      if (!arr.some(n => n.ip === ip)) {
        const insertIdx = Math.min(Math.max(idx, 0), arr.length);
        arr.splice(insertIdx, 0, licenseNode || { ip });
      }
      try { sessionStorage.setItem('cloud_licenseNodes', JSON.stringify(arr)); } catch (_) { }
      return arr;
    });

    // Restore networkApplyResult mapping
    try {
      const resRaw = sessionStorage.getItem('cloud_networkApplyResult');
      const map = resRaw ? JSON.parse(resRaw) : {};
      if (networkApplyResultEntry) map[ip] = networkApplyResultEntry;
      sessionStorage.setItem('cloud_networkApplyResult', JSON.stringify(map));
    } catch (_) { }

    // Restore hostname map - revert to the snapshot taken before removal
    try {
      if (hostnameMapSnapshot) {
        sessionStorage.setItem(CLOUD_HOSTNAME_MAP_KEY, JSON.stringify(hostnameMapSnapshot));
        // Also update the forms with the original hostnames
        setForms(prevForms => {
          const updatedForms = [...prevForms];
          Object.entries(hostnameMapSnapshot).forEach(([nodeIp, hostname]) => {
            const formIndex = updatedForms.findIndex(f => f.ip === nodeIp);
            if (formIndex !== -1) {
              updatedForms[formIndex] = { ...updatedForms[formIndex], hostname };
            }
          });
          sessionStorage.setItem('cloud_networkApplyForms', JSON.stringify(updatedForms));
          return updatedForms;
        });
      } else {
        const hmRaw = sessionStorage.getItem('cloud_hostnameMap');
        const hm = hmRaw ? JSON.parse(hmRaw) : {};
        if (hostname) hm[ip] = hostname;
        sessionStorage.setItem('cloud_hostnameMap', JSON.stringify(hm));
      }
    } catch (_) { }

    // Restore licenseActivationResults entry
    try {
      const laRaw = sessionStorage.getItem('cloud_licenseActivationResults');
      const arr = laRaw ? JSON.parse(laRaw) : [];
      if (laEntry) {
        const exists = Array.isArray(arr) && arr.some(r => r?.ip === ip);
        if (!exists) {
          const out = Array.isArray(arr) ? [...arr] : [];
          const insertAt = Number.isInteger(laIndex) ? Math.min(Math.max(laIndex, 0), out.length) : out.length;
          out.splice(insertAt, 0, laEntry);
          sessionStorage.setItem('cloud_licenseActivationResults', JSON.stringify(out));
        }
      }
    } catch (_) { }

    // Reindex timer end times (leave as-is; no timers needed on undo)
    // Notify parent to restore across tabs
    if (typeof onUndoRemoveNode === 'function') {
      try { onUndoRemoveNode(ip, licenseNode, idx); } catch (_) { }
    }
    message.success(`Restored node ${ip}`);
    lastRemovedRef.current = null;
  };

  const handleRemoveNode = (idx) => {
    const form = forms[idx];
    const ip = form?.ip;
    if (!ip) return;
    if (cardStatus[idx]?.loading || cardStatus[idx]?.applied) return;

    Modal.confirm({
      title: 'Remove Node',
      content: `Are you sure you want to remove node ${ip}? You can undo this action.`,
      okText: 'Remove',
      okType: 'danger',
      okButtonProps: { danger: true, size: 'small', style: { width: 90 } },
      cancelText: 'Cancel',
      cancelButtonProps: { size: 'small', style: { width: 90 } },
      onOk: () => {
        // Backup data for Undo
        const licenseNode = (licenseNodes || []).find(n => n.ip === ip) || { ip };
        let networkApplyResultEntry = null;
        try {
          const resRaw = sessionStorage.getItem('cloud_networkApplyResult');
          const map = resRaw ? JSON.parse(resRaw) : {};
          networkApplyResultEntry = map[ip] || null;
        } catch (_) { }
        let hostname = null;
        try {
          const hmRaw = sessionStorage.getItem('cloud_hostnameMap');
          const hm = hmRaw ? JSON.parse(hmRaw) : {};
          hostname = hm[ip] || null;
        } catch (_) { }
        let laEntry = null;
        let laIndex = -1;
        try {
          const laRaw = sessionStorage.getItem('cloud_licenseActivationResults');
          const arr = laRaw ? JSON.parse(laRaw) : [];
          if (Array.isArray(arr)) {
            laIndex = arr.findIndex(r => r?.ip === ip);
            laEntry = laIndex >= 0 ? arr[laIndex] : null;
          }
        } catch (_) { }
        // Snapshot delay-start timestamp for SSH polling so Undo can restore it
        let delayTs = null;
        try {
          const dmap = getDelayStartMap();
          delayTs = dmap[ip] || null;
        } catch (_) { }

        // Take a snapshot of the current hostname map for undo functionality
        let hostnameMapSnapshot = null;
        try {
          const hmRaw = sessionStorage.getItem(CLOUD_HOSTNAME_MAP_KEY);
          hostnameMapSnapshot = hmRaw ? JSON.parse(hmRaw) : {};
        } catch (_) { }

        lastRemovedRef.current = {
          idx,
          ip,
          form: { ...form },
          status: { ...cardStatus[idx] },
          licenseNode,
          networkApplyResultEntry,
          hostname,
          laEntry,
          laIndex,
          delayTs,
          hostnameMapSnapshot // Add the snapshot to the undo data
        };

        // Clear any global polling timers for this IP
        try {
          if (window.__cloudPolling && window.__cloudPolling[ip]) {
            clearInterval(window.__cloudPolling[ip]);
            delete window.__cloudPolling[ip];
          }
          if (window.__cloudPollingStart && window.__cloudPollingStart[ip]) {
            clearTimeout(window.__cloudPollingStart[ip]);
            delete window.__cloudPollingStart[ip];
          }
        } catch (_) { }
        // Clear persisted delay start and any SSH notifications/throttle entries for this IP
        try { setDelayStartForIp(ip, null); } catch (_) { }
        try { notification.close(`cloud-ssh-${ip}`); } catch (_) { }
        try {
          if (window.__cloudRestartInfoTs && window.__cloudRestartInfoTs[ip]) {
            delete window.__cloudRestartInfoTs[ip];
          }
        } catch (_) { }

        // Remove from forms and statuses and persist
        const nextForms = forms.filter((_, i) => i !== idx);
        const nextStatus = cardStatus.filter((_, i) => i !== idx);
        const nextBtnLoading = btnLoading.filter((_, i) => i !== idx);
        setForms(nextForms);
        setCardStatus(nextStatus);
        setBtnLoading(nextBtnLoading);
        try {
          sessionStorage.setItem('cloud_networkApplyForms', JSON.stringify(nextForms));
          sessionStorage.setItem('cloud_networkApplyCardStatus', JSON.stringify(nextStatus));
        } catch (_) { }

        // Reindex timer end time objects
        try {
          const rRaw = sessionStorage.getItem(RESTART_ENDTIME_KEY);
          const bRaw = sessionStorage.getItem(BOOT_ENDTIME_KEY);
          const r = rRaw ? JSON.parse(rRaw) : {};
          const b = bRaw ? JSON.parse(bRaw) : {};
          const newR = {};
          const newB = {};
          for (let newI = 0; newI < nextForms.length; newI++) {
            const oldI = newI < idx ? newI : newI + 1;
            if (r.hasOwnProperty(oldI)) newR[newI] = r[oldI];
            if (b.hasOwnProperty(oldI)) newB[newI] = b[oldI];
          }
          sessionStorage.setItem(RESTART_ENDTIME_KEY, JSON.stringify(newR));
          sessionStorage.setItem(BOOT_ENDTIME_KEY, JSON.stringify(newB));
        } catch (_) { }

        // Remove from licenseNodes and persist
        setLicenseNodes(prev => {
          const next = (prev || []).filter(n => n.ip !== ip);
          try { sessionStorage.setItem('cloud_licenseNodes', JSON.stringify(next)); } catch (_) { }
          return next;
        });

        // Remove from networkApplyResult map
        try {
          const resRaw = sessionStorage.getItem('cloud_networkApplyResult');
          const map = resRaw ? JSON.parse(resRaw) : {};
          if (map && map[ip]) {
            delete map[ip];
            sessionStorage.setItem('cloud_networkApplyResult', JSON.stringify(map));
          }
        } catch (_) { }

        // Remove from hostname map
        try {
          const hmRaw = sessionStorage.getItem('cloud_hostnameMap');
          const hm = hmRaw ? JSON.parse(hmRaw) : {};
          if (hm && hm[ip]) {
            delete hm[ip];
            sessionStorage.setItem('cloud_hostnameMap', JSON.stringify(hm));
          }
        } catch (_) { }

        // Optionally also remove from licenseActivationResults to keep tabs consistent
        try {
          const laRaw = sessionStorage.getItem('cloud_licenseActivationResults');
          const arr = laRaw ? JSON.parse(laRaw) : [];
          if (Array.isArray(arr)) {
            const next = arr.filter(r => r?.ip !== ip);
            sessionStorage.setItem('cloud_licenseActivationResults', JSON.stringify(next));
          }
        } catch (_) { }

        // Reassign hostnames sequentially after removal
        try {
          const hostnameMap = getCloudHostnameMap();
          const updatedHostnameMap = {};

          // Reassign hostnames starting from SQDN-001
          nextForms.forEach((form, newIndex) => {
            const newHostname = `SQDN-${String(newIndex + 1).padStart(3, '0')}`;
            updatedHostnameMap[form.ip] = newHostname;

            // Update the form with the new hostname
            setForms(prevForms => {
              const updatedForms = [...prevForms];
              const formIndex = updatedForms.findIndex(f => f.ip === form.ip);
              if (formIndex !== -1) {
                updatedForms[formIndex] = { ...updatedForms[formIndex], hostname: newHostname };
              }
              sessionStorage.setItem('cloud_networkApplyForms', JSON.stringify(updatedForms));
              return updatedForms;
            });
          });

          // Save the updated hostname map
          saveCloudHostnameMap(updatedHostnameMap);
        } catch (error) {
          console.error('Error reassigning hostnames:', error);
        }

        // Notify parent so previous tabs sync their state
        if (typeof onRemoveNode === 'function') {
          try { onRemoveNode(ip, licenseNode, idx); } catch (_) { }
        }

        notification.open({
          message: 'Node removed',
          description: `Removed node ${ip}.`,
          btn: (
            <Button type="link" onClick={handleUndoRemoveNode}>
              Undo
            </Button>
          ),
          duration: 4.5,
        });
      }
    });
  };

  // Check if all cards are applied
  const allApplied = cardStatus.length > 0 && cardStatus.every(s => s.applied);

  const handleNext = async () => {
    // Only allow if all cards are applied
    if (!allApplied) {
      message.warning('Please apply all nodes before deploying.');
      return;
    }
    if (deployLoading) return; // prevent double-clicks
    // Get all node configs from sessionStorage
    const configs = getNetworkApplyResult();
    if (Object.keys(configs).length === 0) {
      message.error('No node configuration found.');
      return;
    }

    // Per-node validation: if Storage role is selected, at least one disk must be chosen
    for (let i = 0; i < forms.length; i++) {
      const f = forms[i] || {};
      if (Array.isArray(f.selectedRoles) && f.selectedRoles.includes('Storage')) {
        if (!Array.isArray(f.selectedDisks) || f.selectedDisks.length === 0) {
          setForms(prev => prev.map((ff, idx) => idx === i ? { ...ff, diskError: 'At least one disk required' } : ff));
          // Enable both selectors so user can correct immediately even if card was applied
          if (f.ip) {
            setForceEnableDisks(prev => ({ ...prev, [f.ip]: true }));
            setForceEnableRoles(prev => ({ ...prev, [f.ip]: true }));
          }
          message.error(`Node ${f.ip || i + 1}: please select at least one disk for Storage role.`);
          return;
        }
      }
    }

    // We'll build transformedConfigs after we know how many nodes are already deployed

    // Pre-deployment check: ensure all nodes in this cloud are up
    setDeployLoading(true);
    // Track how many servers are already deployed to compute hostname offset
    let deployedCount = 0;
    try {
      const loginDetails = JSON.parse(sessionStorage.getItem('loginDetails'));
      const user_id_param = loginDetails?.data?.id || '';
      const cloudnameParam = firstCloudName || sessionStorage.getItem('cloud_first_cloudname') || '';
      const qs = new URLSearchParams({ cloudname: cloudnameParam, ...(user_id_param ? { user_id: user_id_param } : {}) }).toString();
      const ipsRes = await fetch(`https://${hostIP}:5000/api/deployed-server-ips?${qs}`);
      const ipsData = await ipsRes.json().catch(() => ({}));
      if (ipsRes.ok && Array.isArray(ipsData.ips) && ipsData.ips.length > 0) {
        deployedCount = ipsData.ips.length;
        const checks = await Promise.all(
          ipsData.ips.map(async (ip) => {
            try {
              const r = await fetch(`https://${hostIP}:2020/check-server-status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ server_ip: ip })
              });
              const j = await r.json().catch(() => ({}));
              return j && j.status === 'online';
            } catch (_) {
              return false;
            }
          })
        );
        const allUp = checks.every(Boolean);
        if (!allUp) {
          message.error('Some nodes in the Cloud are not up and running. Please turn them up.');
          setDeployLoading(false);
          return;
        }
      } else if (ipsRes.ok) {
        deployedCount = 0;
      }
    } catch (_) {
      // If check fails unexpectedly, fail safe by stopping here with message
      message.error('Pre-deployment check failed. Please try again.');
      setDeployLoading(false);
      return;
    }

    // All validations above passed: clear force-enable flags so selectors can re-disable on this Deploy
    setForceEnableRoles(prev => {
      const next = { ...prev };
      forms.forEach(f => { if (f?.ip) next[f.ip] = false; });
      return next;
    });
    setForceEnableDisks(prev => {
      const next = { ...prev };
      forms.forEach(f => { if (f?.ip) next[f.ip] = false; });
      return next;
    });

    // Transform configs for backend storage, now that we know deployedCount
    // Reuse hostnames assigned during Network Apply; allocate unique for any missing starting from deployedCount+1
    const savedHostnameMap = getCloudHostnameMap();
    const usedHostnames = new Set(Object.values(savedHostnameMap || {}));
    const hostnameMap = {};
    forms.forEach((f, idx) => {
      if (!f?.ip) return;
      const preferred = deployedCount + idx + 1;
      let hn = savedHostnameMap[f.ip];
      if (!hn) {
        hn = nextAvailableHostname(usedHostnames, preferred);
        usedHostnames.add(hn);
        savedHostnameMap[f.ip] = hn;
      }
      hostnameMap[f.ip] = hn;
    });
    // Persist any newly allocated hostnames
    saveCloudHostnameMap(savedHostnameMap);

    const transformedConfigs = {};
    Object.entries(configs).forEach(([ip, form]) => {
      transformedConfigs[ip] = buildDeployConfigPayload({
        ...form,
        hostname: hostnameMap[ip] || form?.hostname,
        // Ensure all required fields have default values
        configType: form?.configType || 'default',
        useBond: form?.useBond || false,
        tableData: form?.tableData || [],
        selectedDisks: form?.selectedDisks || [],
        selectedRoles: form?.selectedRoles || [],
        defaultGateway: form?.defaultGateway || ''
      });
    });

    // Send to backend for storage as JSON
    try {
      const response = await fetch(`https://${hostIP}:2020/store-deployment-configs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(transformedConfigs),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to store deployment configs');
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error('Failed to store deployment configs');
      }

      message.success('Deployment configurations stored successfully');
    } catch (error) {
      console.error('Error storing deployment configs:', error);
      message.error('Error storing deployment configurations: ' + error.message);
      setDeployLoading(false);
      return; // Stop further execution if backend storage fails
    }

    // Prepare POST data for /api/child-deployment-activity-log
    // Each node must have serverip, hostname, type, Mgmt, Storage, External_Traffic, VXLAN, license_code, license_type, license_period
    const nodes = Object.values(configs).map(form => ({
      serverip: form.configType === 'segregated' 
        ? form.tableData?.find(row => Array.isArray(row.type) ? row.type.includes('Mgmt') : row.type === 'Mgmt')?.ip || form.tableData?.find(row => Array.isArray(row.type) ? row.type.includes('VXLAN') : row.type === 'VXLAN')?.ip
        : form.tableData?.find(row => Array.isArray(row.type) ? row.type.includes('primary') : row.type === 'primary')?.ip || form.tableData?.find(row => Array.isArray(row.type) ? row.type.includes('Mgmt') : row.type === 'Mgmt')?.ip || form.tableData?.find(row => Array.isArray(row.type) ? row.type.includes('VXLAN') : row.type === 'VXLAN')?.ip || form.ip,
      hostname: hostnameMap[form.ip] || form?.hostname || '',
      type: form.configType,
      // Send all selected roles as a comma-separated string to store multiple roles in DB
      role: Array.isArray(form.selectedRoles) && form.selectedRoles.length > 0 ? form.selectedRoles.join(',') : 'child',
      Mgmt: form.tableData?.find(row => Array.isArray(row.type) ? row.type.includes('Mgmt') : row.type === 'Mgmt')?.ip || '',
      Storage: form.tableData?.find(row => Array.isArray(row.type) ? row.type.includes('Storage') : row.type === 'Storage')?.ip || '',
      External_Traffic: form.tableData?.find(row => Array.isArray(row.type) ? row.type.includes('External_Traffic') : row.type === 'External_Traffic')?.ip || '',
      VXLAN: form.tableData?.find(row => Array.isArray(row.type) ? row.type.includes('VXLAN') : row.type === 'VXLAN')?.ip || '',
      license_code: form.licenseCode || '',
      license_type: form.licenseType || '',
      license_period: form.licensePeriod || '',
      cloudname: firstCloudName || sessionStorage.getItem('cloud_first_cloudname') || '',
    }));

    // Get user info and cloudname
    const loginDetails = JSON.parse(sessionStorage.getItem('loginDetails'));
    const user_id = loginDetails?.data?.id || '';
    const username = loginDetails?.data?.companyName || '';
    const host_serverid = sessionStorage.getItem('host_server_id') || '';

    // POST to backend
    try {
      const res = await fetch(`https://${hostIP}:5000/api/child-deployment-activity-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes, user_id, username, host_serverid })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to start deployment log');
      }
      // Optionally store the returned serverids for later use
      try {
        const cloudname = firstCloudName || sessionStorage.getItem('cloud_first_cloudname') || '';
        const nodesWithCloud = Array.isArray(data.nodes)
          ? data.nodes.map(n => ({ ...n, cloudname }))
          : [];
        sessionStorage.setItem('cloud_lastDeploymentNodes', JSON.stringify(nodesWithCloud));
      } catch (_) {
        sessionStorage.setItem('cloud_lastDeploymentNodes', JSON.stringify(data.nodes || []));
      }
      // Prefer parent-provided navigation if available
      if (typeof onGoToReport === 'function') {
        onGoToReport();
      } else {
        // Fallback: Enable Report tab (tab 5) and switch to it via URL
        try {
          const savedDisabled = sessionStorage.getItem('cloud_disabledTabs');
          const disabledTabs = savedDisabled ? JSON.parse(savedDisabled) : {};
          disabledTabs['5'] = false;
          sessionStorage.setItem('cloud_disabledTabs', JSON.stringify(disabledTabs));
          sessionStorage.setItem('cloud_activeTab', '5');
        } catch (_) { }
        const url = new URL(window.location.href);
        url.searchParams.set('tab', '5');
        window.location.href = url.toString();
      }
    } catch (err) {
      message.error('Failed to start deployment: ' + err.message);
      setDeployLoading(false);
    }
    // (Optionally, you may still want to transform configs for other purposes)
    // const transformedConfigs = {};
    // Object.entries(configs).forEach(([ip, form]) => {
    //   transformedConfigs[ip] = buildDeployConfigPayload(form);
    // });

  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography.Title level={3} style={{ margin: 0 }}>Network Apply</Typography.Title>
        <Button
          type="primary"
          onClick={handleNext}
          style={{ width: 120, visibility: 'visible' }}
          loading={deployLoading}
          disabled={!allApplied || deployLoading}
        >
          Deploy
        </Button>
      </div>
      <Divider />
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {forms.map((form, idx) => (
          <Spin spinning={cardStatus[idx]?.loading} tip="Applying network changes & restarting node...">
            {/* Host Node server_id display */}
            {hostServerId && (
              <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 8, color: '#2a3f5c' }}>
                Host Node: {hostServerId}
              </div>
            )}
            {firstCloudName && (
              <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 8, color: '#2a3f5c' }}>
                Cloud Name: {firstCloudName}
              </div>
            )}
            <Card key={form.ip} title={`Node: ${form.ip}`} style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                  <Radio.Group
                    value={form.configType}
                    onChange={e => handleConfigTypeChange(idx, e.target.value)}
                    disabled={cardStatus[idx]?.loading || cardStatus[idx]?.applied}
                  >
                    <Radio value="default">Default</Radio>
                    <Radio value="segregated">Segregated</Radio>
                  </Radio.Group>
                  <Checkbox
                    checked={form.useBond}
                    onChange={e => handleUseBondChange(idx, e.target.checked)}
                    disabled={cardStatus[idx]?.loading || cardStatus[idx]?.applied}
                  >
                    Bond
                  </Checkbox>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Button
                    onClick={() => {
                      // After network changes are applied, use the management IP for data fetching
                      const useManagementIP = cardStatus[idx]?.applied;
                      fetchNodeData(form.ip, useManagementIP, form);
                    }}
                    size="small"
                    type="default"
                    style={{ width: 120 }}
                  >
                    Fetch Data
                  </Button>
                </div>
              </div>
              <Table
                columns={getColumns(form, idx)}
                dataSource={form.tableData}
                pagination={false}
                bordered
                size="small"
                scroll={{ x: true }}
                rowClassName={() => (cardStatus[idx]?.loading || cardStatus[idx]?.applied ? 'ant-table-disabled' : '')}
              />

              {/* Default Gateway Field */}
              <div style={{ display: 'flex', flexDirection: 'row', gap: 24, margin: '16px 0 0 0' }}>
                <Form.Item
                  label="Default Gateway"
                  validateStatus={form.defaultGatewayError ? 'error' : ''}
                  help={form.defaultGatewayError}
                  required
                  style={{ minWidth: 220 }}
                >
                  <Input
                    value={form.defaultGateway}
                    placeholder="Enter Default Gateway"
                    onChange={e => handleCellChange(idx, 0, 'defaultGateway', e.target.value)}
                    style={{ width: 200 }}
                    disabled={cardStatus[idx]?.loading || cardStatus[idx]?.applied}
                  />
                </Form.Item>
                <Form.Item
                  label="Select Disk"
                  required={Array.isArray(form.selectedRoles) && form.selectedRoles.includes('Storage')}
                  validateStatus={form.diskError ? 'error' : ''}
                  help={form.diskError}
                  style={{ minWidth: 220 }}
                >
                  <Select
                    mode="multiple"
                    allowClear
                    placeholder="Select disk(s)"
                    value={Array.isArray(form.selectedDisks) ? form.selectedDisks.map(d => {
                      if (typeof d === 'string') return d;
                      if (d && typeof d === 'object') {
                        return d.wwn || d.id || d.value || d.label || d.name || JSON.stringify(d);
                      }
                      return String(d ?? '');
                    }) : []}
                    style={{ width: 200 }}
                    disabled={cardStatus[idx]?.loading || (cardStatus[idx]?.applied && !forceEnableDisks[form.ip])}
                    onChange={value => handleDiskChange(idx, value)}
                    optionLabelProp="label"
                  >
                    {(nodeDisks[form.ip] || []).map(disk => (
                      <Option
                        key={disk.id || disk.wwn || `${disk.name}|${disk.size}`}
                        value={disk.value || disk.id || disk.wwn || `${disk.name}|${disk.size}`}
                        label={String(disk.display || disk.label || `${disk.name || 'Disk'} (${disk.size || 'N/A'})`)}
                      >
                        {String(disk.display || disk.label || `${disk.name || 'Disk'} (${disk.size || 'N/A'})`)}
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
                <Form.Item
                  label="Select Role"
                  required
                  validateStatus={form.roleError ? 'error' : ''}
                  help={form.roleError}
                  style={{ minWidth: 220 }}
                >
                  <Select
                    mode="multiple"
                    allowClear
                    placeholder="Select role(s)"
                    value={form.selectedRoles || []}
                    style={{ width: 200 }}
                    disabled={cardStatus[idx]?.loading || (cardStatus[idx]?.applied && !forceEnableRoles[form.ip])}
                    onChange={value => handleRoleChange(idx, value)}
                  >
                    <Option value="Control">Control</Option>
                    <Option value="Compute">Compute</Option>
                    <Option value="Storage">Storage</Option>
                    <Option value="Monitoring">Monitoring</Option>
                  </Select>
                </Form.Item>
              </div>
              {/* License Details Display - all in one line */}
              <div style={{ margin: '16px 0 0 0', padding: '8px 16px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 4, display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 500, marginRight: 16 }}>License Type:</span>
                <span>{form.licenseType || '-'}</span>
                <span style={{ fontWeight: 500, margin: '0 0 0 32px' }}>License Period:</span>
                <span>{form.licensePeriod || '-'}</span>
                <span style={{ fontWeight: 500, margin: '0 0 0 32px' }}>License Code:</span>
                <span>{form.licenseCode || '-'}</span>
              </div>
              <Divider />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '16px', marginRight: '5%' }}>
                {!cardStatus[idx]?.applied && (
                  <Button danger onClick={() => handleRemoveNode(idx)} style={{ width: '130px', display: 'flex' }} disabled={cardStatus[idx]?.loading || !!btnLoading[idx]}>
                    Remove Node
                  </Button>
                )}
                <Button danger onClick={() => handleReset(idx)} style={{ width: '110px', display: 'flex' }} disabled={cardStatus[idx]?.loading || cardStatus[idx]?.applied || !!btnLoading[idx]}>
                  Reset Value
                </Button>
                <Button type="primary" loading={!!btnLoading[idx]} onClick={() => handleSubmit(idx)} style={{ width: '120px', display: 'flex' }} disabled={cardStatus[idx]?.loading || cardStatus[idx]?.applied}>
                  Apply Change
                </Button>
              </div>
            </Card>
          </Spin>
        ))}
      </Space>
    </div>
  );
};

export default NetworkApply;