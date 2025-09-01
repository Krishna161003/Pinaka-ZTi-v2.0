import React, { useState, useEffect } from 'react';
import { Card, Table, Input, Select, Button, Form, Radio, Checkbox, Divider, Typography, Space, Tooltip, message, Spin, Modal, notification } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { buildNetworkConfigPayload } from './networkapply.format';
import { buildDeployConfigPayload } from './networkapply.deployformat';

const hostIP = window.location.hostname;

// Helper to get Cloud Name (kept same as original SV header behavior)
const getCloudName = () => {
  const fromSession = sessionStorage.getItem('cloudName');
  if (fromSession) return fromSession;
  const meta = document.querySelector('meta[name="cloud-name"]');
  return meta ? meta.content : '';
};

// SSH Polling constants and helpers - using standardized config
import { SSH_CONFIG, getStorageKey, parseSSHError, createSSHTimeoutNotification, validateSSHConfig, fetchWithRetry, validateSSHResponse } from '../../utils/sshConfig';

const POLL_DELAY_MS = SSH_CONFIG.POLL_DELAY_MS;
const POLL_INTERVAL_MS = SSH_CONFIG.POLL_INTERVAL_MS;
const POLL_MAX_POLLS = SSH_CONFIG.POLL_MAX_POLLS;
const SSH_DELAY_START_KEY = getStorageKey('sv', 'DELAY_START_KEY_PREFIX');
const RESTART_MSG_THROTTLE_MS = SSH_CONFIG.RESTART_MSG_THROTTLE_MS;

// Store active polling timeouts and intervals
window.__cloudPolling = window.__cloudPolling || {};

// Global notification state for persistent notifications
window.__globalNotifications = window.__globalNotifications || {
  active: new Set(),
  showNotification: (key, message, description, onRetry) => {
    if (window.__globalNotifications.active.has(key)) return;
    
    notification.warning({
      key,
      message,
      description,
      duration: 0, // Don't auto-close
      onClose: () => window.__globalNotifications.active.delete(key),
      btn: onRetry ? (
        <Button 
          type="primary" 
          size="small" 
          onClick={() => {
            notification.close(key);
            window.__globalNotifications.active.delete(key);
            onRetry();
          }}
        >
          Retry Connection
        </Button>
      ) : null,
    });
    window.__globalNotifications.active.add(key);
  }
};

// Global navigation to Deployment tab (tab key "5") for notifications
function navigateToDeploymentTab() {
  try {
    const pathWithTab = '/servervirtualization?tab=5';
    sessionStorage.setItem('serverVirtualization_activeTab', '5');
    sessionStorage.setItem('lastServerVirtualizationPath', pathWithTab);
    sessionStorage.setItem('lastMenuPath', pathWithTab);
    sessionStorage.setItem('lastZtiPath', pathWithTab);
  } catch (_) { }
  try {
    const url = new URL(window.location.origin + '/servervirtualization');
    url.searchParams.set('tab', '5');
    window.location.assign(url.toString());
  } catch (_) {
    // Fallback
    window.location.href = '/servervirtualization?tab=5';
  }
}

// Throttled info message for restart state to avoid spamming every 5s
function infoRestartThrottled(ip) {
  try {
    const now = Date.now();
    if (!window.__svRestartInfoTs) window.__svRestartInfoTs = {};
    const last = window.__svRestartInfoTs[ip] || 0;
    if (now - last > RESTART_MSG_THROTTLE_MS) {
      window.__svRestartInfoTs[ip] = now;
      message.info('Node restarting...');
    }
  } catch (_) {
    // fallback: single info without throttle if globals blocked
    message.info('Node restarting...');
  }
}

const Deployment = ({ onGoToReport, onRemoveNode, onUndoRemoveNode } = {}) => {
  const cloudName = getCloudName();

  const { Option } = Select;
  const ipRegex = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.|$)){4}$/;
  const subnetRegex = /^(255|254|252|248|240|224|192|128|0+)\.((255|254|252|248|240|224|192|128|0+)\.){2}(255|254|252|248|240|224|192|128|0+)$/;

  // Allowed role combinations for validation
  const ALLOWED_ROLE_COMBOS = [
    ['Control', 'Storage'],
    ['Control', 'Storage', 'Compute'],
    ['Control', 'Storage', 'Monitoring'],
    ['Control', 'Storage', 'Monitoring', 'Compute'],
  ];

  const normalizeRoles = (roles) => Array.from(new Set((roles || []).map(r => String(r).trim()))).sort();
  const isAllowedCombo = (roles) => {
    const norm = normalizeRoles(roles);
    return ALLOWED_ROLE_COMBOS.some(combo => JSON.stringify(norm) === JSON.stringify([...combo].sort()));
  };

  // Get the nodes from sessionStorage (as in Addnode.jsx)
  function getLicenseNodes() {
    const saved = sessionStorage.getItem('sv_licenseNodes');
    return saved ? JSON.parse(saved) : [];
  }

  const RESTART_DURATION = 3000; // ms
  const BOOT_DURATION = 5000; // ms after restart
  const RESTART_ENDTIME_KEY = getStorageKey('sv', 'RESTART_ENDTIME_KEY_PREFIX');
  const BOOT_ENDTIME_KEY = getStorageKey('sv', 'BOOT_ENDTIME_KEY_PREFIX');
  // Persisted hostname map: ip -> hostname (SQDN-XX)
  const HOSTNAME_MAP_KEY = getStorageKey('sv', 'HOSTNAME_MAP_KEY_PREFIX');

  const getHostnameMap = () => {
    try {
      const raw = sessionStorage.getItem(HOSTNAME_MAP_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  };

  const saveHostnameMap = (map) => {
    try { sessionStorage.setItem(HOSTNAME_MAP_KEY, JSON.stringify(map)); } catch (_) { }
  };

  const setHostnameForIp = (ip, hostname) => {
    const map = getHostnameMap();
    map[ip] = hostname;
    saveHostnameMap(map);
  };

  const nextAvailableHostname = (usedSet, preferredNumber = 1) => {
    const make = (n) => `SQDN-${String(n).padStart(3, '0')}`;
    let n = Math.max(1, preferredNumber);
    while (usedSet.has(make(n))) n++;
    return make(n);
  };

  // Global VIP for this cloud deployment
  const [vip, setVip] = useState(() => sessionStorage.getItem('sv_vip') || '');
  const [vipError, setVipError] = useState('');
  // Provider network optional form (CIDR/Gateway/Starting IP/Ending IP)
  const [Providerform] = Form.useForm();

  // Helper function to get network apply result from sessionStorage
  const getNetworkApplyResult = () => {
    const resultRaw = sessionStorage.getItem('sv_networkApplyResult');
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
      vip,
      tableData: Array.isArray(form.tableData) ? form.tableData.map(row => ({ ...row, type: row.type })) : [],
    };
    sessionStorage.setItem('sv_networkApplyResult', JSON.stringify(networkApplyResult));
  };

  // Helper function to get license details from sessionStorage
  const getLicenseDetailsMap = () => {
    const saved = sessionStorage.getItem('sv_licenseActivationResults');
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
    
    // Also check periodically for same-tab changes (like from ActivateKey)
    const interval = setInterval(handleStorageChange, 500);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  // Track mounted state globally to allow background polling to update storage without setState leaks
  useEffect(() => {
    window.__svMountedDeployment = true;
    return () => {
      window.__svMountedDeployment = false;
    };
  }, []);

  // Helper: update card status in sessionStorage by IP (to persist across navigation)
  const setCardStatusForIpInSession = (ip, nextStatus) => {
    try {
      const savedFormsRaw = sessionStorage.getItem('sv_networkApplyForms');
      const savedStatusRaw = sessionStorage.getItem('sv_networkApplyCardStatus');
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
      sessionStorage.setItem('sv_networkApplyCardStatus', JSON.stringify(nextStatusArr));
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
      const formattedDisks = (diskRes.disks || []).map(disk => ({
        name: disk.name,
        size: disk.size,
        wwn: disk.wwn,
        label: `${disk.name} (${disk.size})`,
        value: disk.wwn, // Store WWN as the value
        display: `${disk.name} (${disk.size}, ${disk.wwn})`
      }));

      setNodeDisks(prev => ({ ...prev, [ip]: formattedDisks }));
      // Normalize interfaces: backend returns ["eno1", "enp2s0", ...]
      // Convert to [{ iface: "eno1" }, ...] expected by UI
      const normalizedIfaces = (ifaceRes.interfaces || [])
        .map(i => {
          if (typeof i === 'string') return { iface: i };
          if (i && typeof i === 'object' && typeof i.iface === 'string') return { iface: i.iface };
          return { iface: String(i || '') };
        })
        .filter(x => x.iface);
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

  // On mount, fetch for all nodes that haven't been applied yet
  useEffect(() => {
    const savedStatus = sessionStorage.getItem('sv_networkApplyCardStatus');
    const statusArray = savedStatus ? JSON.parse(savedStatus) : [];
    
    licenseNodes.forEach((node, index) => {
      if (node.ip) {
        // Only fetch if the node hasn't been applied (network changes not yet applied)
        const nodeStatus = statusArray[index] || { loading: false, applied: false };
        if (!nodeStatus.applied) {
          fetchNodeData(node.ip);
        }
      }
    });
  }, [licenseNodes]);
  // Per-card loading and applied state, restore from sessionStorage if available
  const getInitialCardStatus = () => {
    const saved = sessionStorage.getItem('sv_networkApplyCardStatus');
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

    // Get saved forms from sessionStorage if they exist
    const savedForms = sessionStorage.getItem('sv_networkApplyForms');
    if (savedForms) {
      try {
        const forms = JSON.parse(savedForms);
        // Merge license details into saved forms
        return forms.map(form => ({
          ...form,
          licenseType: licenseDetailsMap[form.ip]?.type || form.licenseType || '-',
          licensePeriod: licenseDetailsMap[form.ip]?.period || form.licensePeriod || '-',
          licenseCode: licenseDetailsMap[form.ip]?.licenseCode || form.licenseCode || '-',
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
  // Loading state for Deploy button
  const [deployLoading, setDeployLoading] = useState(false);
  // When validation fails, force-enable Roles selector on specific nodes (keyed by node ip)
  const [forceEnableRoles, setForceEnableRoles] = useState({});
  const [forceEnableDisks, setForceEnableDisks] = useState({});

  // If licenseNodes changes (e.g. after license activation), restore from sessionStorage if available, else reset
  useEffect(() => {
    const savedForms = sessionStorage.getItem('sv_networkApplyForms');
    const savedStatus = sessionStorage.getItem('sv_networkApplyCardStatus');
    const savedLicenseDetails = getLicenseDetailsMap();

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
      const updatedStatus = licenseNodes.map((node, index) => {
        // Find existing form and its corresponding status
        const existingFormIndex = parsedForms.findIndex(f => f.ip === node.ip);
        if (existingFormIndex !== -1 && parsedStatus[existingFormIndex]) {
          return parsedStatus[existingFormIndex];
        } else {
          // Default status for new node - always start as not applied
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
        licenseType: savedLicenseDetails[node.ip]?.type || '-',
        licensePeriod: savedLicenseDetails[node.ip]?.period || '-',
        licenseCode: savedLicenseDetails[node.ip]?.licenseCode || '-',
        selectedDisks: [],
        diskError: '',
        selectedRoles: [],
        roleError: '',
      }));
      
      setForms(newForms);
      setCardStatus(licenseNodes.map(() => ({ loading: false, applied: false })));
      setBtnLoading(licenseNodes.map(() => false));
    }

    // Force re-fetch node data for any new nodes that haven't been applied yet
    licenseNodes.forEach((node, index) => {
      if (node.ip && !nodeDisks[node.ip]) {
        // Only fetch if the node hasn't been applied (network changes not yet applied)
        const nodeStatus = updatedStatus?.[index] || { loading: false, applied: false };
        if (!nodeStatus.applied) {
          fetchNodeData(node.ip);
        }
      }
    });
  }, [licenseNodes]);

  // Recovery: if any node card is loading but no active timers exist, resume polling timers
  useEffect(() => {
    // Ensure globals exist
    if (!window.__cloudPolling) window.__cloudPolling = {};
    if (!window.__cloudPollingStart) window.__cloudPollingStart = {};

    let delayMap = {};
    try {
      const raw = sessionStorage.getItem(SSH_DELAY_START_KEY);
      delayMap = raw ? JSON.parse(raw) : {};
    } catch (_) { delayMap = {}; }

    const statusArrRaw = sessionStorage.getItem('sv_networkApplyCardStatus');
    const statusArr = statusArrRaw ? JSON.parse(statusArrRaw) : [];

    (forms || []).forEach((f, idx) => {
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
      
      const st = statusArr[idx] || {};
      const needsResume = st.loading && !st.applied && !window.__cloudPolling[ssh_target_ip] && !window.__cloudPollingStart[ssh_target_ip];
      if (!needsResume) return;

      const startAt = Number(delayMap[ssh_target_ip] || 0);
      const elapsed = startAt ? (Date.now() - startAt) : Number.POSITIVE_INFINITY;
      const remaining = startAt ? Math.max(POLL_DELAY_MS - elapsed, 0) : 0;

      const beginInterval = () => {
        let pollCount = 0;
        const maxPolls = POLL_MAX_POLLS;
        const interval = setInterval(() => {
          pollCount++;

          // Stop polling if we've exceeded the maximum attempts
          if (pollCount > maxPolls) {
            clearInterval(interval);
            setCardStatusForIpInSession(ip, { loading: false, applied: false });
            if (window.__svMountedDeployment) {
              setCardStatus(prev => {
                const idxNow = forms.findIndex(ff => ff?.ip === ip);
                return prev.map((s, i) => i === idxNow ? { loading: false, applied: false } : s);
              });
            }

            // Show persistent retry notification
            const key = `ssh-timeout-${ssh_target_ip}`;
            
            // Capture variables for recovery retry
            const retryTargetIp = ssh_target_ip;
            const retryOriginalIp = ip;
            const retryIdx = idx;
            
            window.__globalNotifications.showNotification(
              key,
              'Connection Timeout',
              `Failed to connect to ${ssh_target_ip} after multiple attempts. The node may be taking longer than expected to come up.`,
              () => {
                // Re-trigger backend scheduling and restart frontend polling
                const ssh_user = SSH_CONFIG.username;
                const ssh_pass = '';
                const ssh_key = '';
                
                message.info(`Retrying SSH polling for ${retryTargetIp}. Will begin after  2 minutes.`);
                
                fetch(`https://${hostIP}:2020/poll-ssh-status`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ ips: [retryTargetIp], ssh_user, ssh_pass, ssh_key })
                }).then(() => {
                  // Reset delay start time and restart polling
                  try {
                    const raw = sessionStorage.getItem(SSH_DELAY_START_KEY);
                    const map = raw ? JSON.parse(raw) : {};
                    map[retryTargetIp] = Date.now();
                    sessionStorage.setItem(SSH_DELAY_START_KEY, JSON.stringify(map));
                  } catch (_) {}
                  
                  // Reset card status to loading for retry
                  setCardStatusForIpInSession(retryOriginalIp, { loading: true, applied: false });
                  if (window.__svMountedDeployment) {
                    setCardStatus(prev => {
                      const idxNow = forms.findIndex(ff => ff?.ip === retryOriginalIp);
                      return prev.map((s, i) => i === idxNow ? { loading: true, applied: false } : s);
                    });
                  }
                  
                  // Start fresh polling after delay
                  const to = setTimeout(() => {
                    beginInterval();
                    if (window.__cloudPollingStart && window.__cloudPollingStart[retryTargetIp]) {
                      delete window.__cloudPollingStart[retryTargetIp];
                    }
                  }, POLL_DELAY_MS);
                  if (!window.__cloudPollingStart) window.__cloudPollingStart = {};
                  window.__cloudPollingStart[retryTargetIp] = to;
                }).catch(err => {
                  message.error(`Failed to restart SSH polling for ${retryTargetIp}: ${err.message}`);
                  // Ensure loader stays off if retry setup fails
                  setCardStatusForIpInSession(retryOriginalIp, { loading: false, applied: false });
                  if (window.__svMountedDeployment) {
                    setCardStatus(prev => {
                      const idxNow = forms.findIndex(ff => ff?.ip === retryOriginalIp);
                      return prev.map((s, i) => i === idxNow ? { loading: false, applied: false } : s);
                    });
                  }
                });
              }
            );

            message.error(`SSH polling timeout for ${ssh_target_ip}. Please check the node manually.`);
            {
              let suppress = false;
              try {
                if (window.__svMountedDeployment) suppress = true;
                else {
                  const active = sessionStorage.getItem('serverVirtualization_activeTab');
                  if (active === '5') suppress = true;
                }
              } catch (_) { }
              if (!suppress) {
                notification.warning({
                  key: `sv-ssh-timeout-${ssh_target_ip}`,
                  message: 'SSH polling timeout',
                  description: `Timeout waiting for ${ssh_target_ip} to come online.`,
                  duration: 8,
                  btn: (<Button size="small" onClick={navigateToDeploymentTab}>Open Deployment</Button>),
                });
              }
            }
            delete window.__cloudPolling[ssh_target_ip];
            return;
          }

          fetchWithRetry(`https://${hostIP}:2020/check-ssh-status?ip=${encodeURIComponent(ssh_target_ip)}`)
            .then(res => res.json())
            .then(data => {
              // Validate response to ensure data integrity
              const validatedData = validateSSHResponse(data, ssh_target_ip);
              
              if (validatedData.status === 'success' && validatedData.ip === ssh_target_ip) {
                setCardStatusForIpInSession(ip, { loading: false, applied: true });
                if (window.__svMountedDeployment) {
                  setCardStatus(prev => {
                    const idxNow = forms.findIndex(ff => ff?.ip === ip);
                    return prev.map((s, i) => i === idxNow ? { loading: false, applied: true } : s);
                  });
                }
                message.success(`Node ${ssh_target_ip} is back online!`);
                {
                  let suppress = false;
                  try {
                    if (window.__svMountedDeployment) suppress = true;
                    else {
                      const active = sessionStorage.getItem('serverVirtualization_activeTab');
                      if (active === '5') suppress = true;
                    }
                  } catch (_) { }
                  if (!suppress) {
                    notification.open({
                      key: `sv-ssh-success-${ssh_target_ip}`,
                      message: `Node ${ssh_target_ip} is back online`,
                      description: 'You can return to Deployment to continue.',
                      duration: 8,
                      btn: (<Button type="primary" size="small" onClick={navigateToDeploymentTab}>Open Deployment</Button>),
                    });
                  }
                }
                clearInterval(interval);
                delete window.__cloudPolling[ssh_target_ip];
                if (window.__cloudPollingStart && window.__cloudPollingStart[ssh_target_ip]) {
                  delete window.__cloudPollingStart[ssh_target_ip];
                }
                // Store the form data for this node in sessionStorage
                const idxNow = forms.findIndex(ff => ff?.ip === ip);
                const formNow = forms[idxNow];
                if (formNow) storeFormData(ip, formNow);
                                      
                // Note: After network changes are applied, the node IPs may have changed.
                // Automatic data fetching is disabled. Use "Refetch Data" button if needed.
              } else if (data.status === 'fail' && data.ip === ssh_target_ip) {
                if (cardStatus[idx]?.loading || !window.__svMountedDeployment) {
                  infoRestartThrottled(ssh_target_ip);
                }
              }
            })
            .catch(err => {
              console.error('SSH status check failed:', err);
              message.error(`SSH polling failed: ${err.message}. ${SSH_CONFIG.MESSAGES.RESPONSE_LOST}`);
              // On persistent network errors in recovery mode, stop polling to prevent stuck loader
              if (pollCount > POLL_MAX_POLLS / 2) {
                clearInterval(interval);
                setCardStatusForIpInSession(forms[idx]?.ip || ssh_target_ip, { loading: false, applied: false });
                if (window.__svMountedDeployment) {
                  setCardStatus(prev => {
                    const idxNow = forms.findIndex(ff => ff?.ip === (forms[idx]?.ip || ssh_target_ip));
                    return prev.map((s, i) => i === idxNow ? { loading: false, applied: false } : s);
                  });
                }
                if (window.__cloudPolling) delete window.__cloudPolling[ssh_target_ip];
                message.error(`SSH polling failed due to network errors for ${ssh_target_ip}. Please check connectivity.`);
              }
            });
        }, POLL_INTERVAL_MS); // Check every 5 seconds

        window.__cloudPolling[ssh_target_ip] = interval;
      };

      if (remaining > 0 && remaining !== Infinity) {
        const to = setTimeout(() => {
          beginInterval();
          delete window.__cloudPollingStart[ssh_target_ip];
        }, remaining);
        window.__cloudPollingStart[ssh_target_ip] = to;
      } else {
        beginInterval();
      }
    });
  }, [forms, cardStatus]);

  // Persist forms and cardStatus to sessionStorage on change
  useEffect(() => {
    sessionStorage.setItem('sv_networkApplyForms', JSON.stringify(forms));
  }, [forms]);

  useEffect(() => {
    sessionStorage.setItem('sv_networkApplyCardStatus', JSON.stringify(cardStatus));
  }, [cardStatus]);

  function handleDiskChange(idx, value) {
    setForms(prev => prev.map((f, i) => i === idx ? { ...f, selectedDisks: value, diskError: '' } : f));
  }

  function handleRoleChange(idx, value) {
    setForms(prev => {
      const hasStorage = Array.isArray(value) && value.includes('Storage');
      const next = prev.map((f, i) => {
        if (i !== idx) return f;
        const update = { selectedRoles: value, roleError: '' };
        // If Storage is not selected, disk is not mandatory; clear any disk error
        if (!hasStorage) update.diskError = '';
        return { ...f, ...update };
      });
      const updatedForm = next[idx];
      // Persist immediately so DB (5000) and Python (2020) flows read updated roles from session
      if (updatedForm?.ip) {
        storeFormData(updatedForm.ip, updatedForm);
      }
      // Do NOT toggle force-enable here; keep selectors enabled until next Deploy click
      return next;
    });
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
  // Remove Node handlers with confirmation and Undo
  const handleUndoRemoveNode = () => {
    const snapshot = lastRemovedRef.current;
    if (!snapshot) return;

    // Restore arrays and maps from snapshot
    try {
      // licenseNodes
      const nodesRaw = sessionStorage.getItem('sv_licenseNodes');
      const nodesArr = nodesRaw ? JSON.parse(nodesRaw) : [];
      const insIdx = Math.min(Math.max(snapshot.idx, 0), nodesArr.length);
      if (snapshot.licenseNodesEntry) {
        nodesArr.splice(insIdx, 0, snapshot.licenseNodesEntry);
        sessionStorage.setItem('sv_licenseNodes', JSON.stringify(nodesArr));
      }
    } catch (_) { }
    try {
      // restore delay-start timestamp for polling recovery
      if (snapshot.delayStartTs && snapshot.ip) {
        const raw = sessionStorage.getItem('sv_networkApplyPollingDelayStart');
        const map = raw ? JSON.parse(raw) : {};
        map[snapshot.ip] = snapshot.delayStartTs;
        sessionStorage.setItem('sv_networkApplyPollingDelayStart', JSON.stringify(map));
      }
    } catch (_) { }
    try {
      // networkApply forms/status
      const formsRaw = sessionStorage.getItem('sv_networkApplyForms');
      const statusRaw = sessionStorage.getItem('sv_networkApplyCardStatus');
      const formsArr = formsRaw ? JSON.parse(formsRaw) : [];
      const statusArr = statusRaw ? JSON.parse(statusRaw) : [];
      const insIdx = Math.min(Math.max(snapshot.idx, 0), Math.max(formsArr.length, statusArr.length));
      if (snapshot.formsEntry) {
        formsArr.splice(insIdx, 0, snapshot.formsEntry);
        sessionStorage.setItem('sv_networkApplyForms', JSON.stringify(formsArr));
      }
      if (snapshot.cardStatusEntry) {
        statusArr.splice(insIdx, 0, snapshot.cardStatusEntry);
        sessionStorage.setItem('sv_networkApplyCardStatus', JSON.stringify(statusArr));
      }
    } catch (_) { }
    try {
      // timers arrays
      const restartRaw = sessionStorage.getItem('sv_networkApplyRestartEndTimes');
      const bootRaw = sessionStorage.getItem('sv_networkApplyBootEndTimes');
      const restartArr = restartRaw ? JSON.parse(restartRaw) : [];
      const bootArr = bootRaw ? JSON.parse(bootRaw) : [];
      const insIdx = Math.min(Math.max(snapshot.idx, 0), Math.max(restartArr.length, bootArr.length));
      if (snapshot.restartEndTime != null) {
        restartArr.splice(insIdx, 0, snapshot.restartEndTime);
        sessionStorage.setItem('sv_networkApplyRestartEndTimes', JSON.stringify(restartArr));
      }
      if (snapshot.bootEndTime != null) {
        bootArr.splice(insIdx, 0, snapshot.bootEndTime);
        sessionStorage.setItem('sv_networkApplyBootEndTimes', JSON.stringify(bootArr));
      }
    } catch (_) { }
    try {
      // networkApplyResult per-IP
      if (snapshot.ip && snapshot.networkApplyResultEntry) {
        const resultRaw = sessionStorage.getItem('sv_networkApplyResult');
        const resultObj = resultRaw ? JSON.parse(resultRaw) : {};
        resultObj[snapshot.ip] = snapshot.networkApplyResultEntry;
        sessionStorage.setItem('sv_networkApplyResult', JSON.stringify(resultObj));
      }
    } catch (_) { }
    try {
      // licenseActivationResults array and licenseStatus map
      const arrRaw = sessionStorage.getItem('sv_licenseActivationResults');
      const arr = arrRaw ? JSON.parse(arrRaw) : [];
      const insIdx = Math.min(Math.max(snapshot.licenseActivationIndex, 0), arr.length);
      if (snapshot.licenseActivationEntry && snapshot.licenseActivationIndex > -1) {
        arr.splice(insIdx, 0, snapshot.licenseActivationEntry);
        sessionStorage.setItem('sv_licenseActivationResults', JSON.stringify(arr));
      }
      const statusRaw = sessionStorage.getItem('sv_licenseStatus');
      const statusMap = statusRaw ? JSON.parse(statusRaw) : {};
      if (snapshot.licenseStatusEntry && snapshot.ip) {
        statusMap[snapshot.ip] = snapshot.licenseStatusEntry;
        sessionStorage.setItem('sv_licenseStatus', JSON.stringify(statusMap));
      }
    } catch (_) { }
    try {
      // hostname map
      if (snapshot.hostnameEntry && snapshot.ip) {
        const raw = sessionStorage.getItem('sv_hostnameMap');
        const map = raw ? JSON.parse(raw) : {};
        map[snapshot.ip] = snapshot.hostnameEntry;
        sessionStorage.setItem('sv_hostnameMap', JSON.stringify(map));
      }
    } catch (_) { }

    // Restore local states at original index
    setLicenseNodes(prev => {
      const next = [...prev];
      const insIdx = Math.min(Math.max(snapshot.idx, 0), next.length);
      if (snapshot.licenseNodesEntry) next.splice(insIdx, 0, snapshot.licenseNodesEntry);
      return next;
    });
    setForms(prev => {
      const next = [...prev];
      const insIdx = Math.min(Math.max(snapshot.idx, 0), next.length);
      if (snapshot.formsEntry) next.splice(insIdx, 0, snapshot.formsEntry);
      return next;
    });
    setCardStatus(prev => {
      const next = [...prev];
      const insIdx = Math.min(Math.max(snapshot.idx, 0), next.length);
      if (snapshot.cardStatusEntry) next.splice(insIdx, 0, snapshot.cardStatusEntry);
      return next;
    });
    setBtnLoading(prev => {
      const next = [...prev];
      const insIdx = Math.min(Math.max(snapshot.idx, 0), next.length);
      next.splice(insIdx, 0, snapshot.btnLoadingEntry || false);
      return next;
    });
    setForceEnableRoles(prev => ({ ...prev, [snapshot.ip]: prev[snapshot.ip] || false }));
    setForceEnableDisks(prev => ({ ...prev, [snapshot.ip]: prev[snapshot.ip] || false }));

    // Inform parent to restore into earlier tabs
    try {
      if (onUndoRemoveNode) onUndoRemoveNode(snapshot.ip, { ip: snapshot.ip }, snapshot.idx);
    } catch (_) { }

    message.success(`Restored node ${snapshot.ip}`);
    lastRemovedRef.current = null;
  };

  // Remove a node card with confirmation and Undo
  const handleRemoveNode = (idx) => {
    const ip = forms[idx]?.ip || (licenseNodes[idx] && licenseNodes[idx].ip) || '';
    Modal.confirm({
      title: `Remove ${ip}?`,
      content: 'This will remove the node from Deployment and previous steps. You can undo within 5 seconds.',
      okText: 'Remove',
      okButtonProps: { danger: true, size: 'small', style: { width: 90 } },
      cancelText: 'Cancel',
      cancelButtonProps: { size: 'small', style: { width: 90 } },
      onOk: () => {
        const snapshot = {
          idx,
          ip,
          licenseNodesEntry: licenseNodes[idx] || null,
          formsEntry: forms[idx] || null,
          cardStatusEntry: cardStatus[idx] || null,
          btnLoadingEntry: btnLoading[idx] || false,
          restartEndTime: null,
          bootEndTime: null,
          networkApplyResultEntry: null,
          licenseActivationIndex: -1,
          licenseActivationEntry: null,
          licenseStatusEntry: null,
          hostnameEntry: null,
          delayStartTs: null,
        };

        // sv_networkApply restart/boot timers
        try {
          const restartRaw = sessionStorage.getItem('sv_networkApplyRestartEndTimes');
          const bootRaw = sessionStorage.getItem('sv_networkApplyBootEndTimes');
          const restartArr = restartRaw ? JSON.parse(restartRaw) : [];
          const bootArr = bootRaw ? JSON.parse(bootRaw) : [];
          snapshot.restartEndTime = restartArr[idx] ?? null;
          snapshot.bootEndTime = bootArr[idx] ?? null;
          // Splice arrays
          if (Array.isArray(restartArr)) {
            restartArr.splice(idx, 1);
            sessionStorage.setItem('sv_networkApplyRestartEndTimes', JSON.stringify(restartArr));
          }
          if (Array.isArray(bootArr)) {
            bootArr.splice(idx, 1);
            sessionStorage.setItem('sv_networkApplyBootEndTimes', JSON.stringify(bootArr));
          }
        } catch (_) { }

        // sv_networkApplyResult per-IP
        try {
          const resultRaw = sessionStorage.getItem('sv_networkApplyResult');
          const resultObj = resultRaw ? JSON.parse(resultRaw) : {};
          if (ip && resultObj && Object.prototype.hasOwnProperty.call(resultObj, ip)) {
            snapshot.networkApplyResultEntry = resultObj[ip];
            delete resultObj[ip];
            sessionStorage.setItem('sv_networkApplyResult', JSON.stringify(resultObj));
          }
        } catch (_) { }

        // sv_networkApplyPollingDelayStart per-IP
        try {
          const raw = sessionStorage.getItem('sv_networkApplyPollingDelayStart');
          const map = raw ? JSON.parse(raw) : {};
          if (ip && map && Object.prototype.hasOwnProperty.call(map, ip)) {
            snapshot.delayStartTs = map[ip];
            delete map[ip];
            sessionStorage.setItem('sv_networkApplyPollingDelayStart', JSON.stringify(map));
          }
        } catch (_) { }

        // sv_licenseActivationResults array
        try {
          const arrRaw = sessionStorage.getItem('sv_licenseActivationResults');
          const arr = arrRaw ? JSON.parse(arrRaw) : null;
          if (Array.isArray(arr)) {
            const i = arr.findIndex(e => e && e.ip === ip);
            if (i > -1) {
              snapshot.licenseActivationIndex = i;
              snapshot.licenseActivationEntry = arr[i];
              arr.splice(i, 1);
              sessionStorage.setItem('sv_licenseActivationResults', JSON.stringify(arr));
            }
          }
        } catch (_) { }

        // sv_licenseStatus map
        try {
          const raw = sessionStorage.getItem('sv_licenseStatus');
          const map = raw ? JSON.parse(raw) : {};
          if (ip && map && Object.prototype.hasOwnProperty.call(map, ip)) {
            snapshot.licenseStatusEntry = map[ip];
            delete map[ip];
            sessionStorage.setItem('sv_licenseStatus', JSON.stringify(map));
          }
        } catch (_) { }

        // sv_hostnameMap
        try {
          const raw = sessionStorage.getItem('sv_hostnameMap');
          const map = raw ? JSON.parse(raw) : {};
          if (ip && map && Object.prototype.hasOwnProperty.call(map, ip)) {
            snapshot.hostnameEntry = map[ip];
            delete map[ip];
            sessionStorage.setItem('sv_hostnameMap', JSON.stringify(map));
          }
        } catch (_) { }

        // sv_networkApplyForms and sv_networkApplyCardStatus (aligned to index)
        try {
          const formsRaw = sessionStorage.getItem('sv_networkApplyForms');
          const statusRaw = sessionStorage.getItem('sv_networkApplyCardStatus');
          const formsArr = formsRaw ? JSON.parse(formsRaw) : [];
          const statusArr = statusRaw ? JSON.parse(statusRaw) : [];
          if (Array.isArray(formsArr) && idx > -1 && idx < formsArr.length) {
            // snapshot.formsEntry already captured from state
            formsArr.splice(idx, 1);
            sessionStorage.setItem('sv_networkApplyForms', JSON.stringify(formsArr));
          }
          if (Array.isArray(statusArr) && idx > -1 && idx < statusArr.length) {
            // snapshot.cardStatusEntry already captured from state
            statusArr.splice(idx, 1);
            sessionStorage.setItem('sv_networkApplyCardStatus', JSON.stringify(statusArr));
          }
        } catch (_) { }

        // sv_licenseNodes (source for this page)
        try {
          const nodesRaw = sessionStorage.getItem('sv_licenseNodes');
          const nodesArr = nodesRaw ? JSON.parse(nodesRaw) : [];
          if (Array.isArray(nodesArr)) {
            nodesArr.splice(idx, 1);
            sessionStorage.setItem('sv_licenseNodes', JSON.stringify(nodesArr));
          }
        } catch (_) { }

        // Clear UI/polling timers for this IP and index
        try {
          if (timerRefs.current[idx]) {
            clearTimeout(timerRefs.current[idx]);
          }
          timerRefs.current.splice(idx, 1);
          if (window.__cloudPolling && window.__cloudPolling[ip]) {
            clearInterval(window.__cloudPolling[ip]);
            delete window.__cloudPolling[ip];
          }
          if (window.__cloudPollingStart && window.__cloudPollingStart[ip]) {
            clearTimeout(window.__cloudPollingStart[ip]);
            delete window.__cloudPollingStart[ip];
          }
          // Close any lingering SSH notifications for this IP
          try {
            notification.close(`sv-ssh-success-${ip}`);
            notification.close(`sv-ssh-timeout-${ip}`);
          } catch (_) { }
        } catch (_) { }

        // Update local states
        setLicenseNodes(prev => prev.filter((_, i) => i !== idx));
        setForms(prev => prev.filter((_, i) => i !== idx));
        setCardStatus(prev => prev.filter((_, i) => i !== idx));
        setBtnLoading(prev => prev.filter((_, i) => i !== idx));
        setForceEnableRoles(prev => {
          const next = { ...prev };
          if (ip) delete next[ip];
          return next;
        });
        setForceEnableDisks(prev => {
          const next = { ...prev };
          if (ip) delete next[ip];
          return next;
        });
        setNodeDisks(prev => {
          const next = { ...prev };
          if (ip && next[ip]) delete next[ip];
          return next;
        });
        setNodeInterfaces(prev => {
          const next = { ...prev };
          if (ip && next[ip]) delete next[ip];
          return next;
        });

        // Inform parent to remove from earlier tabs as well
        try {
          if (onRemoveNode) onRemoveNode(ip, { ip }, idx);
        } catch (_) { }

        // Store snapshot in ref for undo functionality
        lastRemovedRef.current = snapshot;

        const key = `sv-deploy-remove-${ip}`;
        notification.open({
          key,
          message: `Removed ${ip}`,
          description: 'The node was removed from Deployment and earlier steps.',
          duration: 5,
          btn: (
            <Button type="link" onClick={() => {
              notification.close(key);
              handleUndoRemoveNode();
            }}>
              Undo
            </Button>
          ),
        });
      }
    });
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
            try { message.warning('Only one interface can be set to External_Traffic per node.'); } catch (_) {}
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
          if (f.useBond && value.length > 2) {
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
          let MgmtTaken = false;
          if (form.configType === 'segregated') {
            MgmtTaken = form.tableData.some((row, i) => i !== rowIdx && Array.isArray(row.type) && row.type.includes('Mgmt'));
          }
          let externalTaken = false;
          if (form.configType === 'segregated') {
            externalTaken = form.tableData.some((row, i) => i !== rowIdx && Array.isArray(row.type) && row.type.includes('External_Traffic'));
          }
          const hasExt = Array.isArray(record.type) && record.type.includes('External_Traffic');
          return (
            <Select
              mode="multiple"
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
                  {hasExt ? (
                    // When External_Traffic is selected on this row, hide all other options
                    <Option value="External_Traffic">
                      <Tooltip placement="right" title="External_Traffic">
                        External_Traffic
                      </Tooltip>
                    </Option>
                  ) : (
                    <>
                      {!MgmtTaken || (Array.isArray(record.type) && record.type.includes('Mgmt')) ? (
                        <Option value="Mgmt">
                          <Tooltip placement="right" title="Management" >
                            Mgmt
                          </Tooltip>
                        </Option>
                      ) : null}
                      <Option value="VXLAN">
                        <Tooltip placement="right" title="VXLAN">
                          VXLAN
                        </Tooltip>
                      </Option>
                      {/* Only show Storage if disks are present */}
                      {Array.isArray(nodeDisks[form.ip]) && nodeDisks[form.ip].length > 0 && (
                        <Option value="Storage">
                          <Tooltip placement="right" title="Storage">
                            Storage
                          </Tooltip>
                        </Option>
                      )}
                      {!externalTaken || (Array.isArray(record.type) && record.type.includes('External_Traffic')) ? (
                        <Option value="External_Traffic">
                          <Tooltip placement="right" title="External_Traffic">
                            External_Traffic
                          </Tooltip>
                        </Option>
                      ) : null}
                    </>
                  )}
                </>
              ) : (
                <>
                  <Option value="primary">
                    <Tooltip placement="right" title="Primary">
                      Primary
                    </Tooltip>
                  </Option>
                  <Option value="secondary">
                    <Tooltip placement="right" title="Secondary">
                      Secondary
                    </Tooltip>
                  </Option>
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

  const handleSubmit = (nodeIdx) => {
    if (cardStatus[nodeIdx].loading || cardStatus[nodeIdx].applied) return;
    // Validate all rows for this node
    const form = forms[nodeIdx];
    // Enforce only one External_Traffic in segregated mode
    if (form.configType === 'segregated') {
      const extCount = form.tableData.reduce((acc, r) => acc + (Array.isArray(r.type) && r.type.includes('External_Traffic') ? 1 : 0), 0);
      if (extCount > 1) {
        message.error('Only one interface can be set to External_Traffic per node.');
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
      if (!(form.configType === 'default' && row.type === 'secondary') && !isExternal) {
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
    // Validate disks only if 'Storage' role is selected
    {
      const hasStorageRole = Array.isArray(form.selectedRoles) && form.selectedRoles.includes('Storage');
      if (hasStorageRole) {
        if (!form.selectedDisks || form.selectedDisks.length === 0) {
          setForms(prev => prev.map((f, i) => i === nodeIdx ? { ...f, diskError: 'At least one disk required' } : f));
          message.error('Please select at least one disk for Storage role.');
          return;
        } else {
          setForms(prev => prev.map((f, i) => i === nodeIdx ? { ...f, diskError: '' } : f));
        }
      } else {
        // Not requiring disks when Storage role is not selected
        setForms(prev => prev.map((f, i) => i === nodeIdx ? { ...f, diskError: '' } : f));
      }
    }
    // Validate roles
    if (!form.selectedRoles || form.selectedRoles.length === 0) {
      setForms(prev => prev.map((f, i) => i === nodeIdx ? { ...f, roleError: 'At least one role required' } : f));
      message.error('Please select at least one role.');
      return;
    } else {
      setForms(prev => prev.map((f, i) => i === nodeIdx ? { ...f, roleError: '' } : f));
    }
    // Submit logic here (API call or sessionStorage)
    // Show button loader for backend validation phase
    setBtnLoading(prev => {
      const next = [...prev];
      next[nodeIdx] = true;
      return next;
    });
    // Allocate a unique hostname for this node and persist it
    const ip = form.ip;
    const existingMap = getHostnameMap();
    const used = new Set(Object.values(existingMap || {}));
    const assigned = existingMap[ip] || nextAvailableHostname(used, nodeIdx + 1);
    if (!existingMap[ip]) {
      // Reserve it to avoid duplicates in subsequent applies
      existingMap[ip] = assigned;
      saveHostnameMap(existingMap);
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
          // Stop button loader and switch to card spinner/polling
          setBtnLoading(prev => {
            const next = [...prev];
            next[nodeIdx] = false;
            return next;
          });
          setCardStatus(prev => prev.map((s, i) => i === nodeIdx ? { ...s, loading: true } : s));
          // Persist loader state immediately by IP to survive navigation
          setCardStatusForIpInSession(form.ip, { loading: true, applied: false });
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
          if (window.__cloudPolling && window.__cloudPolling[ssh_target_ip]) {
            clearInterval(window.__cloudPolling[ssh_target_ip]);
            delete window.__cloudPolling[ssh_target_ip];
          }
          if (window.__cloudPollingStart && window.__cloudPollingStart[ssh_target_ip]) {
            clearTimeout(window.__cloudPollingStart[ssh_target_ip]);
            delete window.__cloudPollingStart[ssh_target_ip];
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
            // Helper to schedule or re-schedule frontend polling for this IP
            const scheduleFrontendPolling = () => {
            // Prevent duplicate timers for this IP
            if (!window.__cloudPolling) window.__cloudPolling = {};
            if (!window.__cloudPollingStart) window.__cloudPollingStart = {};
            if (window.__cloudPolling[node_ip]) {
              try { clearInterval(window.__cloudPolling[node_ip]); } catch (_) { }
              delete window.__cloudPolling[node_ip];
            }
            if (window.__cloudPollingStart[node_ip]) {
              try { clearTimeout(window.__cloudPollingStart[node_ip]); } catch (_) { }
              delete window.__cloudPollingStart[node_ip];
            }
            // Persist delay start time for recovery
            try {
              const raw = sessionStorage.getItem(SSH_DELAY_START_KEY);
              const map = raw ? JSON.parse(raw) : {};
              map[node_ip] = Date.now();
              sessionStorage.setItem(SSH_DELAY_START_KEY, JSON.stringify(map));
            } catch (_) { }

            // Delay starting the frontend polling until 90 seconds (to match backend delay)
            const startPollingTimeout = setTimeout(() => {
              let pollCount = 0;
              const maxPolls = POLL_MAX_POLLS; // Maximum 5 minutes of polling

              const pollInterval = setInterval(() => {
                pollCount++;

                // Stop polling if we've exceeded the maximum attempts
                if (pollCount > maxPolls) {
                  clearInterval(pollInterval);
                  setCardStatusForIpInSession(form.ip, { loading: false, applied: false });
                  if (window.__svMountedDeployment) {
                    setCardStatus(prev => {
                      const idxNow = forms.findIndex(f => f?.ip === form.ip);
                      return prev.map((s, i) => i === idxNow ? { loading: false, applied: false } : s);
                    });
                  }
                  message.error(`SSH polling timeout for ${node_ip}. Please check the node manually.`);
                  // Clear delay-start entry for this IP
                  try {
                    const raw = sessionStorage.getItem(SSH_DELAY_START_KEY);
                    const map = raw ? JSON.parse(raw) : {};
                    if (map[node_ip]) {
                      delete map[node_ip];
                      sessionStorage.setItem(SSH_DELAY_START_KEY, JSON.stringify(map));
                    }
                  } catch (_) { }
                    // Cross-menu notification on timeout with Retry
                    const key = `ssh-timeout-${node_ip}`;
                    const description = `Failed to connect to ${node_ip} after multiple attempts. The node may be taking longer than expected to come up.`;
                    
                    // Capture variables in closure for retry function
                    const retryNodeIp = node_ip;
                    const retrySshUser = ssh_user;
                    const retrySshPass = ssh_pass;
                    const retrySshKey = ssh_key;
                    
                    window.__globalNotifications.showNotification(
                      key,
                      'Connection Timeout',
                      description,
                      () => {
                        // Re-trigger backend scheduling and frontend polling
                        fetch(`https://${hostIP}:2020/poll-ssh-status`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ ips: [retryNodeIp], ssh_user: retrySshUser, ssh_pass: retrySshPass, ssh_key: retrySshKey })
                        }).then(() => {
                          // Re-trigger the SSH polling with fresh state
                          message.info(`Retrying SSH polling for ${retryNodeIp}. Will begin after 90 seconds.`);
                          scheduleFrontendPolling();
                        }).catch(err => {
                          message.error(`Failed to restart SSH polling for ${retryNodeIp}: ${err.message}`);
                        });
                      }
                    );
                  delete window.__cloudPolling[node_ip];
                  return;
                }

                fetch(`https://${hostIP}:2020/check-ssh-status?ip=${encodeURIComponent(node_ip)}`)
                  .then(res => res.json())
                  .then(data => {
                    if (data.status === 'success' && data.ip === node_ip) {
                      // Persist status to sessionStorage so it reflects on remount or in other menus
                      setCardStatusForIpInSession(form.ip, { loading: false, applied: true });
                      if (window.__svMountedDeployment) {
                        setCardStatus(prev => {
                          const idxNow = forms.findIndex(f => f?.ip === form.ip);
                          return prev.map((s, i) => i === idxNow ? { loading: false, applied: true } : s);
                        });
                      }
                      message.success(`Node ${data.ip} is back online!`);
                      // Cross-menu notification on success
                      {
                        let suppress = false;
                        try {
                          if (window.__svMountedDeployment) suppress = true;
                          else {
                            const active = sessionStorage.getItem('serverVirtualization_activeTab');
                            if (active === '5') suppress = true;
                          }
                        } catch (_) { }
                        if (!suppress) {
                          notification.open({
                            key: `sv-ssh-success-${node_ip}`,
                            message: `Node ${data.ip} is back online`,
                            description: 'You can return to Deployment to continue.',
                            duration: 8,
                            btn: (
                              <Button type="primary" size="small" onClick={navigateToDeploymentTab}>Open Deployment</Button>
                            ),
                          });
                        }
                      }
                      clearInterval(pollInterval);
                      delete window.__cloudPolling[node_ip];
                      if (window.__cloudPollingStart && window.__cloudPollingStart[node_ip]) {
                        delete window.__cloudPollingStart[node_ip];
                      }
                      // Clear delay-start entry for this IP
                      try {
                        const raw = sessionStorage.getItem(SSH_DELAY_START_KEY);
                        const map = raw ? JSON.parse(raw) : {};
                        if (map[node_ip]) {
                          delete map[node_ip];
                          sessionStorage.setItem(SSH_DELAY_START_KEY, JSON.stringify(map));
                        }
                      } catch (_) { }
                      // Store the form data for this node in sessionStorage
                      const nodeIp = form.ip || `node${nodeIdx + 1}`;
                      storeFormData(nodeIp, form);
                    } else if (data.status === 'fail' && data.ip === node_ip) {
                      if (cardStatus[nodeIdx]?.loading || !window.__svMountedDeployment) {
                        infoRestartThrottled(node_ip);
                      }
                    }
                  })
                  .catch(err => {
                    console.error('SSH status check failed:', err);
                    // On persistent network errors, ensure we don't get stuck in loading state
                    if (pollCount > maxPolls / 2) { // After half the attempts failed
                      clearInterval(pollInterval);
                      setCardStatusForIpInSession(form.ip, { loading: false, applied: false });
                      if (window.__svMountedDeployment) {
                        setCardStatus(prev => {
                          const idxNow = forms.findIndex(f => f?.ip === form.ip);
                          return prev.map((s, i) => i === idxNow ? { loading: false, applied: false } : s);
                        });
                      }
                      if (window.__cloudPolling) delete window.__cloudPolling[node_ip];
                      // Clear delay-start entry for this IP
                      try {
                        const raw = sessionStorage.getItem(SSH_DELAY_START_KEY);
                        const map = raw ? JSON.parse(raw) : {};
                        if (map[node_ip]) {
                          delete map[node_ip];
                          sessionStorage.setItem(SSH_DELAY_START_KEY, JSON.stringify(map));
                        }
                      } catch (_) { }
                      message.error(`SSH polling failed due to network errors for ${node_ip}. Please check connectivity.`);
                    }
                  });
              }, POLL_INTERVAL_MS); // Check every 5 seconds

              // Store the interval reference globally (do not clear on unmount to allow background polling)
              if (!window.__cloudPolling) window.__cloudPolling = {};
              window.__cloudPolling[node_ip] = pollInterval;
            }, POLL_DELAY_MS); // Start polling after 90 seconds

            if (!window.__cloudPollingStart) window.__cloudPollingStart = {};
            window.__cloudPollingStart[node_ip] = startPollingTimeout;
            };

            // Initial schedule
            scheduleFrontendPolling();
          }).catch(err => {
            console.error('SSH polling setup failed:', err);
            // If polling setup fails, ensure loader is turned off
            setCardStatusForIpInSession(form.ip, { loading: false, applied: false });
            if (window.__svMountedDeployment) {
              setCardStatus(prev => {
                const idxNow = forms.findIndex(f => f?.ip === form.ip);
                return prev.map((s, i) => i === idxNow ? { loading: false, applied: false } : s);
              });
            }
            message.error(`Failed to start SSH polling for ${node_ip}: ${err.message}. Please check network connectivity.`);
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

  // Check if all cards are applied
  const allApplied = cardStatus.length > 0 && cardStatus.every(s => s.applied);

  const handleNext = async () => {
    // Only allow if all cards are applied
    if (!allApplied) {
      message.warning('Please apply all nodes before deploying.');
      return;
    }
    // Validate VIP presence and format
    if (!vip) {
      setVipError('Required');
      message.error('Please enter VIP before deploying.');
      return;
    }
    if (!ipRegex.test(vip)) {
      setVipError('Invalid IP address');
      message.error('VIP must be a valid IP address.');
      return;
    }
    // Get all node configs from sessionStorage
    const configs = getNetworkApplyResult();
    if (Object.keys(configs).length === 0) {
      message.error('No node configuration found.');
      return;
    }

    // Per-node validation: ensure roles selected and disks selected for Storage role
    for (let i = 0; i < forms.length; i++) {
      const f = forms[i] || {};
      // Each node must have at least one role
      if (!Array.isArray(f.selectedRoles) || f.selectedRoles.length === 0) {
        setForms(prev => prev.map((ff, idx) => idx === i ? { ...ff, roleError: 'At least one role required' } : ff));
        if (f.ip) {
          setForceEnableRoles(prev => ({ ...prev, [f.ip]: true }));
          setForceEnableDisks(prev => ({ ...prev, [f.ip]: true }));
        }
        message.error(`Node ${f.ip || i + 1}: please select at least one role.`);
        return;
      }
      // If Storage role is selected, at least one disk must be chosen
      if (Array.isArray(f.selectedRoles) && f.selectedRoles.includes('Storage')) {
        if (!Array.isArray(f.selectedDisks) || f.selectedDisks.length === 0) {
          setForms(prev => prev.map((ff, idx) => idx === i ? { ...ff, diskError: 'At least one disk required' } : ff));
          if (f.ip) {
            setForceEnableDisks(prev => ({ ...prev, [f.ip]: true }));
            setForceEnableRoles(prev => ({ ...prev, [f.ip]: true }));
          }
          message.error(`Node ${f.ip || i + 1}: please select at least one disk for Storage role.`);
          return;
        }
      }
    }

    // Validate role combinations across nodes: the union of roles across ALL nodes must equal an allowed combo
    const unionRoles = normalizeRoles(forms.flatMap(f => f?.selectedRoles || []));
    const isUnionAllowed = isAllowedCombo(unionRoles);
    if (!isUnionAllowed) {
      setForms(prev => prev.map(f => ({
        ...f,
        roleError: 'Combined roles across nodes must be one of: Control+Storage, Control+Storage+Compute, Control+Storage+Monitoring, Control+Storage+Monitoring+Compute'
      })));
      // Force-enable role selectors even if cards were applied
      setForceEnableRoles(prev => {
        const next = { ...prev };
        forms.forEach(f => { if (f?.ip) next[f.ip] = true; });
        return next;
      });
      // Also enable disk selectors for consistency
      setForceEnableDisks(prev => {
        const next = { ...prev };
        forms.forEach(f => { if (f?.ip) next[f.ip] = true; });
        return next;
      });
      message.error(`Invalid combined roles: [${unionRoles.join(', ')}]. Required combos: Control+Storage, Control+Storage+Compute, Control+Storage+Monitoring, or Control+Storage+Monitoring+Compute.`);
      return;
    }

    // Validate VIP availability with backend before proceeding
    try {
      setDeployLoading(true);
      const vipResp = await fetch(`https://${hostIP}:2020/is-vip-available?vip=${encodeURIComponent(vip)}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const vipData = await vipResp.json().catch(() => ({}));
      if (!vipResp.ok || vipData?.success === false) {
        const errMsg = vipData?.message || vipData?.error || 'VIP validation failed';
        message.error(errMsg);
        setDeployLoading(false);
        return; // Stop deployment flow if VIP not available/invalid
      }
      // Optional: notify success
      // message.success('VIP is available');
    } catch (e) {
      message.error('Unable to validate VIP: ' + e.message);
      setDeployLoading(false);
      return;
    }

    // After VIP validation: optional Provider fields validation
    try {
      const { cidr, gateway, startingIp, endingIp } = Providerform.getFieldsValue(['cidr', 'gateway', 'startingIp', 'endingIp']);
      const values = [cidr, gateway, startingIp, endingIp];
      const providedCount = values.filter(v => v && String(v).trim() !== '').length;
      if (providedCount > 0 && providedCount < 4) {
        message.error('Please fill all Provider fields (CIDR, Gateway, Starting IP, Ending IP) or leave all empty.');
        setDeployLoading(false);
        return;
      }
      if (providedCount === 4) {
        // Validate patterns defined on fields
        await Providerform.validateFields(['cidr', 'gateway', 'startingIp', 'endingIp']);
      }
    } catch (e) {
      // Field pattern validation failed
      setDeployLoading(false);
      return;
    }

    // All validations passed: clear force-enable flags so selectors can disable on this Deploy click
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

    // Transform configs for backend storage
    // Use the same hostnames assigned during Network Apply; allocate unique for any missing
    const savedHostnameMap = getHostnameMap();
    const usedHostnames = new Set(Object.values(savedHostnameMap || {}));
    const hostnameMap = {};
    forms.forEach((f, idx) => {
      if (!f?.ip) return;
      let hn = savedHostnameMap[f.ip];
      if (!hn) {
        hn = nextAvailableHostname(usedHostnames, idx + 1);
        usedHostnames.add(hn);
        savedHostnameMap[f.ip] = hn;
      }
      hostnameMap[f.ip] = hn;
    });
    // Persist any newly allocated hostnames
    saveHostnameMap(savedHostnameMap);

    // Build transformed configs; attach Provider fields only to first node
    const transformedConfigs = {};
    const firstIp = forms && forms.length > 0 ? forms[0]?.ip : undefined;
    const { cidr, gateway, startingIp, endingIp } = Providerform.getFieldsValue(['cidr', 'gateway', 'startingIp', 'endingIp']);
    const providerData = {
      provider_cidr: cidr && String(cidr).trim() !== '' ? cidr : 'N/A',
      provider_gateway: gateway && String(gateway).trim() !== '' ? gateway : 'N/A',
      provider_startingip: startingIp && String(startingIp).trim() !== '' ? startingIp : 'N/A',
      provider_endingip: endingIp && String(endingIp).trim() !== '' ? endingIp : 'N/A',
      tenant_cidr: '10.0.0.0/24',
      tenant_gateway: '10.0.0.1',
      tenant_nameserver: '8.8.8.8',
    };
    Object.entries(configs).forEach(([ip, form]) => {
      const base = buildDeployConfigPayload({ ...form, hostname: hostnameMap[ip] || form?.hostname });
      transformedConfigs[ip] = {
        ...base,
        server_vip: form?.vip || vip,
        ...(firstIp && ip === firstIp ? providerData : {}),
      };
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
        setDeployLoading(false);
        throw new Error(errorData.error || 'Failed to store deployment configs');
      }

      const result = await response.json();
      if (!result.success) {
        setDeployLoading(false);
        throw new Error('Failed to store deployment configs');
      }

      message.success('Deployment configurations stored successfully');
    } catch (error) {
      console.error('Error storing deployment configs:', error);
      message.error('Error storing deployment configurations: ' + error.message);
      setDeployLoading(false);
      return; // Stop further execution if backend storage fails
    }

    // Prepare POST data for /api/node-deployment-activity-log
    // Each node must have: serverip, hostname, server_vip, Mgmt, Storage, External_Traffic, VXLAN, license_code, license_type, license_period
    // Do NOT send a 'type' field from frontend; backend sets type='primary'.
    const nodes = Object.values(configs).map(form => ({
      serverip: form.ip,
      hostname: hostnameMap[form.ip] || form?.hostname || '',
      // Send all selected roles as a comma-separated string to store multiple roles in DB
      role: Array.isArray(form.selectedRoles) && form.selectedRoles.length > 0 ? form.selectedRoles.join(',') : 'child',
      server_vip: form.vip || vip,
      Mgmt: form.tableData?.find(row => Array.isArray(row.type) ? row.type.includes('Mgmt') : row.type === 'Mgmt')?.ip || '',
      Storage: form.tableData?.find(row => Array.isArray(row.type) ? row.type.includes('Storage') : row.type === 'Storage')?.ip || '',
      External_Traffic: form.tableData?.find(row => Array.isArray(row.type) ? row.type.includes('External_Traffic') : row.type === 'External_Traffic')?.ip || '',
      VXLAN: form.tableData?.find(row => Array.isArray(row.type) ? row.type.includes('VXLAN') : row.type === 'VXLAN')?.ip || '',
      license_code: form.licenseCode || '',
      license_type: form.licenseType || '',
      license_period: form.licensePeriod || '',
    }));

    // Get user info and cloudname
    const loginDetails = JSON.parse(sessionStorage.getItem('loginDetails'));
    const user_id = loginDetails?.data?.id || '';
    const username = loginDetails?.data?.companyName || '';
    const cloudname = cloudName || '';

    // POST to backend (new primary node deployment logging endpoint)
    try {
      const res = await fetch(`https://${hostIP}:5000/api/node-deployment-activity-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes, user_id, username, cloudname })
      });
      const data = await res.json();
      if (!res.ok) {
        setDeployLoading(false);
        throw new Error(data.error || 'Failed to start deployment log');
      }
      // Optionally store the returned serverids for later use
      sessionStorage.setItem('sv_lastDeploymentNodes', JSON.stringify(data.nodes));
      // Prefer parent-provided navigation if available
      if (typeof onGoToReport === 'function') {
        setDeployLoading(false);
        onGoToReport();
      } else {
        // Fallback: Enable Report tab (tab 5) and switch to it via URL
        try {
          const savedDisabled = sessionStorage.getItem('sv_disabledTabs');
          const disabledTabs = savedDisabled ? JSON.parse(savedDisabled) : {};
          disabledTabs['5'] = false;
          sessionStorage.setItem('sv_disabledTabs', JSON.stringify(disabledTabs));
          sessionStorage.setItem('sv_activeTab', '5');
        } catch (_) { }
        setDeployLoading(false);
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
      {/* Cloud Name header with Deploy button on the right */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ marginBottom: 0 }}>
          Cloud Name: <span style={{ color: '#1890ff' }}>{cloudName}</span>
        </h4>
      <Button
        type="primary"
        onClick={handleNext}
        style={{ width: 120, visibility: 'visible' }}
        disabled={!allApplied || deployLoading}
        loading={deployLoading}
      >
        Deploy
      </Button>
    </div>
    <Divider />
    {/* VIP input below Cloud Name */}
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 12 }}>
      <Form layout="inline" style={{ width: '100%', justifyContent: 'flex-start', alignItems: 'center' }}>
        {/* <span style={{ marginRight: 8, whiteSpace: 'nowrap' }}>Enter VIP:</span> */}
        <Form.Item
          validateStatus={vipError ? 'error' : ''}
          help={vipError}
          style={{ marginBottom: 0 }}
          required
          label={
            <span>
              Enter VIP&nbsp;
              <Tooltip placement="top" title="Virtual IP Address" >
                <InfoCircleOutlined style={{
                  color: "#1890ff", fontSize: "14px", height: "12px",
                  width: "12px"
                }} />
              </Tooltip>
            </span>
          }
          rules={[
            { required: true, message: 'VIP is required' },
          ]}
        >
          <Input
            style={{ width: 200 }}
            placeholder="Enter VIP (IP address)"
            value={vip}
            onChange={(e) => {
              const val = e.target.value;
              setVip(val);
              sessionStorage.setItem('sv_vip', val);
              if (!val) {
                setVipError('Required');
              } else if (!ipRegex.test(val)) {
                setVipError('Invalid IP address');
              } else {
                setVipError('');
              }
            }}
          />
        </Form.Item>
      </Form>
      {/* Optional Provider network fields (all-or-none) */}
      <Form form={Providerform} layout="inline" style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: 12, flexWrap: 'nowrap', overflowX: 'auto' }}>
          <span style={{ whiteSpace: 'nowrap' }}>Provider Network&nbsp;<Tooltip placement="bottom" title="Provider Network" >
            <InfoCircleOutlined style={{
              color: "#1890ff", fontSize: "14px", height: "12px",
              width: "12px"
            }} />
          </Tooltip>&nbsp;:</span>
          <Form.Item
            name="cidr"
            style={{ marginBottom: 0 }}
            rules={[
              {
                pattern: /^(([0-9]{1,3}\.){3}[0-9]{1,3})\/([0-9]|[1-2][0-9]|3[0-2])$/,
                message: 'Invalid CIDR format (e.g. 192.168.1.0/24)',
              },
            ]}
          >
            <Input placeholder="Enter CIDR (optional)" style={{ width: 160 }} />
          </Form.Item>

          <Form.Item
            name="gateway"
            style={{ marginBottom: 0 }}
            rules={[
              {
                pattern: /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.|$)){4}$/,
                message: 'Invalid IP address',
              },
            ]}
          >
            <Input placeholder="Enter Gateway (optional)" style={{ width: 160 }} />
          </Form.Item>

          <Form.Item
            name="startingIp"
            style={{ marginBottom: 0 }}
            rules={[
              {
                pattern: /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.|$)){4}$/,
                message: 'Invalid IP address',
              },
            ]}
          >
            <Input placeholder="Enter Starting IP (optional)" style={{ width: 160 }} />
          </Form.Item>

          <Form.Item
            name="endingIp"
            style={{ marginBottom: 0 }}
            rules={[
              {
                pattern: /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.|$)){4}$/,
                message: 'Invalid IP address',
              },
            ]}
          >
            <Input placeholder="Enter Ending IP (optional)" style={{ width: 160 }} />
          </Form.Item>
        </div>
      </Form>
      {/* End Provider form */}
      <Divider />
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {forms.map((form, idx) => (
          <Spin spinning={cardStatus[idx]?.loading} tip="Applying network changes & restarting node...">
            <Card key={form.ip} title={`Node: ${form.ip}`} style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
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
                  Refetch Data
                </Button>
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
                    {(nodeDisks[form.ip] || []).map(disk => {
                      const name = (disk && typeof disk === 'object') ? (disk.name ?? '') : '';
                      const size = (disk && typeof disk === 'object') ? (disk.size ?? '') : '';
                      const wwn = (disk && typeof disk === 'object') ? (disk.wwn ?? '') : '';
                      const id = (disk && typeof disk === 'object') ? (disk.id || wwn || `${name}|${size}`) : String(disk);
                      const value = (disk && typeof disk === 'object') ? (disk.value || id) : String(disk);
                      const computed = (disk && typeof disk === 'object') ? (disk.display || disk.label) : undefined;
                      const label = String(computed || (wwn ? `${name} (${size}, ${wwn})` : `${name || 'Disk'} (${size || 'N/A'})`));
                      return (
                        <Option key={id} value={value} label={label}>
                          {label}
                        </Option>
                      );
                    })}
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
    </div>
  );
};

export default Deployment;