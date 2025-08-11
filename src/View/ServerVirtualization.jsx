import React, { useState, useEffect } from "react";
import { Tabs } from "antd";
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
    setActiveTab(key);
    // All session/URL sync is handled by the effect above
  };

  // Handler to enable only Validation tab after Deployment Option modal is confirmed
  const handleDeploymentStart = (cloudName) => {
    setDisabledTabs({
      "2": false, // Enable Validation
      "3": true,
      "4": true,
      "5": true,
      "6": true,
    });
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
        <Tabs.TabPane tab="Validation" key="2" disabled={disabledTabs["2"]}>
          <Validation
            next={() => {
              setDisabledTabs((prev) => ({ ...prev, "3": false }));
              setActiveTab("3");
            }}
            onValidationResult={(result) => {
              if (result === "failed") {
                setDisabledTabs({
                  "2": false,
                  "3": true,
                  "4": true,
                  "5": true,
                  "6": true,
                });
              }
            }}
          />
        </Tabs.TabPane>
        <Tabs.TabPane tab="System Interface" key="3" disabled={disabledTabs["3"]}>
          <Discovery next={() => {
            setDisabledTabs(prev => ({
              ...prev,
              "2": false,
              "3": false,
              "4": false
            }));
            setActiveTab("4");
          }} />
        </Tabs.TabPane>
        <Tabs.TabPane tab="Activate Key" key="4" disabled={disabledTabs["4"]}>
          <ActivateKey
            next={() => {
              setDisabledTabs(prev => ({
                ...prev,
                "5": false
              }));
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
          />
        </Tabs.TabPane>
        <Tabs.TabPane tab="Deployment" key="5" disabled={disabledTabs["5"]}>
          <Deployment next={() => {
            setDisabledTabs({
              "1": true,
              "2": true,
              "3": true,
              "4": true,
              "5": true,
              "6": false
            });
            setActiveTab("6");
          }} />
        </Tabs.TabPane>
        <Tabs.TabPane tab="Report" key="6" disabled={disabledTabs["6"]}>
          <Report ibn={ibn} />
        </Tabs.TabPane>
      </Tabs>
    </Zti>
  );
};

export default App;
