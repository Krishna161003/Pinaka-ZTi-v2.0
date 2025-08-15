import React, { useState, useEffect } from 'react';
import { Tabs } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import Zti from "../Components/Zti.jsx"
import Discovery from '../Components/Cloud/Discovery.jsx';
import NodeValidation from '../Components/Cloud/validate.jsx';
import LicenseActivation from '../Components/Cloud/licenseactivation.jsx';
import NetworkApply from '../Components/Cloud/networkapply.jsx';
import Report from '../Components/Cloud/report.jsx';
// Placeholder components for new tabs

const App = () => {
  // --- Persistent tab results state ---
  // Discovery tab results
  const [discoveryResults, setDiscoveryResults] = useState(() => {
    const saved = sessionStorage.getItem("cloud_discoveryResults");
    return saved ? JSON.parse(saved) : null;
  });
  // Validation tab results
  const [validationResults, setValidationResults] = useState(() => {
    const saved = sessionStorage.getItem("cloud_validationResults");
    return saved ? JSON.parse(saved) : null;
  });
  // License activation tab results
  const [licenseActivationResults, setLicenseActivationResults] = useState(() => {
    const saved = sessionStorage.getItem("cloud_licenseActivationResults");
    return saved ? JSON.parse(saved) : null;
  });
  // React Router hooks
  const location = useLocation();
  const navigate = useNavigate();

  // Initialize from sessionStorage or URL query param if available
  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab");
    if (tabParam) return tabParam;
    const savedTab = sessionStorage.getItem("cloud_activeTab");
    return savedTab || "1";
  }); // Only use cloud_activeTab for Cloud
  const [disabledTabs, setDisabledTabs] = useState(() => {
  const saved = sessionStorage.getItem("cloud_disabledTabs");
  const initial = saved ? JSON.parse(saved) : { "2": true, "3": true, "4": true };
  // Always disable tab 5 (Report)
  return { ...initial, "5": true };
});

  // Selected nodes for validation
  const [selectedNodes, setSelectedNodes] = useState(() => {
    const saved = sessionStorage.getItem("cloud_selectedNodes");
    return saved ? JSON.parse(saved) : [];
  });
  // Nodes that passed validation for license activation
  const [licenseNodes, setLicenseNodes] = useState(() => {
    const saved = sessionStorage.getItem("cloud_licenseNodes");
    return saved ? JSON.parse(saved) : [];
  });

  // Update URL when activeTab changes
  useEffect(() => {
    sessionStorage.setItem("cloud_activeTab", activeTab);
    // Only update if URL doesn't match
    const params = new URLSearchParams(location.search);
    if (params.get("tab") !== activeTab) {
      params.set("tab", activeTab);
      navigate({ search: params.toString() }, { replace: true });
    }
  }, [activeTab, location.search, navigate]);

  // Persist disabledTabs to sessionStorage
  useEffect(() => {
    sessionStorage.setItem("cloud_disabledTabs", JSON.stringify(disabledTabs));
  }, [disabledTabs]);

  // Auto-redirect to Report tab if child deployment is in progress
  useEffect(() => {
    const loginDetails = JSON.parse(sessionStorage.getItem("loginDetails"));
    const userId = loginDetails?.data?.id;
    if (!userId) return;
    const hostIP = window.location.hostname;
    fetch(`https://${hostIP}:5000/api/deployment-activity-log/latest-in-progress/secondary/${userId}`)
      .then(res => res.json())
      .then(data => {
        if (data.inProgress) {
          setActiveTab("5");
          setDisabledTabs({
            "1": true,
            "2": true,
            "3": true,
            "4": true,
            "5": false
          });
          // Update the URL to tab=5 if not already
          navigate("?tab=5", { replace: true });
        }
      })
      .catch(() => {});
  }, []);

  // When on Report tab (5), disable tabs 1-4
  useEffect(() => {
    if (activeTab === '5') {
      setDisabledTabs(prev => ({
        ...prev,
        '1': true,
        '2': true,
        '3': true,
        '4': true,
        '5': false,
      }));
    }
  }, [activeTab]);

  // Restore state on mount & on location.search change
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get("tab");
    const pathWithTab = `/addnode?tab=${tabParam || activeTab}`;
    // On mount, update lastZtiPath
    sessionStorage.setItem("lastZtiPath", pathWithTab);
    if (tabParam && tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
    const savedDisabled = sessionStorage.getItem("cloud_disabledTabs");
    if (savedDisabled) setDisabledTabs(JSON.parse(savedDisabled));
    return () => {
      // On unmount, save current path (with tab param) for menu memory
      const params = new URLSearchParams(location.search);
      const tabParam = params.get("tab") || activeTab;
      const pathWithTab = `/addnode?tab=${tabParam}`;
      sessionStorage.setItem("lastAddnodePath", pathWithTab);
      sessionStorage.setItem("lastMenuPath", pathWithTab); // For sidebar restore
      sessionStorage.setItem("addnode_activeTab", "1");
      sessionStorage.setItem("lastZtiPath", pathWithTab);
      // Optionally clear tab data if needed
      // sessionStorage.removeItem("cloud_selectedNodes");
      // sessionStorage.removeItem("cloud_licenseNodes");
    };
  }, [location.search]);

  // When Discovery Next is clicked, enable Validation tab and switch to it
  const handleDiscoveryNext = (nodes, results) => {
    // Append only newly selected nodes after already processed ones, preserving order
    const prev = Array.isArray(selectedNodes) ? selectedNodes : [];
    const uniqueNew = (Array.isArray(nodes) ? nodes : []).filter(n => !prev.some(p => p.ip === n.ip));
    const merged = [...prev, ...uniqueNew];
    setSelectedNodes(merged);
    sessionStorage.setItem("cloud_selectedNodes", JSON.stringify(merged));
    if (results) {
      setDiscoveryResults(results);
      sessionStorage.setItem("cloud_discoveryResults", JSON.stringify(results));
    }
    setDisabledTabs((prev) => ({ ...prev, "2": false }));
    setActiveTab("2");
  };

  // When Validation Next is clicked, enable License tab and switch to it
  const handleValidationNext = (passedNodes, results) => {
    // Append only newly validated nodes after existing licenseNodes
    const prev = Array.isArray(licenseNodes) ? licenseNodes : [];
    const uniqueNew = (Array.isArray(passedNodes) ? passedNodes : []).filter(n => !prev.some(p => p.ip === n.ip));
    const merged = [...prev, ...uniqueNew];
    setLicenseNodes(merged);
    sessionStorage.setItem("cloud_licenseNodes", JSON.stringify(merged));
    if (results) {
      const prevRes = Array.isArray(validationResults) ? validationResults : [];
      const incoming = Array.isArray(results) ? results : [];
      const uniqueNewRes = incoming.filter(r => !prevRes.some(p => p?.ip === r?.ip));
      const mergedRes = [...prevRes, ...uniqueNewRes];
      setValidationResults(mergedRes);
      sessionStorage.setItem("cloud_validationResults", JSON.stringify(mergedRes));
    }
    setDisabledTabs((prev) => ({ ...prev, "3": false }));
    setActiveTab("3");
  };

  // When License Activation completes, save results
  const handleLicenseActivation = (results) => {
    const prev = Array.isArray(licenseActivationResults) ? licenseActivationResults : [];
    const incoming = Array.isArray(results) ? results : [];
    const uniqueNew = incoming.filter(r => !prev.some(p => p?.ip === r?.ip));
    const merged = [...prev, ...uniqueNew];
    setLicenseActivationResults(merged);
    sessionStorage.setItem("cloud_licenseActivationResults", JSON.stringify(merged));
  };

  // When user manually clicks a tab
  const handleTabChange = (key) => {
    setActiveTab(key);
  };

  // On mount, save last visited menu path for Zti main menu
  useEffect(() => {
    sessionStorage.setItem("lastMenuPath", window.location.pathname + window.location.search);
  }, []);

  return (
    <Zti>
      <h2>Add Node</h2>
      <Tabs activeKey={activeTab} onChange={(key) => setActiveTab(key)}>
        <Tabs.TabPane tab="Discovery" key="1" disabled={disabledTabs["1"]}>
          {/*
            Pass discoveryResults and setDiscoveryResults to Discovery.
            In Discovery, use discoveryResults as the source of truth for results.
            When scan completes, call props.onNext(nodes, results) and props.setDiscoveryResults(newResults).
          */}
          <Discovery
            onNext={handleDiscoveryNext}
            results={discoveryResults}
            setResults={(results) => {
              setDiscoveryResults(results);
              sessionStorage.setItem("cloud_discoveryResults", JSON.stringify(results));
            }}
          />
        </Tabs.TabPane>
        <Tabs.TabPane tab="Node Validation" key="2" disabled={disabledTabs["2"]}>
          {/*
            Pass validationResults and setValidationResults to NodeValidation.
            In NodeValidation, use validationResults as the source of truth for results.
            When validation completes, call props.onNext(passedNodes, results) and props.setValidationResults(newResults).
          */}
          <NodeValidation
            nodes={selectedNodes}
            onNext={handleValidationNext}
            results={validationResults}
            setResults={(results) => {
              const prevRes = Array.isArray(validationResults) ? validationResults : [];
              const incoming = Array.isArray(results) ? results : [];
              const uniqueNewRes = incoming.filter(r => !prevRes.some(p => p?.ip === r?.ip));
              const mergedRes = [...prevRes, ...uniqueNewRes];
              setValidationResults(mergedRes);
              sessionStorage.setItem("cloud_validationResults", JSON.stringify(mergedRes));
            }}
          />
        </Tabs.TabPane>
        <Tabs.TabPane tab="License Activate" key="3" disabled={disabledTabs["3"]}>
          {/*
            Pass licenseActivationResults and setLicenseActivationResults to LicenseActivation.
            In LicenseActivation, use licenseActivationResults as the source of truth for results.
            When activation completes, call props.onActivate(results) and props.setResults(newResults).
          */}
          <LicenseActivation
            nodes={licenseNodes}
            results={licenseActivationResults}
            setResults={handleLicenseActivation}
            onNext={successfulNodes => {
              // Append newly activated nodes after existing ones
              const prev = Array.isArray(licenseNodes) ? licenseNodes : [];
              const uniqueNew = (Array.isArray(successfulNodes) ? successfulNodes : []).filter(n => !prev.some(p => p.ip === n.ip));
              const merged = [...prev, ...uniqueNew];
              setLicenseNodes(merged);
              sessionStorage.setItem("cloud_licenseNodes", JSON.stringify(merged));
              setDisabledTabs(prevState => ({ ...prevState, "4": false }));
              setTimeout(() => setActiveTab("4"), 0);
            }}
            onRemoveNode={(ip, removedRecord, removedIndex) => {
              // Remove from licenseNodes (source for LicenseActivation)
              setLicenseNodes(prev => {
                const next = prev.filter(n => n.ip !== ip);
                try { sessionStorage.setItem('cloud_licenseNodes', JSON.stringify(next)); } catch(_) {}
                return next;
              });
              // Also remove from selectedNodes so Validation input reflects it
              setSelectedNodes(prev => {
                const next = prev.filter(n => n.ip !== ip);
                try { sessionStorage.setItem('cloud_selectedNodes', JSON.stringify(next)); } catch(_) {}
                return next;
              });
            }}
            onUndoRemoveNode={(ip, record, index) => {
              // Restore into licenseNodes at original index
              setLicenseNodes(prev => {
                const arr = [...prev];
                const idx = Math.min(Math.max(index ?? arr.length, 0), arr.length);
                if (!arr.some(n => n.ip === ip)) {
                  arr.splice(idx, 0, { ip, ...(record || {}) });
                  try { sessionStorage.setItem('cloud_licenseNodes', JSON.stringify(arr)); } catch(_) {}
                }
                return arr;
              });
              // Restore into selectedNodes (Validation input)
              setSelectedNodes(prev => {
                const arr = [...prev];
                const idx = Math.min(Math.max(index ?? arr.length, 0), arr.length);
                if (!arr.some(n => n.ip === ip)) {
                  arr.splice(idx, 0, { ip, ...(record || {}) });
                  try { sessionStorage.setItem('cloud_selectedNodes', JSON.stringify(arr)); } catch(_) {}
                }
                return arr;
              });
            }}
          />
        </Tabs.TabPane>
        <Tabs.TabPane tab="Network Apply" key="4" disabled={disabledTabs["4"]}>
          <NetworkApply onGoToReport={() => {
            // Enable tab 5 and navigate without full reload
            setDisabledTabs(prev => ({ ...prev, '5': false }));
            setActiveTab('5');
            const params = new URLSearchParams(location.search);
            params.set('tab', '5');
            navigate({ search: params.toString() }, { replace: true });
          }}
          onRemoveNode={(ip, removedRecord, removedIndex) => {
            // Remove from licenseNodes (source for LicenseActivation & NetworkApply)
            setLicenseNodes(prev => {
              const next = prev.filter(n => n.ip !== ip);
              try { sessionStorage.setItem('cloud_licenseNodes', JSON.stringify(next)); } catch(_) {}
              return next;
            });
            // Also remove from selectedNodes so Validation input reflects it
            setSelectedNodes(prev => {
              const next = prev.filter(n => n.ip !== ip);
              try { sessionStorage.setItem('cloud_selectedNodes', JSON.stringify(next)); } catch(_) {}
              return next;
            });
          }}
          onUndoRemoveNode={(ip, record, index) => {
            // Restore into licenseNodes at original index
            setLicenseNodes(prev => {
              const arr = [...prev];
              const idx = Math.min(Math.max(index ?? arr.length, 0), arr.length);
              if (!arr.some(n => n.ip === ip)) {
                arr.splice(idx, 0, { ip, ...(record || {}) });
                try { sessionStorage.setItem('cloud_licenseNodes', JSON.stringify(arr)); } catch(_) {}
              }
              return arr;
            });
            // Restore into selectedNodes (Validation input)
            setSelectedNodes(prev => {
              const arr = [...prev];
              const idx = Math.min(Math.max(index ?? arr.length, 0), arr.length);
              if (!arr.some(n => n.ip === ip)) {
                arr.splice(idx, 0, { ip, ...(record || {}) });
                try { sessionStorage.setItem('cloud_selectedNodes', JSON.stringify(arr)); } catch(_) {}
              }
              return arr;
            });
          }}
          />
        </Tabs.TabPane>
        <Tabs.TabPane tab="Report" key="5" disabled={disabledTabs["5"]}>
          <Report />
        </Tabs.TabPane>
      </Tabs>
    </Zti>
  );
};

export default App;
