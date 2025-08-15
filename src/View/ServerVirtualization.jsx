import React, { useState, useEffect } from "react";
import { Tabs, message } from "antd";
import { useLocation, useNavigate } from "react-router-dom";
import Zti from "../Components/Zti";
import DeploymentOptions from "../Components/ServerVirtualization/Deployop";
import Discovery from "../Components/ServerVirtualization/NwtScan";
import Validation from "../Components/ServerVirtualization/Validate";
import Report from "../Components/ServerVirtualization/Report";
import ActivateKey from "../Components/ServerVirtualization/ActivateKey";
import Deployment from "../Components/ServerVirtualization/Deployment";

const App = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab");
    if (tabParam) return tabParam;
    const savedTab = sessionStorage.getItem("serverVirtualization_activeTab");
    return savedTab || "1";
  });
  const [disabledTabs, setDisabledTabs] = useState(() => {
    const saved = sessionStorage.getItem("serverVirtualization_disabledTabs");
    return saved ? JSON.parse(saved) : { "2": true, "3": true, "4": true, "5": true, "6": true };
  });

  const hostIP = window.location.hostname;
  // Auto-redirect to Report tab if deployment in progress
  useEffect(() => {
    // Use loginDetails for user ID
    const loginDetails = JSON.parse(sessionStorage.getItem("loginDetails"));
    const userId = loginDetails?.data?.id;
    if (!userId) return;
    fetch(`https://${hostIP}:5000/api/deployment-activity-log/latest-in-progress/${userId}`)
      .then(res => res.json())
      .then(data => {
        if (data.inProgress) {
          setActiveTab("6");
          setDisabledTabs({
            "1": true,
            "2": true,
            "3": true,
            "4": true,
            "5": true,
            "6": false
          });
          // Update the URL to tab=6 if not already
          navigate("?tab=6", { replace: true });
        }
      })
    }, []);

  // ... rest of your code ...

  // Update URL and sessionStorage when activeTab changes
  useEffect(() => {
    sessionStorage.setItem("serverVirtualization_activeTab", activeTab);
    const pathWithTab = `/servervirtualization?tab=${activeTab}`;
    sessionStorage.setItem("lastServerVirtualizationPath", pathWithTab);
    sessionStorage.setItem("lastMenuPath", pathWithTab);
    sessionStorage.setItem("lastZtiPath", pathWithTab);
    // Only update if URL doesn't match
    const params = new URLSearchParams(location.search);
    if (params.get("tab") !== activeTab) {
      params.set("tab", activeTab);
      navigate({ search: params.toString() }, { replace: true });
    }
  }, [activeTab, location.search, navigate]);

  // Persist disabledTabs to sessionStorage
  useEffect(() => {
    sessionStorage.setItem("serverVirtualization_disabledTabs", JSON.stringify(disabledTabs));
  }, [disabledTabs]);

  // Restore state on mount & on location.search change
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get("tab");
    const pathWithTab = `/servervirtualization?tab=${tabParam || activeTab}`;
    sessionStorage.setItem("lastZtiPath", pathWithTab);
    if (tabParam && tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
    const savedDisabled = sessionStorage.getItem("serverVirtualization_disabledTabs");
    if (savedDisabled) setDisabledTabs(JSON.parse(savedDisabled));
    return () => {
      // On unmount, save current path (with tab param) for menu memory
      const params = new URLSearchParams(location.search);
      const tabParam = params.get("tab") || activeTab;
      const pathWithTab = `/servervirtualization?tab=${tabParam}`;
      sessionStorage.setItem("lastServerVirtualizationPath", pathWithTab);
      sessionStorage.setItem("lastMenuPath", pathWithTab);
      sessionStorage.setItem("lastZtiPath", pathWithTab);
      // DO NOT reset serverVirtualization_activeTab to '1'
    };
  }, [location.search]);



  // Only set defaults if not present in sessionStorage
  useEffect(() => {
    const saved = sessionStorage.getItem("disabledTabs");
    if (saved) {
      setDisabledTabs(JSON.parse(saved));
    } else {
      const defaults = { "2": true, "3": true, "4": true, "5": true, "6": true };
      setDisabledTabs(defaults);
      sessionStorage.setItem("disabledTabs", JSON.stringify(defaults));
    }
  }, []);

  const [selectedNodes, setSelectedNodes] = useState([]);
  const [validatedNodes, setValidatedNodes] = useState([]);
  const [ibn, setIbn] = useState("");

  // --- RESET LOGIC: Only if flag is set and user is returning from another menu ---
  useEffect(() => {
    const shouldReset = sessionStorage.getItem('serverVirtualization_shouldResetOnNextMount') === 'true';
    const lastMenuPath = sessionStorage.getItem('lastMenuPath') || '';
    if (shouldReset && !lastMenuPath.includes('/servervirtualization')) {
      setActiveTab('1');
      const defaults = { "2": true, "3": true, "4": true, "5": true, "6": true };
      setDisabledTabs(defaults);
      sessionStorage.setItem("serverVirtualization_activeTab", '1');
      sessionStorage.setItem("serverVirtualization_disabledTabs", JSON.stringify(defaults));
      sessionStorage.setItem("disabledTabs", JSON.stringify(defaults));
      sessionStorage.removeItem('serverVirtualization_shouldResetOnNextMount');
      return; // Do not restore state if reset
    }
  }, [location.search]);

  // On component mount, restore disabledTabs and other state, but NOT activeTab!
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tabKey = params.get("tab") || activeTab;
    const pathWithTab = `/servervirtualization?tab=${tabKey}`;
    sessionStorage.setItem("lastZtiPath", pathWithTab);

    // Restore disabledTabs from sessionStorage if present
    const savedDisabledTabs = sessionStorage.getItem("disabledTabs");
    let parsedDisabledTabs = savedDisabledTabs ? JSON.parse(savedDisabledTabs) : null;
    // If last active tab was Report, ensure tab 1 stays disabled
    if (tabKey === "6") {
      parsedDisabledTabs = { ...(parsedDisabledTabs || {}), "1": true, "6": false };
    }
    if (parsedDisabledTabs) setDisabledTabs(parsedDisabledTabs);

    const savedNodes = sessionStorage.getItem("selectedNodes");
    const savedIbn = sessionStorage.getItem("ibn");

    if (savedNodes) setSelectedNodes(JSON.parse(savedNodes));
    if (savedIbn) setIbn(savedIbn);
    // DO NOT setActiveTab here!
  }, [location.search, activeTab]);

  useEffect(() => {
    sessionStorage.setItem("disabledTabs", JSON.stringify(disabledTabs));
  }, [disabledTabs]);

  const handleTabChange = (key) => {
    // Prevent navigating away from Deployment Options if an environment is already deployed.
    // This protects against DOM inspection hacks removing disabled attributes.
    try {
      const deployedLock = sessionStorage.getItem('sv_hostDeployed') === 'true';
      if (deployedLock && key !== '1') {
        message.warning('This environment is already deployed. Navigation is restricted.');
        // Ensure URL reflects tab 1 to avoid desync
        const params = new URLSearchParams(location.search);
        if (params.get('tab') !== '1') {
          params.set('tab', '1');
          navigate({ search: params.toString() }, { replace: true });
        }
        setActiveTab('1');
        return;
      }
    } catch (_) { /* ignore */ }
    setActiveTab(key);
    // All session/URL sync is handled by the effect above
  };

  // Handler to enable only Validation tab after Deployment Option modal is confirmed
  const handleDeploymentStart = (cloudName) => {
    // Reset flow-related session keys to avoid stale state affecting a new run
    try {
      const keysToClear = [
        'selectedNodes',
        'validatedNodes',
        'sv_licenseStatus',
        'sv_licenseNodes',
        'sv_licenseActivationResults',
        'sv_networkApplyCardStatus',
        'sv_networkApplyForms',
        'sv_networkApplyResult',
        'sv_networkApplyRestartEndTimes',
        'sv_networkApplyBootEndTimes',
      ];
      keysToClear.forEach(k => sessionStorage.removeItem(k));
    } catch (_) {}

    const nextDisabled = {
      "2": false, // Enable Discovery (tab 2)
      "3": true,
      "4": true,
      "5": true,
      "6": true,
      "1": false,
    };
    setDisabledTabs(nextDisabled);
    sessionStorage.setItem("serverVirtualization_disabledTabs", JSON.stringify(nextDisabled));
    sessionStorage.setItem("disabledTabs", JSON.stringify(nextDisabled));
    setActiveTab("2"); // Optionally switch to Validation tab
    // Optionally store cloudName if needed
  };

  const handleIbnUpdate = (newIbn) => {
    setIbn(newIbn);
    sessionStorage.setItem("ibn", newIbn); // Persist to sessionStorage
    setDisabledTabs((prevState) => ({
      ...prevState,
      "4": false,
    }));
  };

  return (
    <Zti>
      <h2 style={{ userSelect: "none" }}>Server Virtualization</h2>
      <Tabs
        destroyInactiveTabPane={true}
        activeKey={activeTab}
        onChange={handleTabChange}
      >
        <Tabs.TabPane tab="Deployment Options" key="1" disabled={disabledTabs["1"]}>
          <DeploymentOptions onStart={handleDeploymentStart} />
        </Tabs.TabPane>
        <Tabs.TabPane tab="Discovery" key="2" disabled={disabledTabs["2"]}>
          <Discovery next={(nodes) => {
            // nodes are selected node objects from scan
            if (!nodes || nodes.length === 0) {
              message.warning('Please select at least one node.');
              return;
            }
            // Append newly selected nodes after existing ones, avoid duplicates by IP
            const prev = Array.isArray(selectedNodes) ? selectedNodes : [];
            const uniqueNew = (Array.isArray(nodes) ? nodes : []).filter(n => !prev.some(p => p.ip === n.ip));
            const merged = [...prev, ...uniqueNew];
            setSelectedNodes(merged);
            sessionStorage.setItem('selectedNodes', JSON.stringify(merged));
            setDisabledTabs(prev => {
              const updated = { ...prev, "2": false, "3": false };
              sessionStorage.setItem("serverVirtualization_disabledTabs", JSON.stringify(updated));
              sessionStorage.setItem("disabledTabs", JSON.stringify(updated));
              return updated;
            });
            setActiveTab("3");
          }} />
        </Tabs.TabPane>
        <Tabs.TabPane tab="Validation" key="3" disabled={disabledTabs["3"]}>
          <Validation
            nodes={selectedNodes}
            next={(passed /* array of nodes that passed */, allRows) => {
              const passedNodes = passed || [];
              if (passedNodes.length === 0) {
                message.error('Please ensure at least one node passes validation.');
                return;
              }
              // Append only newly validated nodes after existing validatedNodes
              const prev = Array.isArray(validatedNodes) ? validatedNodes : [];
              const uniqueNew = passedNodes.filter(n => !prev.some(p => p.ip === n.ip));
              const merged = [...prev, ...uniqueNew];
              setValidatedNodes(merged);
              sessionStorage.setItem('validatedNodes', JSON.stringify(merged));
              setDisabledTabs((prev) => {
                const updated = { ...prev, "4": false };
                sessionStorage.setItem("serverVirtualization_disabledTabs", JSON.stringify(updated));
                sessionStorage.setItem("disabledTabs", JSON.stringify(updated));
                return updated;
              });
              setActiveTab("4");
            }}
            onValidationResult={(result) => {
              if (result === "failed") {
                setDisabledTabs({
                  "2": false,
                  "3": false,
                  "4": true,
                  "5": true,
                  "6": true,
                });
              }
            }}
          />
        </Tabs.TabPane>
        <Tabs.TabPane tab="Activate Key" key="4" disabled={disabledTabs["4"]}>
          <ActivateKey
            nodes={validatedNodes}
            next={(successfulNodes = []) => {
              if (!Array.isArray(successfulNodes) || successfulNodes.length === 0) {
                message.warning('Please activate license for at least one node to proceed.');
                return;
              }
              // Persist nodes for Deployment.js consumption
              try {
                const prevLNRaw = sessionStorage.getItem('sv_licenseNodes');
                const prevLN = prevLNRaw ? JSON.parse(prevLNRaw) : [];
                const uniqueNewLN = successfulNodes
                  .map(n => ({ ip: n.ip }))
                  .filter(n => !Array.isArray(prevLN) || !prevLN.some(p => p.ip === n.ip));
                const mergedLN = Array.isArray(prevLN) ? [...prevLN, ...uniqueNewLN] : uniqueNewLN;
                sessionStorage.setItem('sv_licenseNodes', JSON.stringify(mergedLN));
              } catch (_) {
                const fallback = successfulNodes.map(n => ({ ip: n.ip }));
                sessionStorage.setItem('sv_licenseNodes', JSON.stringify(fallback));
              }
              // Build sv_licenseActivationResults array from per-IP map stored by ActivateKey
              try {
                const mapRaw = sessionStorage.getItem('sv_licenseStatus');
                const map = mapRaw ? JSON.parse(mapRaw) : {};
                const prevArrRaw = sessionStorage.getItem('sv_licenseActivationResults');
                const prevArr = prevArrRaw ? JSON.parse(prevArrRaw) : [];
                const newEntries = successfulNodes
                  .filter(n => !Array.isArray(prevArr) || !prevArr.some(p => p?.ip === n.ip))
                  .map(n => ({ ip: n.ip, details: map[n.ip] || {} }));
                const mergedArr = Array.isArray(prevArr) ? [...prevArr, ...newEntries] : newEntries;
                sessionStorage.setItem('sv_licenseActivationResults', JSON.stringify(mergedArr));
              } catch (_) {}
              setDisabledTabs(prev => {
                const updated = { ...prev, "5": false };
                sessionStorage.setItem("serverVirtualization_disabledTabs", JSON.stringify(updated));
                sessionStorage.setItem("disabledTabs", JSON.stringify(updated));
                return updated;
              });
              setActiveTab("5");
            }}
            onValidationResult={(result) => {
              if (result === "failed") {
                setDisabledTabs(prev => ({
                  ...prev,
                  "5": true
                }));
              }
            }}
            onRemoveNode={(ip, removedRecord, removedIndex) => {
              // Remove from validatedNodes (source for ActivateKey)
              setValidatedNodes(prev => {
                const next = prev.filter(n => n.ip !== ip);
                try { sessionStorage.setItem('validatedNodes', JSON.stringify(next)); } catch(_) {}
                return next;
              });
              // Also remove from selectedNodes so Validation tab reflects it
              setSelectedNodes(prev => {
                const next = prev.filter(n => n.ip !== ip);
                try { sessionStorage.setItem('selectedNodes', JSON.stringify(next)); } catch(_) {}
                return next;
              });
            }}
            onUndoRemoveNode={(ip, record, index) => {
              // Restore into validatedNodes at original index
              setValidatedNodes(prev => {
                const arr = [...prev];
                const idx = Math.min(Math.max(index ?? arr.length, 0), arr.length);
                // Avoid duplicates if already present
                if (!arr.some(n => n.ip === ip)) {
                  arr.splice(idx, 0, { ip, ...(record || {}) });
                  try { sessionStorage.setItem('validatedNodes', JSON.stringify(arr)); } catch(_) {}
                }
                return arr;
              });
              // Restore into selectedNodes (Validation input)
              setSelectedNodes(prev => {
                const arr = [...prev];
                if (!arr.some(n => n.ip === ip)) {
                  const idx = Math.min(Math.max(index ?? arr.length, 0), arr.length);
                  arr.splice(idx, 0, { ip, ...(record || {}) });
                  try { sessionStorage.setItem('selectedNodes', JSON.stringify(arr)); } catch(_) {}
                }
                return arr;
              });
            }}
          />
        </Tabs.TabPane>
        <Tabs.TabPane tab="Deployment" key="5" disabled={disabledTabs["5"]}>
          <Deployment
            onGoToReport={() => {
              const updated = { "1": true, "2": true, "3": true, "4": true, "5": true, "6": false };
              setDisabledTabs(updated);
              sessionStorage.setItem("serverVirtualization_disabledTabs", JSON.stringify(updated));
              sessionStorage.setItem("disabledTabs", JSON.stringify(updated));
              setActiveTab("6");
            }}
            onRemoveNode={(ip, removedRecord, removedIndex) => {
              // Remove from validatedNodes (source for ActivateKey)
              setValidatedNodes(prev => {
                const next = prev.filter(n => n.ip !== ip);
                try { sessionStorage.setItem('validatedNodes', JSON.stringify(next)); } catch(_) {}
                return next;
              });
              // Also remove from selectedNodes so Validation tab reflects it
              setSelectedNodes(prev => {
                const next = prev.filter(n => n.ip !== ip);
                try { sessionStorage.setItem('selectedNodes', JSON.stringify(next)); } catch(_) {}
                return next;
              });
            }}
            onUndoRemoveNode={(ip, record, index) => {
              // Restore into validatedNodes at original index
              setValidatedNodes(prev => {
                const arr = [...prev];
                const idx = Math.min(Math.max(index ?? arr.length, 0), arr.length);
                // Avoid duplicates if already present
                if (!arr.some(n => n.ip === ip)) {
                  arr.splice(idx, 0, { ip, ...(record || {}) });
                  try { sessionStorage.setItem('validatedNodes', JSON.stringify(arr)); } catch(_) {}
                }
                return arr;
              });
              // Restore into selectedNodes (Validation input)
              setSelectedNodes(prev => {
                const arr = [...prev];
                if (!arr.some(n => n.ip === ip)) {
                  const idx = Math.min(Math.max(index ?? arr.length, 0), arr.length);
                  arr.splice(idx, 0, { ip, ...(record || {}) });
                  try { sessionStorage.setItem('selectedNodes', JSON.stringify(arr)); } catch(_) {}
                }
                return arr;
              });
            }}
          />
        </Tabs.TabPane>
        <Tabs.TabPane tab="Report" key="6" disabled={disabledTabs["6"]}>
          <Report ibn={ibn} />
        </Tabs.TabPane>
      </Tabs>
    </Zti>
  );
};

export default App;
