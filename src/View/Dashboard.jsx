import React, { useState, useEffect, useRef } from "react";
import Layout1 from "../Components/layout";
import { theme, Layout, Spin, Row, Col, Divider, Select, Table, Badge, Input, message } from "antd";
import { useNavigate } from "react-router-dom";
import PasswordUpdateForm from "../Components/PasswordUpdateForm";
import node from "../Images/database_666406.png";
import cloud from "../Images/cloud-computing_660475.png";
import squad from "../Images/database_2231963.png";
import { Area, Line } from '@ant-design/plots';
import axios from "axios";

const hostIP = window.location.hostname;

const style = {
  background: '#fff',
  padding: '16px 20px', // Reduced vertical padding for shorter Col height
  marginTop: '19px',
  marginRight: '25px',
  // borderRadius: '10px',
  cursor: 'pointer',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
  transition: 'all 0.3s ease',
};

const performancewidgetStyle = {
  background: '#fff',
  padding: '16px 20px', // Reduced vertical padding for shorter Col height
  marginTop: '19px',
  marginRight: '25px',
  // borderRadius: '10px',
  cursor: 'pointer',
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
  transition: 'all 0.3s ease',
};

const dockerwidgetStyle = {
  background: '#fff',
  padding: '16px 20px', // Reduced vertical padding for shorter Col height
  marginTop: '4px',
  marginRight: '25px',
  // borderRadius: '10px',
  cursor: 'pointer',
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
  transition: 'all 0.3s ease',
  height: '50px',
};

const hoverStyle = {
  ...style,
  transform: 'translateY(-3px)',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
};



const { Content } = Layout;

const Dashboard = () => {
  // For error notification on backend fetch failure
  const lastErrorIpRef = useRef(null);
  // Node SSH status
  const [nodeStatus, setNodeStatus] = useState('Loading');

  // --- CPU & Memory Utilization State ---
  const [cpuData, setCpuData] = useState(0);
  const [cpuHistory, setCpuHistory] = useState([]);
  const [interfaces, setInterfaces] = useState([]);
  const [selectedInterface, setSelectedInterface] = useState("");
  const [bandwidthHistory, setBandwidthHistory] = useState([]);
  const [currentBandwidth, setCurrentBandwidth] = useState(0);
  const [chartData, setChartData] = useState([]);
  const [healthStatus, setHealthStatus] = useState("Loading");
  const [memoryData, setMemoryData] = useState(0);
  const [totalMemory, setTotalMemory] = useState(0);
  const [usedMemory, setUsedMemory] = useState(0);

  // Host IP dropdown state (dynamic from backend Host and child_node tables)
  const [hostIpOptions, setHostIpOptions] = useState([]);
  const [selectedHostIP, setSelectedHostIP] = useState(window.location.hostname);

  // Fetch unique server IPs from Host and child_node tables
  useEffect(() => {
    
    async function fetchServerIps() {
      try {
        const userId = JSON.parse(sessionStorage.getItem('loginDetails'))?.data?.id;
        const hostsRes = await fetch(`https://${hostIP}:5000/api/hosts${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`);
        const hosts = await hostsRes.json();
        const childrenRes = await fetch(`https://${hostIP}:5000/api/child-nodes${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`);
        const children = await childrenRes.json();
        const ips = new Set();
        if (Array.isArray(hosts)) {
          hosts.forEach(h => { if (h && h.serverip) ips.add(h.serverip); });
        }
        if (Array.isArray(children)) {
          children.forEach(c => { if (c && c.serverip) ips.add(c.serverip); });
        }
        let uniqueIps = Array.from(ips);
        if (uniqueIps.length === 0) {
          uniqueIps = [window.location.hostname];
        }
        setHostIpOptions(uniqueIps);
        // Keep current selection if still valid; otherwise default to first available or hostname
        if (!uniqueIps.includes(selectedHostIP)) {
          setSelectedHostIP(uniqueIps[0] || window.location.hostname);
        }
      } catch (e) {
        // Fallback to current hostname if fetch fails
        setHostIpOptions([window.location.hostname]);
        setSelectedHostIP(prev => prev || window.location.hostname);
      }
    }
    fetchServerIps();
  }, []);

  // Fetch CPU and Memory time series for Area charts
  const [memoryHistory, setMemoryHistory] = useState([]);
  useEffect(() => {
    async function fetchHistory() {
      try {
        const res = await fetch(`https://${selectedHostIP}:2020/system-utilization-history`);
        const data = await res.json();
        if (data && Array.isArray(data.cpu_history)) {
          setCpuHistory(
            data.cpu_history.map(item => {
              const cpuVal = typeof item.cpu === 'number' && !isNaN(item.cpu) ? item.cpu : 0;
              return {
                date: new Date(item.timestamp * 1000),
                cpu: cpuVal
              };
            })
          );
        } else {
          setCpuHistory([]);
        }
        if (data && Array.isArray(data.memory_history)) {
          setMemoryHistory(
            data.memory_history.map(item => {
              const memVal = typeof item.memory === 'number' && !isNaN(item.memory) ? item.memory : 0;
              return {
                date: new Date(item.timestamp * 1000),
                memory: memVal
              };
            })
          );
        } else {
          setMemoryHistory([]);
        }
      } catch (err) {
        setCpuHistory([]);
        setMemoryHistory([]);
        if (lastErrorIpRef.current !== selectedHostIP) {
          message.error(`Failed to fetch system utilization history from ${selectedHostIP}`);
          lastErrorIpRef.current = selectedHostIP;
        }
      }
    }
    fetchHistory();
    const interval = setInterval(fetchHistory, 10000);
    return () => clearInterval(interval);
  }, [selectedHostIP]);


  const memoryconfig = {
    data: memoryHistory,
    xField: 'date',
    yField: 'memory',
    smooth: true,
    // Set the solid or semi-transparent fill color:
    style: {
      fill: '#8fd98f',
    },
    // Optional: make the line match the fill color
    // line: {
    //   color: '#4CAF50',     // darker green
    //   size: 1.5,
    // },
    // Hide axes/ticks if desired
    xAxis: false,
    // yAxis: false,
    // tooltip: false,
    height: 180,
  };

  // Helper: Moving average smoothing for bandwidth
  function getSmoothedBandwidthHistory(history, windowSize = 5) {
    if (!Array.isArray(history) || history.length === 0) return [];
    const smoothed = [];
    for (let i = 0; i < history.length; i++) {
      let start = Math.max(0, i - windowSize + 1);
      let window = history.slice(start, i + 1);
      let avg = window.reduce((sum, item) => sum + (typeof item.value === 'number' ? item.value : 0), 0) / window.length;
      smoothed.push({ ...history[i], value: avg });
    }
    return smoothed;
  }


  const BandwidthLine = ({ bandwidthHistory }) => {
    const config = {
      data: bandwidthHistory,
      width: 280,
      height: 110,
      smooth: true,
      xField: 'date',
      yField: 'value',
      lineStyle: {
        stroke: '#52c41a',
        lineWidth: 2,
      },
      label: {
        selector: 'last',
        text: (d) => d.value,
        textAlign: 'right',
        textBaseline: 'bottom',
        dx: -10,
        dy: -10,
        connector: true,
        style: { fontSize: 10 },
      },
    };
    return <Line {...config} />;
  };



  // Still fetch memory and single CPU value for other UI
  useEffect(() => {
    async function fetchUtilization() {
      try {
        const res = await fetch(`https://${selectedHostIP}:2020/system-utilization`);
        const data = await res.json();
        if (
          data.error ||
          typeof data.cpu !== 'number' || isNaN(data.cpu) ||
          typeof data.memory !== 'number' || isNaN(data.memory) ||
          typeof data.total_memory !== 'number' || isNaN(data.total_memory) ||
          typeof data.used_memory !== 'number' || isNaN(data.used_memory)
        ) {
          setCpuData(0);
          setMemoryData(0);
          setTotalMemory(0);
          setUsedMemory(0);
        } else {
          setCpuData(data.cpu);
          setMemoryData(data.memory);
          setTotalMemory(data.total_memory);
          setUsedMemory(data.used_memory);
        }
      } catch (err) {
        setCpuData(0);
        setMemoryData(0);
        setTotalMemory(0);
        setUsedMemory(0);
        if (lastErrorIpRef.current !== selectedHostIP) {
          message.error(`Failed to fetch system utilization from ${selectedHostIP}`);
          lastErrorIpRef.current = selectedHostIP;
        }
      }
    }
    fetchUtilization();
    const interval = setInterval(fetchUtilization, 10000);
    return () => clearInterval(interval);
  }, [selectedHostIP]);

  useEffect(() => {
    fetch(`https://${selectedHostIP}:2020/interfaces`)
      .then(res => res.json())
      .then(data => {
        setInterfaces(data);
        if (data && data.length > 0) {
          setSelectedInterface(data[0].value);
        }
      })
      .catch(() => {
        if (lastErrorIpRef.current !== selectedHostIP) {
          message.error(`Failed to fetch interfaces from ${selectedHostIP}`);
          lastErrorIpRef.current = selectedHostIP;
        }
      });
  }, [selectedHostIP]);

  useEffect(() => {
    const fetchBandwidthHistory = async () => {
      try {
        const res = await fetch(`https://${selectedHostIP}:2020/bandwidth-history?interface=${selectedInterface}`);
        const data = await res.json();
        if (data && Array.isArray(data.bandwidth_history)) {
          setBandwidthHistory(
            data.bandwidth_history.map(item => ({
              ...item,
              date: new Date(item.timestamp * 1000),
              value: typeof item.bandwidth_kbps === 'number' && !isNaN(item.bandwidth_kbps) ? item.bandwidth_kbps : 0,
            }))
          );
          // Set current bandwidth to the latest value
          if (data.bandwidth_history.length > 0) {
            setCurrentBandwidth(data.bandwidth_history[data.bandwidth_history.length - 1].bandwidth_kbps);
          } else {
            setCurrentBandwidth(0);
          }
        } else {
          setBandwidthHistory([]);
          setCurrentBandwidth(0);
        }
      } catch (err) {
        setBandwidthHistory([]);
        setCurrentBandwidth(0);
        if (lastErrorIpRef.current !== selectedHostIP) {
          message.error(`Failed to fetch bandwidth history from ${selectedHostIP}`);
          lastErrorIpRef.current = selectedHostIP;
        }
      }
    };
    fetchBandwidthHistory();
    const interval = setInterval(fetchBandwidthHistory, 5000); // every 5s
    return () => clearInterval(interval);
  }, [selectedHostIP, selectedInterface]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(`https://${selectedHostIP}:2020/network-health?interface=${selectedInterface}`);
        const json = await res.json();
        setChartData(prev => [...prev.slice(-29), json]); // last 30
      } catch (err) {
        if (lastErrorIpRef.current !== selectedHostIP) {
          message.error(`Failed to fetch network health from ${selectedHostIP}`);
          lastErrorIpRef.current = selectedHostIP;
        }
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 5000); // every 5s
    return () => clearInterval(interval);
  }, [selectedHostIP, selectedInterface]);

  // Node SSH status check
  useEffect(() => {
    let cancelled = false;
    async function fetchNodeStatus() {
      try {
        setNodeStatus('Loading');
        const res = await fetch(`https://${hostIP}:2020/node-status?ip=${selectedHostIP}`);
        const data = await res.json();
        if (!cancelled) {
          setNodeStatus(data.status === 'UP' ? 'UP' : 'DOWN');
          if (data.status !== 'UP' && lastErrorIpRef.current !== selectedHostIP) {
            message.error(`Node SSH check failed for ${selectedHostIP}`);
            lastErrorIpRef.current = selectedHostIP;
          }
        }
      } catch (err) {
        if (!cancelled) {
          setNodeStatus('DOWN');
          if (lastErrorIpRef.current !== selectedHostIP) {
            message.error(`Node SSH check failed for ${selectedHostIP}`);
            lastErrorIpRef.current = selectedHostIP;
          }
        }
      }
    }
    fetchNodeStatus();
    const interval = setInterval(fetchNodeStatus, 15000); // check every 15s
    return () => { cancelled = true; clearInterval(interval); };
  }, [selectedHostIP]);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const res = await axios.get(`https://${selectedHostIP}:2020/check-health`);
        setHealthStatus(res.data.status.toUpperCase());
      } catch (err) {
        setHealthStatus("ERROR");
      }
    };

    fetchHealth();
    const interval = setInterval(fetchHealth, 10000); // auto-refresh every 10s
    return () => clearInterval(interval);
  }, [selectedHostIP]);


  const statusColorMap = {
    GOOD: { color: "#52c41a", background: "#f6ffed", border: "#b7eb8f" },
    WARNING: { color: "#faad14", background: "#fffbe6", border: "#ffe58f" },
    CRITICAL: { color: "#f5222d", background: "#fff1f0", border: "#ffa39e" },
    ERROR: { color: "#8c8c8c", background: "#fafafa", border: "#d9d9d9" }
  };

  const statusStyle = statusColorMap[healthStatus] || statusColorMap.ERROR;


  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(true); // For loading state
  const [counts, setCounts] = useState({
    cloudCount: 0,
    flightDeckCount: 0,
    squadronCount: 0
  });
  // State for hover effects
  const [hoveredCard, setHoveredCard] = useState(null);

  // Docker containers state (live from backend)
  const [dockerContainers, setDockerContainers] = useState([]);
  const [filteredContainers, setFilteredContainers] = useState([]);
  const [dockerUp, setDockerUp] = useState(0);
  const [dockerDown, setDockerDown] = useState(0);
  const [dockerTotal, setDockerTotal] = useState(0);
  const [dockerError, setDockerError] = useState("");

  useEffect(() => {
    async function fetchDockerInfo() {
      try {
        const res = await fetch(`https://${selectedHostIP}:2020/docker-info`);
        const data = await res.json();
        if (data && Array.isArray(data.containers)) {
          setDockerContainers(data.containers);
          setFilteredContainers(data.containers);
          setDockerUp(data.up || 0);
          setDockerDown(data.down || 0);
          setDockerTotal(data.total || data.containers.length || 0);
          setDockerError("");
        } else {
          setDockerContainers([]);
          setFilteredContainers([]);
          setDockerUp(0);
          setDockerDown(0);
          setDockerTotal(0);
          setDockerError(data?.error || "Failed to fetch docker info");
          if (lastErrorIpRef.current !== selectedHostIP) {
            message.error(`Failed to fetch docker info from ${selectedHostIP}`);
            lastErrorIpRef.current = selectedHostIP;
          }
        }
      } catch (err) {
        setDockerContainers([]);
        setFilteredContainers([]);
        setDockerUp(0);
        setDockerDown(0);
        setDockerTotal(0);
        setDockerError("Failed to fetch docker info");
        if (lastErrorIpRef.current !== selectedHostIP) {
          message.error(`Failed to fetch docker info from ${selectedHostIP}`);
          lastErrorIpRef.current = selectedHostIP;
        }
      }
    }
    fetchDockerInfo();
    const interval = setInterval(fetchDockerInfo, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, [selectedHostIP]);

  // Docker table columns
  const dockerColumns = [
    {
      title: 'Docker ID',
      dataIndex: 'dockerId',
      key: 'dockerId',
      width: '25%',
      render: (text) => (
        <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>
          {text}
        </span>
      )
    },
    {
      title: 'Container Name',
      dataIndex: 'containerName',
      key: 'containerName',
      width: '50%',
      render: (text) => (
        <span style={{ fontWeight: '500' }}>
          {text}
        </span>
      )
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: '25%',
      render: (status) => (
        <Badge
          status={status === 'UP' ? 'success' : 'error'}
          text={status}
        />
      )
    }
  ];

  const navigate = useNavigate();
  const storedData = JSON.parse(sessionStorage.getItem("loginDetails")) || {};
  const userId = storedData?.data?.id || "";

  // Function to navigate to Iaas page with specific tab
  const navigateToIaasTab = (tabKey) => {
    navigate(`/iaas?tab=${tabKey}`);
    // Also save the active tab in session storage for persistence
    sessionStorage.setItem("iaas_activeTab", tabKey);
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Check password status
        const passwordResponse = await fetch(`https://${hostIP}:5000/api/check-password-status/${userId}`);
        const passwordData = await passwordResponse.json();

        if (passwordData.updatePwdStatus === 1) {
          setIsModalVisible(false); // Don't show modal if password updated
        } else {
          setIsModalVisible(true); // Show modal if password not updated
        }

        // Fetch dashboard counts
        const countsResponse = await fetch(`https://${selectedHostIP}:5000/api/dashboard-counts/${userId}`);
        const countsData = await countsResponse.json();

        setCounts({
          cloudCount: countsData.cloudCount || 0,
          flightDeckCount: countsData.flightDeckCount || 0,
          squadronCount: countsData.squadronCount || 0
        });
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setIsLoading(false); // Hide loading after all fetches
      }
    };

    if (userId) {
      fetchData();
    } else {
      setIsLoading(false); // Hide loading if no userId
    }
  }, [userId, selectedHostIP]);

  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  if (isLoading) return (
    <Layout1>
      <Layout>
        <Content style={{ margin: "16px 16px" }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              minHeight: '400px',
              background: colorBgContainer,
              borderRadius: borderRadiusLG,
            }}
          >
            <Spin size="large" />
          </div>
        </Content>
      </Layout>
    </Layout1>
  );

  return (
    <Layout1>
      <Layout>
        <Content>
          <div>
            {/* First row: summary cards */}
            <Row gutter={16} justify="space-between" style={{ marginLeft: "20px" }}>
              <Col className="gutter-row" span={7} style={hoveredCard === 'cloud' ? hoverStyle : style}
                onClick={() => navigateToIaasTab("1")}
                onMouseEnter={() => setHoveredCard('cloud')}
                onMouseLeave={() => setHoveredCard(null)}>
                {/* ...Cloud card content... */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minHeight: "80px", justifyContent: "center", marginLeft: "20px" }}>
                    <img src={cloud} alt="cloud--v1" style={{ width: "64px", height: "64px", userSelect: "none" }} />
                    <span style={{ fontSize: "15px", fontWeight: "500", marginTop: "4px", userSelect: "none", textAlign: "center" }}>Cloud</span>
                  </div>
                  <span style={{ fontSize: "32px", fontWeight: "bold", color: "#1890ff", marginRight: "50px", userSelect: "none" }}>{counts.cloudCount}</span>
                </div>
              </Col>
              <Col className="gutter-row" span={7} style={hoveredCard === 'flightDeck' ? hoverStyle : style}
                onClick={() => navigateToIaasTab("2")}
                onMouseEnter={() => setHoveredCard('flightDeck')}
                onMouseLeave={() => setHoveredCard(null)}>
                {/* ...Flight Deck card content... */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minHeight: "80px", justifyContent: "center", marginLeft: "20px" }}>
                    <img src={node} alt="server" style={{ width: "64px", height: "64px", userSelect: "none" }} />
                    <span style={{ fontSize: "15px", fontWeight: "500", marginTop: "4px", userSelect: "none", textAlign: "center" }}>Flight Deck</span>
                  </div>
                  <span style={{ fontSize: "32px", fontWeight: "bold", color: "#1890ff", marginRight: "50px", userSelect: "none" }}>{counts.flightDeckCount}</span>
                </div>
              </Col>
              <Col className="gutter-row" span={7} style={hoveredCard === 'squadron' ? hoverStyle : style}
                onClick={() => navigateToIaasTab("3")}
                onMouseEnter={() => setHoveredCard('squadron')}
                onMouseLeave={() => setHoveredCard(null)}>
                {/* ...Squadron card content... */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minHeight: "80px", justifyContent: "center", marginLeft: "20px" }}>
                    <img src={squad} alt="cloud-development--v3" style={{ width: "64px", height: "64px", userSelect: "none" }} />
                    <span style={{ fontSize: "15px", fontWeight: "500", marginTop: "4px", userSelect: "none", textAlign: "center" }}>Squadron</span>
                  </div>
                  <span style={{ fontSize: "32px", fontWeight: "bold", color: "#1890ff", marginRight: "50px", userSelect: "none" }}>{counts.squadronCount}</span>
                </div>
              </Col>
            </Row>
            {/* Host IP Dropdown */}
            <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', margin: '19px 0 15px 18px', marginTop: "10px" }}>
              <span style={{ marginRight: 8, fontWeight: 500, userSelect: "none" }}>Host:</span>
              <Select
                style={{ width: 220 }}
                value={selectedHostIP}
                onChange={setSelectedHostIP}
                options={(hostIpOptions || []).map(ip => ({ label: ip, value: ip }))}
                showSearch
                optionFilterProp="children"
                filterOption={(input, option) => (option?.label || '').toLowerCase().includes((input || '').toLowerCase())}
              />
            </div>
            {/* Performance Section Header */}
            <div
              style={{
                marginTop: 10,
                padding: 30,
                minHeight: "auto",
                background: colorBgContainer,
                // borderRadius: borderRadiusLG,
                marginLeft: "20px",
                marginRight: "17px",
              }}
            >
              <h4 style={{ userSelect: "none", marginTop: "-16px" }} >Performance</h4>
              <Divider style={{ margin: "-16px 0 0 0" }} />
              <Row gutter={24} justify="start" style={{ marginLeft: "2px" }}>
                <Col
                  className="gutter-row"
                  span={7}
                  style={performancewidgetStyle}
                >
                  <div>
                    <span
                      style={{
                        fontSize: "18px",
                        fontWeight: "500",
                        marginLeft: "1px",
                        userSelect: "none",
                        display: "block",
                        marginBottom: "8px"
                      }}
                    >
                      Status
                    </span>
                    <Divider style={{ margin: "0 0 16px 0" }} />
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '80px',
                      fontSize: '24px',
                      fontWeight: 'bold',
                      color: nodeStatus === 'UP' ? '#52c41a' : '#cf1322',
                      // backgroundColor: nodeStatus === 'UP' ? '#f6ffed' : '#fff1f0',
                      // border: nodeStatus === 'UP' ? '1px solid #b7eb8f' : '1px solid #ffa39e',
                      borderRadius: '6px',
                      textAlign: 'center'
                    }}>
                      {nodeStatus}
                    </div>
                  </div>
                </Col>
                <Col className="gutter-row" span={7} style={performancewidgetStyle}>
                  <div>
                    <span
                      style={{
                        fontSize: "18px",
                        fontWeight: "500",
                        marginLeft: "1px",
                        userSelect: "none",
                        display: "block",
                        marginBottom: "8px"
                      }}
                    >
                      Health Check
                    </span>
                    <Divider style={{ margin: "0 0 16px 0" }} />
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '80px',
                        fontSize: '24px',
                        fontWeight: 'bold',
                        color: statusStyle.color,
                        // backgroundColor: statusStyle.background,
                        // border: `1px solid ${statusStyle.border}`,
                        borderRadius: '6px',
                        textAlign: 'center'
                      }}
                    >
                      {healthStatus}
                    </div>
                  </div>
                </Col>
                <Col className="gutter-row" span={7} style={performancewidgetStyle}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ fontSize: "18px", fontWeight: "500", userSelect: "none" }}>Bandwidth Latency</span>
                      <Select
                        style={{ width: 100 }}
                        value={selectedInterface}
                        options={interfaces}
                        onChange={setSelectedInterface}
                        size="small"
                      />
                    </div>
                    <Divider style={{ margin: "0 0 16px 0" }} />
                    <div style={{ fontSize: 14, color: '#333', marginBottom: 6, marginTop: -16 }}>
                      Current: {typeof currentBandwidth === 'number' ? currentBandwidth.toFixed(1) : '0.0'} kbps
                    </div>
                  </div>
                  <div style={{ height: 70, margin: '0 -20px 10px -20px' }}>
                    <BandwidthLine bandwidthHistory={getSmoothedBandwidthHistory(bandwidthHistory, 5)} />
                  </div>
                </Col>
              </Row>
              <Row gutter={24} justify="start" style={{ marginTop: 24, marginLeft: "2px", height: "270px" }}>
                <Col
                  className="gutter-row"
                  span={11} // Each column takes up 7 spans
                  style={performancewidgetStyle}
                >
                  <div>
                    <span
                      style={{
                        fontSize: "18px",
                        fontWeight: "500",
                        marginLeft: "1px",
                        userSelect: "none",
                        display: "block",
                        marginBottom: "8px"
                      }}
                    >
                      CPU Usage Trend
                    </span>
                    <Divider style={{ margin: "0 0 16px 0" }} />
                    <div style={{ fontSize: 14, color: '#333', marginBottom: 6, marginTop: -16 }}>
                      Current: {cpuData.toFixed(1)}%
                    </div>
                    <div style={{ height: '100px' }}>
                      <Area
                        data={cpuHistory}
                        xField="date"
                        yField="cpu"
                        height={180}
                        smooth={true}
                        areaStyle={{ fill: 'l(270) 0:#1890ff 0.5:#e6f7ff 1:#ffffff' }}
                        line={{ color: '#1890ff' }}
                      />
                    </div>
                  </div>
                </Col>
                <Col
                  className="gutter-row"
                  span={11} // Each column takes up 7 spans
                  style={performancewidgetStyle}
                >
                  <div>
                    <span
                      style={{
                        fontSize: "18px",
                        fontWeight: "500",
                        marginLeft: "1px",
                        userSelect: "none",
                        display: "block",
                        marginBottom: "8px"
                      }}
                    >
                      Memory Usage Trend
                    </span>
                    <Divider style={{ margin: "0 0 16px 0" }} />
                    <div style={{ fontSize: 14, color: '#333', marginBottom: 6, marginTop: -16 }}>
                      Used: {usedMemory} MB / {totalMemory} MB
                      Usage: {memoryData.toFixed(1)}%
                    </div>
                    <div style={{ height: '80px' }}>
                      <Area {...memoryconfig} />
                    </div>
                  </div>
                </Col>
              </Row>
            </div>
            <div
              style={{
                marginTop: 10,
                padding: 30,
                minHeight: "auto",
                background: colorBgContainer,
                // borderRadius: borderRadiusLG,
                marginLeft: "20px",
                marginRight: "17px",
              }}
            >
              <h4 style={{ userSelect: "none", marginTop: "-16px" }} >Docker Service Status</h4>
              <Divider style={{ margin: "-16px 0 16px 0" }} />
              <Row
                gutter={16}
                justify="space-between"
                style={{ marginBottom: "17px", marginLeft: "2px" }}
              >
                <Col className="gutter-row" span={7} style={dockerwidgetStyle}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "10px 20px",
                      height: "20px", // Reduced height
                      fontSize: "18px",
                      fontWeight: "500",
                    }}
                  >
                    <span style={{ userSelect: "none" }}>UP</span>
                    <span
                      style={{
                        fontSize: "20px",
                        fontWeight: "bold",
                        color: "#52c41a",
                        userSelect: "none",
                      }}
                    >
                      {dockerUp}
                    </span>
                  </div>
                </Col>

                <Col className="gutter-row" span={7} style={dockerwidgetStyle}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "10px 20px",
                      height: "20px",
                      fontSize: "18px",
                      fontWeight: "500",
                    }}
                  >
                    <span style={{ userSelect: "none" }}>DOWN</span>
                    <span
                      style={{
                        fontSize: "20px",
                        fontWeight: "bold",
                        color: "#cf1322",
                        userSelect: "none",
                      }}
                    >
                      {dockerDown}
                    </span>
                  </div>
                </Col>

                <Col className="gutter-row" span={7} style={dockerwidgetStyle}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "10px 20px",
                      height: "20px",
                      fontSize: "18px",
                      fontWeight: "500",
                    }}
                  >
                    <span style={{ userSelect: "none" }}>Total</span>
                    <span
                      style={{
                        fontSize: "20px",
                        fontWeight: "bold",
                        color: "rgb(30, 42, 209)",
                        userSelect: "none",
                      }}
                    >
                      {dockerTotal}
                    </span>
                  </div>
                </Col>
              </Row>

              {/* Search Input */}
              <Input.Search
                placeholder="Search containers..."
                style={{ marginBottom: 16, width: 300 }}
                onChange={(e) => {
                  const value = e.target.value.toLowerCase();
                  const filtered = dockerContainers.filter(container =>
                    (container.dockerId || "").toLowerCase().includes(value) ||
                    (container.containerName || "").toLowerCase().includes(value) ||
                    (container.status || "").toLowerCase().includes(value)
                  );
                  setFilteredContainers(filtered);
                }}
              />

              {/* Docker Containers Table */}
              <Table
                dataSource={filteredContainers}
                columns={dockerColumns}
                pagination={{
                  pageSize: 5,
                  showSizeChanger: true,
                  showQuickJumper: true,
                  showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} containers`,
                }}
                rowKey="dockerId"
                size="middle"
              />
            </div>

          </div>
          {/* Password Update Modal Form */}
          <PasswordUpdateForm
            isModalVisible={isModalVisible}
            setIsModalVisible={setIsModalVisible}
          />
        </Content>

      </Layout>
    </Layout1>
  );
};

export default Dashboard;
