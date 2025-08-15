import React, { useState, useEffect } from 'react';
import { Card, Table, Input, Select, Button, Form, Radio, Checkbox, Divider, Typography, Space, Tooltip, message, Spin, Modal, notification } from 'antd';
// (removed unused InfoCircleOutlined import)
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
  const RESTART_ENDTIME_KEY = 'sv_networkApplyRestartEndTimes';
  const BOOT_ENDTIME_KEY = 'sv_networkApplyBootEndTimes';
  // Persisted hostname map: ip -> hostname (SQDN-XX)
  const HOSTNAME_MAP_KEY = 'sv_hostnameMap';

  const getHostnameMap = () => {
    try {
      const raw = sessionStorage.getItem(HOSTNAME_MAP_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  };

  const saveHostnameMap = (map) => {
    try { sessionStorage.setItem(HOSTNAME_MAP_KEY, JSON.stringify(map)); } catch (_) {}
  };

  const setHostnameForIp = (ip, hostname) => {
    const map = getHostnameMap();
    map[ip] = hostname;
    saveHostnameMap(map);
  };

  const nextAvailableHostname = (usedSet, preferredNumber = 1) => {
    const make = (n) => `SQDN-${String(n).padStart(2, '0')}`;
    let n = Math.max(1, preferredNumber);
    while (usedSet.has(make(n))) n++;
    return make(n);
  };

  // Global VIP for this cloud deployment
  const [vip, setVip] = useState(() => sessionStorage.getItem('sv_vip') || '');
  const [vipError, setVipError] = useState('');

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

  // Track mounted state globally to allow background polling to update storage without setState leaks
  useEffect(() => {
    window.__cloudMountedNetworkApply = true;
    return () => {
      window.__cloudMountedNetworkApply = false;
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
    } catch (_) {}
  };

  // Dynamic per-node disks and interfaces
  const [nodeDisks, setNodeDisks] = useState({});
  const [nodeInterfaces, setNodeInterfaces] = useState({});

  // Fetch disks and interfaces for a node
  const fetchNodeData = async (ip) => {
    try {
      const [diskRes, ifaceRes] = await Promise.all([
        fetch(`https://${ip}:2020/get-disks`).then(r => r.json()),
        fetch(`https://${ip}:2020/get-interfaces`).then(r => r.json()),
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
      setNodeInterfaces(prev => ({ ...prev, [ip]: (ifaceRes.interfaces || []).map(i => ({ iface: i.iface })) }));
    } catch (e) {
      console.error(`Failed to fetch data from node ${ip}:`, e);
      message.error(`Failed to fetch data from node ${ip}: ${e.message}`);
    }
  };

  // On mount, fetch for all nodes
  useEffect(() => {
    licenseNodes.forEach(node => {
      if (node.ip) fetchNodeData(node.ip);
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

  // If licenseNodes changes (e.g. after license activation), restore from sessionStorage if available, else reset
  useEffect(() => {
    const savedForms = sessionStorage.getItem('sv_networkApplyForms');
    const savedStatus = sessionStorage.getItem('sv_networkApplyCardStatus');
    const savedLicenseDetails = getLicenseDetailsMap();

    if (savedForms && savedStatus) {
      // Merge saved forms with any updated license details
      const parsedForms = JSON.parse(savedForms);
      const updatedForms = parsedForms.map(form => ({
        ...form,
        licenseType: savedLicenseDetails[form.ip]?.type || form.licenseType || '-',
        licensePeriod: savedLicenseDetails[form.ip]?.period || form.licensePeriod || '-',
        licenseCode: savedLicenseDetails[form.ip]?.licenseCode || form.licenseCode || '-',
      }));

      setForms(updatedForms);
      setCardStatus(JSON.parse(savedStatus));
      // Reset per-card button loaders to idle for current forms length
      setBtnLoading(updatedForms.map(() => false));
    } else {
      setForms(
        licenseNodes.map(node => ({
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
        }))
      );
      setCardStatus(licenseNodes.map(() => ({ loading: false, applied: false })));
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
    sessionStorage.setItem('sv_networkApplyResult', JSON.stringify(networkApplyResult));
  }, [cardStatus, forms]);

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
      const next = prev.map((f, i) => i === idx ? { ...f, selectedRoles: value, roleError: '' } : f);
      const updatedForm = next[idx];
      // Persist immediately so DB (5000) and Python (2020) flows read updated roles from session
      if (updatedForm?.ip) {
        storeFormData(updatedForm.ip, updatedForm);
      }
      // Toggle force-enable state depending on validity
      const valid = isAllowedCombo(value);
      setForceEnableRoles(prevForce => ({
        ...prevForce,
        [updatedForm.ip]: valid ? false : true,
      }));
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
        } catch (_) {}

        // sv_networkApplyResult per-IP
        try {
          const resultRaw = sessionStorage.getItem('sv_networkApplyResult');
          const resultObj = resultRaw ? JSON.parse(resultRaw) : {};
          if (ip && resultObj && Object.prototype.hasOwnProperty.call(resultObj, ip)) {
            snapshot.networkApplyResultEntry = resultObj[ip];
            delete resultObj[ip];
            sessionStorage.setItem('sv_networkApplyResult', JSON.stringify(resultObj));
          }
        } catch (_) {}

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
        } catch (_) {}

        // sv_licenseStatus map
        try {
          const raw = sessionStorage.getItem('sv_licenseStatus');
          const map = raw ? JSON.parse(raw) : {};
          if (ip && map && Object.prototype.hasOwnProperty.call(map, ip)) {
            snapshot.licenseStatusEntry = map[ip];
            delete map[ip];
            sessionStorage.setItem('sv_licenseStatus', JSON.stringify(map));
          }
        } catch (_) {}

        // sv_hostnameMap
        try {
          const raw = sessionStorage.getItem('sv_hostnameMap');
          const map = raw ? JSON.parse(raw) : {};
          if (ip && map && Object.prototype.hasOwnProperty.call(map, ip)) {
            snapshot.hostnameEntry = map[ip];
            delete map[ip];
            sessionStorage.setItem('sv_hostnameMap', JSON.stringify(map));
          }
        } catch (_) {}

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
        } catch (_) {}

        // sv_licenseNodes (source for this page)
        try {
          const nodesRaw = sessionStorage.getItem('sv_licenseNodes');
          const nodesArr = nodesRaw ? JSON.parse(nodesRaw) : [];
          if (Array.isArray(nodesArr)) {
            nodesArr.splice(idx, 1);
            sessionStorage.setItem('sv_licenseNodes', JSON.stringify(nodesArr));
          }
        } catch (_) {}

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
        } catch (_) {}

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
        } catch (_) {}

        const key = `sv-deploy-remove-${ip}`;
        notification.open({
          key,
          message: `Removed ${ip}`,
          description: 'The node was removed from Deployment and earlier steps.',
          duration: 5,
          btn: (
            <Button type="link" onClick={() => {
              notification.destroy(key);
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
              } catch (_) {}
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
              } catch (_) {}
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
              } catch (_) {}
              try {
                // networkApplyResult per-IP
                if (snapshot.ip && snapshot.networkApplyResultEntry) {
                  const resultRaw = sessionStorage.getItem('sv_networkApplyResult');
                  const resultObj = resultRaw ? JSON.parse(resultRaw) : {};
                  resultObj[snapshot.ip] = snapshot.networkApplyResultEntry;
                  sessionStorage.setItem('sv_networkApplyResult', JSON.stringify(resultObj));
                }
              } catch (_) {}
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
              } catch (_) {}
              try {
                // hostname map
                if (snapshot.hostnameEntry && snapshot.ip) {
                  const raw = sessionStorage.getItem('sv_hostnameMap');
                  const map = raw ? JSON.parse(raw) : {};
                  map[snapshot.ip] = snapshot.hostnameEntry;
                  sessionStorage.setItem('sv_hostnameMap', JSON.stringify(map));
                }
              } catch (_) {}

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

              // Inform parent to restore into earlier tabs
              try {
                if (onUndoRemoveNode) onUndoRemoveNode(snapshot.ip, { ip: snapshot.ip }, snapshot.idx);
              } catch (_) {}
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
          if (value && (!/^[0-9]*$/.test(value) || value.length > 4 || Number(value) < 1 || Number(value) > 4094)) {
            row.errors[field] = 'VLAN ID must be 1-4094';
          } else {
            delete row.errors[field];
          }
        }
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
          let managementTaken = false;
          if (form.configType === 'segregated') {
            managementTaken = form.tableData.some((row, i) => i !== rowIdx && Array.isArray(row.type) && row.type.includes('Management'));
          }
          return (
            <Select
              mode={form.configType === 'segregated' ? 'multiple' : undefined}
              allowClear
              style={{ width: '100%' }}
              value={record.type || undefined}
              placeholder="Select type"
              onChange={value => handleCellChange(nodeIdx, rowIdx, 'type', value)}
              disabled={cardStatus[nodeIdx]?.loading || cardStatus[nodeIdx]?.applied}
            >
              {form.configType === 'segregated' ? (
                <>
                  {!managementTaken || (Array.isArray(record.type) && record.type.includes('Management')) ? (
                    <Option value="Management">
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
                  <Option value="External Traffic">
                    <Tooltip placement="right" title="External Traffic">
                      External Traffic
                    </Tooltip>
                  </Option>
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
              disabled={(cardStatus[nodeIdx]?.loading || cardStatus[nodeIdx]?.applied) || (form.configType === 'default' && record.type === 'secondary')}
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
              disabled={(cardStatus[nodeIdx]?.loading || cardStatus[nodeIdx]?.applied) || (form.configType === 'default' && record.type === 'secondary')}
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
              disabled={(cardStatus[nodeIdx]?.loading || cardStatus[nodeIdx]?.applied) || (form.configType === 'default' && record.type === 'secondary')}
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
    ];
  };

  const handleSubmit = (nodeIdx) => {
    if (cardStatus[nodeIdx].loading || cardStatus[nodeIdx].applied) return;
    // Validate all rows for this node
    const form = forms[nodeIdx];
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
      // Validate required fields (skip for secondary in default mode)
      if (!(form.configType === 'default' && row.type === 'secondary')) {
        for (const field of ['ip', 'subnet', 'dns']) {
          if (!row[field]) {
            message.error(`Row ${i + 1}: Please enter ${field.toUpperCase()}.`);
            return;
          }
        }
      }
      if (Object.keys(row.errors || {}).length > 0) {
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
    // Validate disks
    if (!form.selectedDisks || form.selectedDisks.length === 0) {
      setForms(prev => prev.map((f, i) => i === nodeIdx ? { ...f, diskError: 'At least one disk required' } : f));
      message.error('Please select at least one disk.');
      return;
    } else {
      setForms(prev => prev.map((f, i) => i === nodeIdx ? { ...f, diskError: '' } : f));
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
          // Gather all required info for the polling API
          const node_ip = form.ip;
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
            // Delay starting the frontend polling until 90 seconds (to match backend delay)
            const startPollingTimeout = setTimeout(() => {
              let pollCount = 0;
              const maxPolls = 60; // Maximum 5 minutes of polling (60 * 5 seconds)
              
              const pollInterval = setInterval(() => {
                pollCount++;
                
                // Stop polling if we've exceeded the maximum attempts
                if (pollCount > maxPolls) {
                  clearInterval(pollInterval);
                  setCardStatusForIpInSession(node_ip, { loading: false, applied: false });
                  if (window.__cloudMountedNetworkApply) {
                    setCardStatus(prev => prev.map((s, i) => i === nodeIdx ? { loading: false, applied: false } : s));
                  }
                  message.error(`SSH polling timeout for ${node_ip}. Please check the node manually.`);
                  delete window.__cloudPolling[node_ip];
                  return;
                }
                
                fetch(`https://${hostIP}:2020/check-ssh-status?ip=${encodeURIComponent(node_ip)}`)
                  .then(res => res.json())
                  .then(data => {
                    if (data.status === 'success' && data.ip === node_ip) {
                      // Persist status to sessionStorage so it reflects on remount or in other menus
                      setCardStatusForIpInSession(node_ip, { loading: false, applied: true });
                      if (window.__cloudMountedNetworkApply) {
                        setCardStatus(prev => prev.map((s, i) => i === nodeIdx ? { loading: false, applied: true } : s));
                      }
                      message.success(`Node ${data.ip} is back online!`);
                      clearInterval(pollInterval);
                      delete window.__cloudPolling[node_ip];
                      if (window.__cloudPollingStart && window.__cloudPollingStart[node_ip]) {
                        delete window.__cloudPollingStart[node_ip];
                      }
                      // Store the form data for this node in sessionStorage
                      const nodeIp = form.ip || `node${nodeIdx + 1}`;
                      storeFormData(nodeIp, form);
                    } else if (data.status === 'fail' && data.ip === node_ip) {
                      if (cardStatus[nodeIdx]?.loading || !window.__cloudMountedNetworkApply) {
                        message.info('Node restarting...');
                      }
                    }
                  })
                  .catch(err => {
                    console.error('SSH status check failed:', err);
                  });
              }, 5000); // Check every 5 seconds
  
              // Store the interval reference globally (do not clear on unmount to allow background polling)
              if (!window.__cloudPolling) window.__cloudPolling = {};
              window.__cloudPolling[node_ip] = pollInterval;
            }, 90000); // Start polling after 90 seconds

            if (!window.__cloudPollingStart) window.__cloudPollingStart = {};
            window.__cloudPollingStart[node_ip] = startPollingTimeout;
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

    // Validate role combinations across nodes: require at least one node to match an allowed combo
    const hasAnyValidRoleNode = forms.some(f => isAllowedCombo(f.selectedRoles));
    if (!hasAnyValidRoleNode) {
      const invalidIps = new Set(forms.filter(f => !isAllowedCombo(f.selectedRoles)).map(f => f.ip));
      setForms(prev => prev.map(f => invalidIps.has(f.ip)
        ? { ...f, roleError: 'Choose a valid role model: Control+Storage (+Monitoring) (+Compute)' }
        : f
      ));
      setForceEnableRoles(prev => {
        const next = { ...prev };
        invalidIps.forEach(ip => { next[ip] = true; });
        return next;
      });
      message.error('Invalid role combination. Select one: Control+Storage, Control+Storage+Compute, Control+Storage+Monitoring, or Control+Storage+Monitoring+Compute.');
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

    const transformedConfigs = {};
    Object.entries(configs).forEach(([ip, form]) => {
      const base = buildDeployConfigPayload({ ...form, hostname: hostnameMap[ip] || form?.hostname });
      transformedConfigs[ip] = { ...base, server_vip: form?.vip || vip };
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
    // Each node must have: serverip, server_vip, Management, Storage, External_Traffic, VXLAN, license_code, license_type, license_period
    // Do NOT send a 'type' field from frontend; backend sets type='primary'.
    const nodes = Object.values(configs).map(form => ({
      serverip: form.ip,
      // Send all selected roles as a comma-separated string to store multiple roles in DB
      role: Array.isArray(form.selectedRoles) && form.selectedRoles.length > 0 ? form.selectedRoles.join(',') : 'child',
      server_vip: form.vip || vip,
      Management: form.tableData?.find(row => Array.isArray(row.type) ? row.type.includes('Management') : row.type === 'Management')?.ip || '',
      Storage: form.tableData?.find(row => Array.isArray(row.type) ? row.type.includes('Storage') : row.type === 'Storage')?.ip || '',
      External_Traffic: form.tableData?.find(row => Array.isArray(row.type) ? row.type.includes('External Traffic') : row.type === 'External Traffic')?.ip || '',
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
        } catch (_) {}
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
      {/* VIP input below Cloud Name */}
      <div style={{ marginTop: 12 }}>
        <Form layout="inline">
          <Form.Item
            label="Enter VIP"
            validateStatus={vipError ? 'error' : ''}
            help={vipError}
          >
            <Input
              style={{ width: 260 }}
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
      </div>
      <Divider />
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {forms.map((form, idx) => (
          <Spin spinning={cardStatus[idx]?.loading} tip="Applying network changes & restarting node...">
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
                <Button
                  onClick={() => fetchNodeData(form.ip)}
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
                  required
                  validateStatus={form.diskError ? 'error' : ''}
                  help={form.diskError}
                  style={{ minWidth: 220 }}
                >
                  <Select
                    mode="multiple"
                    allowClear
                    placeholder="Select disk(s)"
                    value={form.selectedDisks || []}
                    style={{ width: 200 }}
                    disabled={cardStatus[idx]?.loading || cardStatus[idx]?.applied}
                    onChange={value => handleDiskChange(idx, value)}
                    optionLabelProp="label"
                  >
                    {(nodeDisks[form.ip] || []).map(disk => (
                      <Option
                        key={disk.wwn || disk}
                        value={disk.wwn || disk}
                        label={disk.display || disk}
                      >
                        {disk.display || disk}
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

export default Deployment;