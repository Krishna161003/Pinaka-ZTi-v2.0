import React, { useState, useEffect, useRef } from "react";
import Layout1 from "../Components/layout";
import { theme, Layout, Spin, Row, Col, Divider, Select, Table, Badge, Input, message, Tooltip } from "antd";
import { InfoCircleOutlined } from '@ant-design/icons';
import { useNavigate } from "react-router-dom";
import PasswordUpdateForm from "../Components/PasswordUpdateForm";
import node from "../Images/FlightDeck.png";
import squad from "../Images/Squadron2.png";
import osd from "../Images/OSD.png";
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
  // For cloud resource-usage error gating
  const resourceErrorShownRef = useRef(false);
  // Node SSH status
  const [nodeStatus, setNodeStatus] = useState('Loading');

  // --- CPU & Memory Utilization State ---
  const [cpuData, setCpuData] = useState(0);
  const [cpuHistory, setCpuHistory] = useState([]);
  const [interfaces, setInterfaces] = useState([]);
  const [selectedInterface, setSelectedInterface] = useState("");
  const [bandwidthHistory, setBandwidthHistory] = useState([]); // [{ date, value, direction }]
  const [currentBandwidth, setCurrentBandwidth] = useState({ rx: 0, tx: 0 });
  const [chartData, setChartData] = useState([]);
  const [healthStatus, setHealthStatus] = useState("Loading");
  const [healthDetails, setHealthDetails] = useState({ metrics: null, thresholds: null, reasons: [] });
  const [memoryData, setMemoryData] = useState(0);
  const [totalMemory, setTotalMemory] = useState(0);
  const [usedMemory, setUsedMemory] = useState(0);

  // Host IP dropdown state (dynamic from backend Host and child_node tables)
  const [hostIpOptions, setHostIpOptions] = useState([]);
  const [selectedHostIP, setSelectedHostIP] = useState(() => localStorage.getItem('dashboard_selectedHostIP') || window.location.hostname);

  // Server details state
  const [serverDetails, setServerDetails] = useState({ serverid: '', serverip: '', role: '' });

  // Fetch server details by IP
  const fetchServerDetailsByIP = async (ip) => {
    try {
      const userId = JSON.parse(sessionStorage.getItem('loginDetails'))?.data?.id;
      const res = await fetch(`https://${hostIP}:5000/api/server-details-by-ip?ip=${encodeURIComponent(ip)}${userId ? `&userId=${encodeURIComponent(userId)}` : ''}`);
      const data = await res.json();
      if (data && data.serverid) {
        setServerDetails({
          serverid: data.serverid || '',
          serverip: data.serverip || ip,
          role: data.role || ''
        });
      } else {
        // If no server found, show Flight Deck details
        setServerDetails({
          serverid: 'FD-MAIN',
          serverip: ip,
          role: 'Flight Deck'
        });
      }
    } catch (e) {
      console.error('Error fetching server details:', e);
      setServerDetails({
        serverid: 'FD-MAIN',
        serverip: ip,
        role: 'Flight Deck'
      });
    }
  };

  // Fetch unique server IPs from deployed_server table (backend aggregates)
  useEffect(() => {
    async function fetchServerIps() {
      try {
        const userId = JSON.parse(sessionStorage.getItem('loginDetails'))?.data?.id;
        const res = await fetch(`https://${hostIP}:5000/api/deployed-server-ips-dropdown${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`);
        const json = await res.json();
        // Support both shapes: ["ip1", ...] or { ips: ["ip1", ...] }
        const arr = Array.isArray(json) ? json : (Array.isArray(json?.ips) ? json.ips : []);
        // Filter truthy, unique, and exclude current host (we add it as "Flight Deck")
        const currentHost = window.location.hostname;
        const uniqueIps = Array.from(new Set(arr.filter(ip => ip && ip !== currentHost)));
        setHostIpOptions(uniqueIps);
        // Do not override current selection; default remains current host (Flight Deck)
      } catch (e) {
        // On failure, keep only Flight Deck option by leaving hostIpOptions empty
        setHostIpOptions([]);
        setSelectedHostIP(prev => prev || window.location.hostname);
      }
    }
    fetchServerIps();
  }, []);

  // Fetch server details when selectedHostIP changes
  useEffect(() => {
    if (selectedHostIP) {
      fetchServerDetailsByIP(selectedHostIP);
    }
  }, [selectedHostIP]);

  // Fetch CPU and Memory time series for Area charts
  const [memoryHistory, setMemoryHistory] = useState([]);
  useEffect(() => {
    async function fetchHistory() {
      try {
        const res = await fetch(`https://${selectedHostIP}:2020/system-utilization-history`);
        const data = await res.json();

        const cpuHistIn = Array.isArray(data?.cpu_history) ? data.cpu_history : [];
        const memHistIn = Array.isArray(data?.memory_history) ? data.memory_history : [];

        // DEBUG: Log raw data
        // console.log('Raw CPU data:', cpuHistIn);
        // console.log('Raw Memory data:', memHistIn);

        const maxCpuVal = cpuHistIn.length ? Math.max(...cpuHistIn.map(i => (typeof i.cpu === 'number' ? i.cpu : parseFloat(i.cpu) || 0))) : 0;
        const maxMemVal = memHistIn.length ? Math.max(...memHistIn.map(i => (typeof i.memory === 'number' ? i.memory : parseFloat(i.memory) || 0))) : 0;

        // DEBUG: Log max values and conversion flags
        // console.log('Max CPU:', maxCpuVal, 'Max Memory:', maxMemVal);
        // console.log('CPU is fraction:', maxCpuVal > 0 && maxCpuVal <= 1.5);
        // console.log('Memory is fraction:', maxMemVal > 0 && maxMemVal <= 1.5);

        // Process CPU data
        if (cpuHistIn.length) {
          const processedCpu = cpuHistIn.map(item => {
            let cpuVal = (typeof item.cpu === 'number' ? item.cpu : parseFloat(item.cpu)) || 0;
            // If value is between 0-1, assume it's a fraction and convert to percentage
            if (cpuVal > 0 && cpuVal <= 1) {
              cpuVal *= 100;
            }
            return {
              date: new Date(item.timestamp * 1000),
              cpu: cpuVal
            };
          });

          // console.log('Processed CPU data:', processedCpu);
          setCpuHistory(processedCpu);
        } else {
          setCpuHistory([]);
        }

        // Process Memory data
        if (memHistIn.length) {
          const processedMem = memHistIn.map(item => {
            let memVal = (typeof item.memory === 'number' ? item.memory : parseFloat(item.memory)) || 0;
            // If value is between 0-1, assume it's a fraction and convert to percentage
            if (memVal > 0 && memVal <= 1) {
              memVal *= 100;
            }
            return {
              date: new Date(item.timestamp * 1000),
              memory: memVal
            };
          });

          // console.log('Processed Memory data:', processedMem);
          setMemoryHistory(processedMem);
        } else {
          setMemoryHistory([]);
        }

      } catch (err) {
        setCpuHistory([]);
        setMemoryHistory([]);
        if (lastErrorIpRef.current !== selectedHostIP) {
          message.error(`Failed to fetch system utilization history from ${selectedHostIP}`);
        }
      }
    }

    fetchHistory();
    const interval = setInterval(fetchHistory, 30000);
    return () => clearInterval(interval);
  }, [selectedHostIP]);


  useEffect(() => {
    const storedSelectedHostIP = localStorage.getItem('dashboard_selectedHostIP');
    if (storedSelectedHostIP) {
      setSelectedHostIP(storedSelectedHostIP);
    }
  }, []);

  useEffect(() => {
    const storedSelectedInterface = localStorage.getItem('dashboard_selectedInterface');
    if (storedSelectedInterface) {
      setSelectedInterface(storedSelectedInterface);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('dashboard_selectedHostIP', selectedHostIP);
  }, [selectedHostIP]);

  useEffect(() => {
    localStorage.setItem('dashboard_selectedInterface', selectedInterface);
  }, [selectedInterface]);


  const CPUUsageChart = () => {
    const config = {
      data: cpuHistory,
      xField: 'date',
      yField: 'cpu',
      height: 180,
      // point: {
      //   shapeField: 'circle',
      //   sizeField: 2,
      // },
      style: {
        lineWidth: 1,
      },
      yAxis: {
        min: 0,
        max: 100,
        label: { formatter: (v) => `${v}%` },
      },
      meta: {
        cpu: { min: 0, max: 100 },
      },
    };
    return <Line {...config} />;
  };

  const MemoryUsageChart = () => {
    const config = {
      data: memoryHistory,
      xField: 'date',
      yField: 'memory',
      height: 180,
      // point: {
      //   shapeField: 'circle',
      //   sizeField: 2,
      //   color: '#52c41a',
      // },
      style: {
        lineWidth: 1,
        stroke: '#52c41a',
      },
      yAxis: {
        min: 0,
        max: 100,
        label: { formatter: (v) => `${v}%` },
      },
      meta: {
        memory: { min: 0, max: 100 },
      },
    };
    return <Line {...config} />;
  };

  // Helper: Moving average smoothing for bandwidth (per direction)
  function getSmoothedBandwidthHistory(history, windowSize = 5) {
    if (!Array.isArray(history) || history.length === 0) return [];
    const byDir = history.reduce((acc, item) => {
      const key = item.direction || 'Total';
      (acc[key] = acc[key] || []).push(item);
      return acc;
    }, {});
    const out = [];
    for (const key of Object.keys(byDir)) {
      const series = byDir[key];
      for (let i = 0; i < series.length; i++) {
        const start = Math.max(0, i - windowSize + 1);
        const windowArr = series.slice(start, i + 1);
        const avg = windowArr.reduce((sum, it) => sum + (typeof it.value === 'number' ? it.value : 0), 0) / windowArr.length;
        out.push({ ...series[i], value: avg });
      }
    }
    return out.sort((a, b) => a.date - b.date);
  }


  const BandwidthLine = ({ bandwidthHistory }) => {
    const config = {
      data: bandwidthHistory,
      // width: 280,
      height: 110,
      smooth: true,
      xField: 'date',
      yField: 'value',
      seriesField: 'direction',
      lineStyle: { lineWidth: 2 },
      color: ({ direction }) => (direction === 'In' ? '#1677ff' : '#52c41a'),
      label: {
        selector: 'last',
        text: (d) => `${d.direction}: ${typeof d.value === 'number' ? d.value.toFixed(0) : d.value}`,
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
    const interval = setInterval(fetchUtilization, 30000);
    return () => clearInterval(interval);
  }, [selectedHostIP]);

  useEffect(() => {
    fetch(`https://${selectedHostIP}:2020/interfaces`)
      .then(res => res.json())
      .then(data => {
        setInterfaces(data);
        if (data && data.length > 0) {
          const saved = localStorage.getItem('dashboard_selectedInterface');
          const valid = saved && data.some(d => d.value === saved);
          const next = valid ? saved : data[0].value;
          setSelectedInterface(next);
          localStorage.setItem('dashboard_selectedInterface', next);
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
          const hist = [];
          for (const item of data.bandwidth_history) {
            const ts = new Date((item.timestamp || 0) * 1000);
            const rx = Number(item.rx_kbps) || 0;
            const tx = Number(item.tx_kbps) || 0;
            hist.push({ date: ts, value: rx, direction: 'In' });
            hist.push({ date: ts, value: tx, direction: 'Out' });
          }
          setBandwidthHistory(hist);
          // Set current bandwidths
          if (data.bandwidth_history.length > 0) {
            const last = data.bandwidth_history[data.bandwidth_history.length - 1];
            setCurrentBandwidth({ rx: Number(last.rx_kbps) || 0, tx: Number(last.tx_kbps) || 0 });
          } else {
            setCurrentBandwidth({ rx: 0, tx: 0 });
          }
        } else {
          setBandwidthHistory([]);
          setCurrentBandwidth({ rx: 0, tx: 0 });
        }
      } catch (err) {
        setBandwidthHistory([]);
        setCurrentBandwidth({ rx: 0, tx: 0 });
        if (lastErrorIpRef.current !== selectedHostIP) {
          message.error(`Failed to fetch bandwidth history from ${selectedHostIP}`);
          lastErrorIpRef.current = selectedHostIP;
        }
      }
    };
    fetchBandwidthHistory();
    const interval = setInterval(fetchBandwidthHistory, 30000); // every 20s
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
    const interval = setInterval(fetchData, 30000); // every 10s
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
        const data = res.data || {};
        setHealthStatus((data.status || 'ERROR').toUpperCase());
        setHealthDetails({
          metrics: data.metrics || null,
          thresholds: data.thresholds || null,
          reasons: Array.isArray(data.reasons) ? data.reasons : []
        });
      } catch (err) {
        setHealthStatus("ERROR");
        setHealthDetails({ metrics: null, thresholds: null, reasons: [] });
      }
    };

    fetchHealth();
    const interval = setInterval(fetchHealth, 30000); // auto-refresh every 10s
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
    squadronCount: 0
  });
  // Cloud name (earliest) to show in Cloud card
  const [cloudName, setCloudName] = useState(() => sessionStorage.getItem('cloud_first_cloudname') || '');
  // Server counts (from backend /api/server-counts)
  const [serverCounts, setServerCounts] = useState({ total_count: 0, online_count: 0, offline_count: 0 });
  // State for hover effects
  const [hoveredCard, setHoveredCard] = useState(null);
  // OSD counts from backend
  const [osdCounts, setOsdCounts] = useState({ total_osds: 0, up_osds: 0, in_osds: 0 });

  // Docker containers state (live from backend)
  const [dockerContainers, setDockerContainers] = useState([]);
  const [filteredContainers, setFilteredContainers] = useState([]);
  // Controlled pagination for Docker table
  const [dockerPageSize, setDockerPageSize] = useState(() => {
    const saved = Number(sessionStorage.getItem('docker_page_size'));
    return Number.isFinite(saved) && saved > 0 ? saved : 5;
  });
  const [dockerCurrentPage, setDockerCurrentPage] = useState(() => {
    const saved = Number(sessionStorage.getItem('docker_current_page'));
    return Number.isFinite(saved) && saved > 0 ? saved : 1;
  });
  const [dockerUp, setDockerUp] = useState(0);
  const [dockerDown, setDockerDown] = useState(0);
  const [dockerTotal, setDockerTotal] = useState(0);
  const [dockerError, setDockerError] = useState("");
  // Persisted docker search text
  const [dockerSearchText, setDockerSearchText] = useState(() => sessionStorage.getItem('docker_search_text') || '');

  // Cloud resources summary for the table below the Cloud card
  const [cloudStats, setCloudStats] = useState({
    instances: 0,
    volumes: 0,
    vcpuUsed: 0,
    vcpuTotal: 0,
    memUsedGiB: 0,
    memTotalGiB: 0,
  });

  // Disk usage (per-mount for root disk)
  const [diskInfo, setDiskInfo] = useState({ root_disk: null, partitions: [] });

  // Poll disk usage for the selected host (every 30s)
  useEffect(() => {
    let cancelled = false;
    async function fetchDiskUsage() {
      try {
        const res = await fetch(`https://${selectedHostIP}:2020/disk-usage`);
        const data = await res.json();
        if (cancelled) return;
        if (data && Array.isArray(data.partitions)) {
          const parts = data.partitions.map((p) => ({
            mountpoint: p.mountpoint || p.mount || '',
            device: p.device || '',
            fstype: p.fstype || '',
            total: Number(p.total) || 0,
            used: Number(p.used) || 0,
            percent: Number(p.percent) || 0,
          }));
          setDiskInfo({ root_disk: data.root_disk || null, partitions: parts });
        } else {
          setDiskInfo({ root_disk: null, partitions: [] });
          if (lastErrorIpRef.current !== selectedHostIP) {
            message.error(`Failed to fetch disk usage from ${selectedHostIP}`);
            lastErrorIpRef.current = selectedHostIP;
          }
        }
      } catch (e) {
        if (!cancelled) {
          setDiskInfo({ root_disk: null, partitions: [] });
          if (lastErrorIpRef.current !== selectedHostIP) {
            message.error(`Failed to fetch disk usage from ${selectedHostIP}`);
            lastErrorIpRef.current = selectedHostIP;
          }
        }
      }
    }
    fetchDiskUsage();
    const interval = setInterval(fetchDiskUsage, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [selectedHostIP]);

  // Helper to format bytes to human-readable string
  const formatBytes = (bytes) => {
    const b = Number(bytes);
    if (!Number.isFinite(b) || b <= 0) return '0 B';
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
    let val = b;
    let i = 0;
    while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
    const fixed = val >= 100 ? 0 : (val >= 10 ? 1 : 2);
    return `${val.toFixed(fixed)} ${units[i]}`;
  };

  // Small usage bar component used in the table for vCPU and Memory
  const UsageBar = ({ used = 0, total = 0, color = '#4c8dff', tooltip = null, tooltipWidth }) => {
    if (!total || total <= 0) {
      return <span style={{ color: '#8c8c8c' }}>N/A</span>;
    }
    const pct = Math.max(0, Math.min(100, (used / total) * 100));
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Tooltip title={tooltip ?? `${pct.toFixed(2)}%`} overlayInnerStyle={tooltipWidth ? { width: tooltipWidth, maxWidth: tooltipWidth } : undefined}>
          <div style={{ width: 180, height: 6, background: '#eaeef5', borderRadius: 4, overflow: 'hidden', cursor: 'pointer' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: color }} />
          </div>
        </Tooltip>
        <span style={{ fontSize: 12, color: '#2c3e50' }}>{used} / {total}</span>
      </div>
    );
  };

  // Columns and data for Cloud resources table
  const cloudTableColumns = [
    { title: 'Instances', dataIndex: 'instances', key: 'instances', width: '20%', render: (v) => <span style={{ fontWeight: 600 }}>{v}</span> },
    { title: 'vCPU (Core)', dataIndex: 'vcpu', key: 'vcpu', width: '30%', render: (vcpu) => <UsageBar used={vcpu?.used} total={vcpu?.total} color="#4c8dff" /> },
    { title: 'Configured Memory (GiB)', dataIndex: 'memory', key: 'memory', width: '30%', render: (mem) => <UsageBar used={mem?.used} total={mem?.total} color="#4c8dff" /> },
    { title: 'Volumes', dataIndex: 'volumes', key: 'volumes', width: '20%', render: (v) => <span style={{ fontWeight: 600 }}>{v}</span> },
  ];

  const cloudTableData = [
    {
      key: 'summary',
      instances: cloudStats.instances,
      vcpu: { used: cloudStats.vcpuUsed, total: cloudStats.vcpuTotal },
      memory: { used: cloudStats.memUsedGiB, total: cloudStats.memTotalGiB },
      volumes: cloudStats.volumes,
    }
  ];

  // Fetch cloud resource usage for the table (from Flask /resource-usage)
  useEffect(() => {
    resourceErrorShownRef.current = false; // reset gate per host
    let cancelled = false;
    const fetchResourceUsage = async () => {
      try {
        const res = await fetch(`https://${hostIP}:2020/resource-usage`);
        const data = await res.json();
        if (!cancelled && data && !data.error) {
          setCloudStats({
            instances: Number(data.instances) || 0,
            volumes: Number(data.volumes_in_use) || 0,
            vcpuUsed: Number(data.vcpu?.used) || 0,
            vcpuTotal: Number(data.vcpu?.total) || 0,
            memUsedGiB: Number(data.memory?.used) || 0,
            memTotalGiB: Number(data.memory?.total) || 0,
          });
        }
      } catch (e) {
        if (!cancelled && !resourceErrorShownRef.current) {
          console.error(`Failed to fetch cloud resource usage from ${hostIP}`);
          resourceErrorShownRef.current = true;
        }
      }
    };
    fetchResourceUsage();
    const interval = setInterval(fetchResourceUsage, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [selectedHostIP]);

  // Keep filtered containers in sync with search text and containers; persist page
  useEffect(() => {
    const value = (dockerSearchText || '').toLowerCase();
    const filtered = dockerContainers.filter(container =>
      (container.dockerId || "").toLowerCase().includes(value) ||
      (container.containerName || "").toLowerCase().includes(value) ||
      (container.status || "").toLowerCase().includes(value)
    );
    setFilteredContainers(filtered);
    setDockerCurrentPage(1);
    sessionStorage.setItem('docker_current_page', '1');
  }, [dockerSearchText, dockerContainers]);

  // Load and persist docker current page
  useEffect(() => {
    const storedDockerCurrentPage = sessionStorage.getItem('docker_current_page');
    if (storedDockerCurrentPage) {
      const n = parseInt(storedDockerCurrentPage);
      if (!Number.isNaN(n) && n > 0) setDockerCurrentPage(n);
    }
  }, []);

  useEffect(() => {
    sessionStorage.setItem('docker_current_page', dockerCurrentPage.toString());
  }, [dockerCurrentPage]);

  // Load and persist docker search text
  useEffect(() => {
    const storedDockerSearchText = sessionStorage.getItem('docker_search_text');
    if (storedDockerSearchText !== null) {
      setDockerSearchText(storedDockerSearchText);
    }
  }, []);

  useEffect(() => {
    sessionStorage.setItem('docker_search_text', dockerSearchText);
  }, [dockerSearchText]);


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
    const interval = setInterval(fetchDockerInfo, 30000); // Poll every 10s
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
        const countsResponse = await fetch(`https://${hostIP}:5000/api/dashboard-counts/${userId}`);
        const countsData = await countsResponse.json();

        setCounts({
          cloudCount: countsData.cloudCount || 0,
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

  // Fetch earliest Cloud Name
  useEffect(() => {
    const cached = sessionStorage.getItem('cloud_first_cloudname');
    if (cached) setCloudName((cached || '').trim());
    (async () => {
      try {
        const res = await fetch(`https://${hostIP}:5000/api/first-cloudname`);
        const data = await res.json();
        if (data && typeof data.cloudname === 'string') {
          const val = (data.cloudname || '').trim();
          setCloudName(val);
          sessionStorage.setItem('cloud_first_cloudname', val);
        }
      } catch (_) {
        // Silent fail; keep cached or empty
      }
    })();
  }, []);

  // Fetch server up/down counts for Squadron card
  useEffect(() => {
    let cancelled = false;
    async function fetchServerCounts() {
      try {
        const res = await fetch(`https://${hostIP}:5000/api/server-counts`);
        const data = await res.json();
        if (!cancelled && data) {
          setServerCounts({
            total_count: Number(data.total_count) || 0,
            online_count: Number(data.online_count) || 0,
            offline_count: Number(data.offline_count) || 0,
          });
        }
      } catch (e) {
        if (!cancelled && lastErrorIpRef.current !== hostIP) {
          message.error('Failed to fetch server counts');
          lastErrorIpRef.current = hostIP;
        }
      }
    }
    fetchServerCounts();
    const interval = setInterval(fetchServerCounts, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Fetch OSD counts from Flask backend
  useEffect(() => {
    let cancelled = false;
    const fetchOsdCounts = async () => {
      try {
        const res = await fetch(`https://${hostIP}:2020/ceph/osd-count`);
        // const res = await fetch('https://192.168.20.4:2020/ceph/osd-count');
        const data = await res.json();
        if (!cancelled) {
          if (data && typeof data === 'object' && 'total_osds' in data) {
            setOsdCounts({
              total_osds: Number(data.total_osds) || 0,
              up_osds: Number(data.up_osds) || 0,
              in_osds: Number(data.in_osds) || 0,
            });
          } else {
            setOsdCounts({ total_osds: 0, up_osds: 0, in_osds: 0 });
          }
        }
      } catch (err) {
        if (!cancelled) {
          setOsdCounts({ total_osds: 0, up_osds: 0, in_osds: 0 });
          if (lastErrorIpRef.current !== hostIP) {
            message.error('Failed to fetch OSD counts');
            lastErrorIpRef.current = hostIP;
          }
        }
      }
    };
    fetchOsdCounts();
    const interval = setInterval(fetchOsdCounts, 60000); // every 60s
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

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

            {/* Second row: Flight Deck, Squadron, and OSD */}
            <Row gutter={16} justify="space-between" style={{ marginLeft: "20px", marginTop: "5px" }}>
              <Col className="gutter-row" span={7} style={hoveredCard === 'flightDeck' ? hoverStyle : style}
                onMouseEnter={() => setHoveredCard('flightDeck')}
                onMouseLeave={() => setHoveredCard(null)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginTop: "8px" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minHeight: "80px", justifyContent: "center", marginLeft: "20px" }}>
                    <img src={node} alt="server" style={{ width: "84px", height: "74px", userSelect: "none", zoom: "1.1" }} />
                    <span style={{ fontSize: "15px", fontWeight: "500", marginTop: "4px", userSelect: "none", textAlign: "center" }}>Flight Deck</span>
                  </div>
                  <span style={{ fontSize: "32px", fontWeight: "bold", color: "#1890ff", marginRight: "50px", userSelect: "none" }}>1</span>
                </div>
              </Col>

              <Col className="gutter-row" span={7} style={hoveredCard === 'squadron' ? hoverStyle : style}
                onClick={() => navigateToIaasTab("2")}
                onMouseEnter={() => setHoveredCard('squadron')}
                onMouseLeave={() => setHoveredCard(null)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minHeight: "80px", justifyContent: "center", marginLeft: "20px" }}>
                    <img src={squad} alt="squadron" style={{ width: "85px", height: "74px", userSelect: "none", zoom: "1.1", transform: 'rotate(90deg)', transformOrigin: 'center' }} />
                    <span style={{ fontSize: "15px", fontWeight: "500", marginTop: "4px", userSelect: "none", textAlign: "center" }}>Squadron</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginRight: "20px", marginTop: "15px" }}>
                    <span style={{ fontSize: "32px", fontWeight: "bold", color: "#1890ff", userSelect: "none" }}>{counts.squadronCount}</span>
                    <div style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      border: '1px solid #e8eef7',
                      marginTop: '2px',
                      fontSize: '13px',
                      fontWeight: '500',
                      color: '#2c3e50',
                      textAlign: 'center'
                    }}>
                      <span style={{ color: '#4caf50' }}>Up <strong>{serverCounts.online_count}</strong></span>
                      <span style={{ color: '#e0e0e0' }}>|</span>
                      <span style={{ color: '#f44336' }}>Down <strong>{serverCounts.offline_count}</strong></span>
                    </div>
                  </div>
                </div>
              </Col>

              <Col className="gutter-row" span={7} style={hoveredCard === 'osd' ? hoverStyle : style}
                onMouseEnter={() => setHoveredCard('osd')}
                onMouseLeave={() => setHoveredCard(null)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginTop: "9px" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minHeight: "80px", justifyContent: "center", marginLeft: "20px" }}>
                    <img src={osd} alt="osd" style={{ width: "64px", height: "64px", userSelect: "none", zoom: "1.1", transform: 'rotate(90deg)', transformOrigin: 'center' }} />
                    <span style={{ fontSize: "15px", fontWeight: "500", marginTop: "4px", userSelect: "none", textAlign: "center" }}>OSD</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginRight: "20px", marginTop: "15px" }}>
                    <span style={{ fontSize: "32px", fontWeight: "bold", color: "#1890ff", userSelect: "none", }}>{osdCounts.total_osds}</span>
                    <div style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      // background: '#f5f7fa',
                      border: '1px solid #e8eef7',
                      marginTop: '2px',
                      fontSize: '13px',
                      fontWeight: '500',
                      color: '#2c3e50',
                      textAlign: 'center'
                    }}>
                      <span style={{ color: '#4caf50' }}>In <strong>{osdCounts.in_osds}</strong></span>
                      <span style={{ color: '#e0e0e0' }}>|</span>
                      <span style={{ color: '#2196f3' }}>Up <strong>{osdCounts.up_osds}</strong></span>
                    </div>
                  </div>
                </div>
              </Col>
            </Row>
            {/* Cloud section - Full width (moved below) */}
            <Row gutter={16} style={{ margin: "0 18px 0 20px" }}>
              <Col span={24} style={hoveredCard === 'cloud' ? { ...hoverStyle, width: '100%', padding: '12px 16px', marginTop: '10px' } : { ...style, width: '100%', padding: '12px 16px', marginTop: '10px' }}
                onClick={() => navigateToIaasTab("1")}
                onMouseEnter={() => setHoveredCard('cloud')}
                onMouseLeave={() => setHoveredCard(null)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minHeight: "60px", justifyContent: "center", marginLeft: "20px" }}>
                    <span style={{ fontSize: "20px", fontWeight: "700", userSelect: "none", textAlign: "center" }}>Cloud Name</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", marginRight: "30px" }}>
                    <span style={{
                      fontSize: "20px",
                      fontWeight: "600",
                      color: "#1890ff",
                      userSelect: "none",
                      textTransform: 'uppercase',
                      letterSpacing: '1px'
                    }}>{cloudName || 'N/A'}</span>
                  </div>
                </div>
              </Col>
            </Row>
            {/* Cloud resources summary table */}
            <div
              style={{
                marginTop: 10,
                padding: 16,
                background: colorBgContainer,
                marginLeft: "20px",
                marginRight: "17px",
              }}
            >
              <Table
                columns={cloudTableColumns}
                dataSource={cloudTableData}
                pagination={false}
                size="small"
                rowKey="key"
              />
            </div>
            <div
              style={{
                marginTop: 10,
                padding: 2,
                height: "56px",
                background: colorBgContainer,
                marginLeft: "20px",
                marginRight: "17px",
              }}
            >
              {/* Host IP Dropdown and Server Details */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '19px 0 15px 18px', marginTop: "10px" }}>
                {/* Left side - Dropdown */}
                <div>
                  <Select
                    style={{ width: 220 }}
                    value={selectedHostIP}
                    onChange={setSelectedHostIP}
                    options={[
                      { label: 'Flight Deck', value: window.location.hostname },
                      ...((hostIpOptions || []).map(ip => ({ label: ip, value: ip })))
                    ]}
                    showSearch
                    optionFilterProp="children"
                    filterOption={(input, option) => (option?.label || '').toLowerCase().includes((input || '').toLowerCase())}
                  />
                </div>

                {/* Right side - Server Details */}
                <div style={{ display: 'flex', gap: '30px', alignItems: 'center', marginRight: '20px' }}>
                  <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '12px', color: '#666', fontWeight: '500' }}>Server ID:</span>
                    <span style={{ fontSize: '14px', fontWeight: '600', color: '#1890ff' }}>{serverDetails.serverid || 'Loading...'}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '12px', color: '#666', fontWeight: '500' }}>Role:</span>
                    <span style={{ fontSize: '14px', fontWeight: '600', color: '#52c41a' }}>{serverDetails.role || 'Loading...'}</span>
                  </div>
                </div>
              </div>
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
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span
                        style={{
                          fontSize: "18px",
                          fontWeight: "500",
                          marginLeft: "1px",
                          userSelect: "none",
                        }}
                      >
                        Health Check
                      </span>
                      <Tooltip
                        placement="right"
                        overlayInnerStyle={{ width: 440, maxWidth: 440 }}
                        title={(() => {
                          const reasons = Array.isArray(healthDetails.reasons) ? healthDetails.reasons : [];
                          const m = healthDetails.metrics || {};
                          const t = healthDetails.thresholds || {};

                          const makeRow = (label, actual, thr) => {
                            if (typeof actual !== 'number' || isNaN(actual)) return null;
                            const warn = typeof thr?.warning === 'number' ? thr.warning : null;
                            const crit = typeof thr?.critical === 'number' ? thr.critical : null;
                            let level = 'N/A';
                            if (crit !== null && actual >= crit) level = 'CRITICAL';
                            else if (warn !== null && actual >= warn) level = 'WARNING';
                            else if (warn !== null || crit !== null) level = 'GOOD';
                            return { label, actual, warn, crit, level };
                          };

                          const metricRows = [
                            makeRow('CPU', m.cpu_usage_percent, t.cpu),
                            makeRow('Memory', m.memory_usage_percent, t.memory),
                            makeRow('Disk', m.disk_usage_percent, t.disk),
                          ].filter(Boolean);

                          return (
                            <div style={{ fontSize: 12, lineHeight: 1.5, maxWidth: '100%' }}>
                              <div style={{ fontWeight: 600, marginBottom: 6 }}>Status: {healthStatus}</div>

                              {metricRows.length > 0 && (
                                <div style={{ marginBottom: 8 }}>
                                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                                    <thead>
                                      <tr>
                                        <th style={{ textAlign: 'left', borderBottom: '1px solid #eee', padding: '4px 6px' }}>Metric</th>
                                        <th style={{ textAlign: 'right', borderBottom: '1px solid #eee', padding: '4px 6px' }}>Actual (%)</th>
                                        <th style={{ textAlign: 'right', borderBottom: '1px solid #eee', padding: '4px 6px' }}>Warning (%)</th>
                                        <th style={{ textAlign: 'right', borderBottom: '1px solid #eee', padding: '4px 6px' }}>Critical (%)</th>
                                        <th style={{ textAlign: 'center', borderBottom: '1px solid #eee', padding: '4px 6px' }}>Level</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {metricRows.map((r, idx) => (
                                        <tr key={idx}>
                                          <td style={{ padding: '4px 6px' }}>{r.label}</td>
                                          <td style={{ padding: '4px 6px', textAlign: 'right' }}>{Number(r.actual).toFixed(1)}</td>
                                          <td style={{ padding: '4px 6px', textAlign: 'right' }}>{r.warn ?? '—'}</td>
                                          <td style={{ padding: '4px 6px', textAlign: 'right' }}>{r.crit ?? '—'}</td>
                                          <td style={{ padding: '4px 6px', textAlign: 'center', fontWeight: 600, color: r.level === 'CRITICAL' ? '#f5222d' : (r.level === 'WARNING' ? '#faad14' : '#52c41a') }}>{r.level}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}

                              {reasons.length > 0 && (
                                <div>
                                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Reasons</div>
                                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                                    <thead>
                                      <tr>
                                        <th style={{ textAlign: 'left', borderBottom: '1px solid #eee', padding: '4px 6px' }}>Metric</th>
                                        <th style={{ textAlign: 'center', borderBottom: '1px solid #eee', padding: '4px 6px' }}>Level</th>
                                        <th style={{ textAlign: 'right', borderBottom: '1px solid #eee', padding: '4px 6px' }}>Actual (%)</th>
                                        <th style={{ textAlign: 'right', borderBottom: '1px solid #eee', padding: '4px 6px' }}>Threshold (%)</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {reasons.map((r, i) => (
                                        <tr key={i}>
                                          <td style={{ padding: '4px 6px' }}>{r.metric}</td>
                                          <td style={{ padding: '4px 6px', textAlign: 'center', fontWeight: 600, color: r.level === 'CRITICAL' ? '#f5222d' : (r.level === 'WARNING' ? '#faad14' : '#52c41a') }}>{r.level}</td>
                                          <td style={{ padding: '4px 6px', textAlign: 'right' }}>{typeof r.actual === 'number' ? r.actual.toFixed(1) : r.actual}</td>
                                          <td style={{ padding: '4px 6px', textAlign: 'right' }}>{r.threshold ?? '—'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      >
                        <InfoCircleOutlined style={{ color: '#1890ff' }} />
                      </Tooltip>
                    </div>
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
                      <span style={{ fontSize: "18px", fontWeight: "500", userSelect: "none" }}>Network Traffic</span>
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
                      Current: In {typeof currentBandwidth.rx === 'number' ? currentBandwidth.rx.toFixed(1) : '0.0'} kbps, Out {typeof currentBandwidth.tx === 'number' ? currentBandwidth.tx.toFixed(1) : '0.0'} kbps
                    </div>
                  </div>
                  <div style={{ height: 70, margin: '0 -20px 10px -20px' }}>
                    <BandwidthLine bandwidthHistory={getSmoothedBandwidthHistory(bandwidthHistory, 5)} />
                  </div>
                </Col>
              </Row>
              <Row gutter={24} justify="start" style={{ marginTop: 24, marginLeft: "2px", height: "290px" }}>
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
                    <div style={{ height: '180px' }}>
                      <CPUUsageChart />
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
                    <div style={{ height: '180px' }}>
                      <MemoryUsageChart />
                    </div>
                  </div>
                </Col>
              </Row>
              {/* Disk Usage section */}
              <Row gutter={24} justify="start" style={{ marginTop: 24, marginLeft: "2px" }}>
                <Col className="gutter-row" span={23} style={performancewidgetStyle}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span
                        style={{
                          fontSize: "18px",
                          fontWeight: "500",
                          marginLeft: "1px",
                          userSelect: "none",
                        }}
                      >
                        Disk Usage {diskInfo.root_disk ? `(Root: ${diskInfo.root_disk})` : ''}
                      </span>
                    </div>
                    <Divider style={{ margin: "0 0 12px 0" }} />

                    {Array.isArray(diskInfo.partitions) && diskInfo.partitions.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {diskInfo.partitions.map((p, idx) => {
                          const totalGiB = p.total > 0 ? p.total / (1024 ** 3) : 0;
                          const usedGiB = p.used > 0 ? p.used / (1024 ** 3) : 0;
                          const percent = p.percent || (totalGiB > 0 ? (usedGiB / totalGiB) * 100 : 0);
                          const color = percent >= 90 ? '#f5222d' : percent >= 70 ? '#faad14' : '#4c8dff';
                          const tooltip = (
                            <div style={{ fontSize: 12, lineHeight: 1.5, maxWidth: '100%' }}>
                              <div style={{ fontWeight: 600, marginBottom: 6 }}>Mount: {p.mountpoint || '/'}</div>
                              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                                <thead>
                                  <tr>
                                    <th style={{ textAlign: 'left', borderBottom: '1px solid #eee', padding: '4px 6px' }}>Field</th>
                                    <th style={{ textAlign: 'left', borderBottom: '1px solid #eee', padding: '4px 6px' }}>Value</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr>
                                    <td style={{ padding: '4px 6px' }}>Device</td>
                                    <td style={{ padding: '4px 6px' }}>{p.device || '—'}</td>
                                  </tr>
                                  <tr>
                                    <td style={{ padding: '4px 6px' }}>Filesystem</td>
                                    <td style={{ padding: '4px 6px' }}>{p.fstype || '—'}</td>
                                  </tr>
                                  <tr>
                                    <td style={{ padding: '4px 6px' }}>Used</td>
                                    <td style={{ padding: '4px 6px', color: color, fontWeight: 600 }}>{formatBytes(p.used)} ({percent.toFixed(1)}%)</td>
                                  </tr>
                                  <tr>
                                    <td style={{ padding: '4px 6px' }}>Total</td>
                                    <td style={{ padding: '4px 6px' }}>{formatBytes(p.total)}</td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          );
                          return (
                            <div key={`${p.mountpoint || 'root'}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
                              <div style={{ width: 160, fontSize: 13, color: '#2c3e50', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${p.mountpoint || '/'} (${p.fstype || ''})`}>
                                {p.mountpoint || '/'}
                              </div>
                              <div style={{ flex: 1 }}>
                                <UsageBar used={Number(usedGiB.toFixed(1))} total={Number(totalGiB.toFixed(1))} color={color} tooltip={tooltip} tooltipWidth={440} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={{ color: '#8c8c8c', fontSize: 13 }}>Disk usage information not available.</div>
                    )}
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
                value={dockerSearchText}
                onChange={(e) => {
                  setDockerSearchText(e.target.value);
                  const value = e.target.value.toLowerCase();
                  const filtered = dockerContainers.filter(container =>
                    (container.dockerId || "").toLowerCase().includes(value) ||
                    (container.containerName || "").toLowerCase().includes(value) ||
                    (container.status || "").toLowerCase().includes(value)
                  );
                  setFilteredContainers(filtered);
                  // Reset to first page on new filter
                  setDockerCurrentPage(1);
                }}
              />

              {/* Docker Containers Table */}
              <Table
                dataSource={filteredContainers}
                columns={dockerColumns}
                pagination={{
                  current: dockerCurrentPage,
                  pageSize: dockerPageSize,
                  showSizeChanger: true,
                  pageSizeOptions: [5, 10, 20, 50],
                  showQuickJumper: true,
                  showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} containers`,
                  onChange: (page, size) => {
                    setDockerCurrentPage(page);
                    if (size && size !== dockerPageSize) {
                      setDockerPageSize(size);
                      sessionStorage.setItem('docker_page_size', String(size));
                    }
                  },
                  onShowSizeChange: (_, size) => {
                    setDockerCurrentPage(1);
                    setDockerPageSize(size);
                    sessionStorage.setItem('docker_page_size', String(size));
                  },
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
