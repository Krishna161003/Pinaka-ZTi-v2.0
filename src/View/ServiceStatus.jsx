import React from 'react';
import Layout1 from '../Components/layout';
import { theme, Layout, Tabs, Table, Badge, Button, Input, Modal, Select } from 'antd';
import { SyncOutlined } from '@ant-design/icons';
import axios from 'axios';

const { Content } = Layout;
const hostIP = window.location.hostname;
const IP = "192.168.20.4";

const ServiceStatus = () => {
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();
  // Persist section in session and URL
  const SECTION_KEY = 'serviceStatus_activeSection';
  const getInitialSection = () => {
    try {
      const params = new URLSearchParams(window.location.search);
      const s = params.get('section') || sessionStorage.getItem(SECTION_KEY) || 'status';
      return (s === 'status' || s === 'operations') ? s : 'status';
    } catch (_) {
      return 'status';
    }
  };

  // Live log streaming via SSE (defined below after reconcileJobsFromLines)
  const [activeSection, setActiveSection] = React.useState(getInitialSection); // 'status' | 'operations'

  // Columns: Compute/Storage
  const columnsCompute = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    { title: 'Host', dataIndex: 'host', key: 'host' },
    { title: 'Availability Zone', dataIndex: 'az', key: 'az' },
    {
      title: 'Service Status',
      dataIndex: 'serviceStatus',
      key: 'serviceStatus',
      render: (val) => <Badge status={val === 'Enabled' ? 'success' : 'error'} text={val} />,
    },
    {
      title: 'Service State',
      dataIndex: 'serviceState',
      key: 'serviceState',
      render: (val) => <Badge status={val === 'Up' ? 'success' : 'error'} text={val} />,
    },
    { title: 'Last Updated', dataIndex: 'lastUpdated', key: 'lastUpdated' },
  ];

  // Columns: Network (no Last Updated; include Agent Type)
  const columnsNetwork = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    { title: 'Agent Type', dataIndex: 'agentType', key: 'agentType' },
    { title: 'Host', dataIndex: 'host', key: 'host' },
    { title: 'Availability Zone', dataIndex: 'az', key: 'az' },
    {
      title: 'Service Status',
      dataIndex: 'serviceStatus',
      key: 'serviceStatus',
      render: (val) => <Badge status={val === 'Enabled' ? 'success' : 'error'} text={val} />,
    },
    {
      title: 'Service State',
      dataIndex: 'serviceState',
      key: 'serviceState',
      render: (val) => <Badge status={val === 'Up' ? 'success' : 'error'} text={val} />,
    },
  ];

  // Data from backend
  const [computeData, setComputeData] = React.useState([]);
  const [neutronData, setNeutronData] = React.useState([]);
  const [blockData, setBlockData] = React.useState([]);

  // Normalizers
  const toTitle = (v) => (typeof v === 'string' ? v : (v == null ? '' : String(v)));
  const normStatus = (v) => {
    const s = toTitle(v).toLowerCase();
    if (!s) return '';
    return s === 'enabled' ? 'Enabled' : s === 'disabled' ? 'Disabled' : toTitle(v);
  };
  const normState = (v) => {
    const s = toTitle(v).toLowerCase();
    if (!s) return '';
    return s === 'up' ? 'Up' : s === 'down' ? 'Down' : toTitle(v);
  };

  // Convert boolean states from Neutron to Up/Down when backend returns true/false
  const boolToUpDown = (v) => (v === true ? 'Up' : v === false ? 'Down' : undefined);

  const mapCompute = (rows) => (rows || []).map((r, idx) => ({
    key: r.ID || r.Id || String(idx),
    name: r['Binary'] || r['binary'] || r['Name'] || r['name'] || '',
    host: r['Host'] || r['host'] || '',
    az: r['Zone'] || r['Availability Zone'] || r['zone'] || r['availability_zone'] || '',
    serviceStatus: normStatus(r['Status'] || r['status']),
    serviceState: normState(r['State'] || r['state']),
    lastUpdated: r['Updated At'] || r['updated_at'] || r['updated'] || '',
  }));

  const mapNeutron = (rows) => (rows || []).map((r, idx) => {
    const derivedState = boolToUpDown(r['State']) || boolToUpDown(r['Alive']);
    const derivedStatus = r['Status'] != null
      ? normStatus(r['Status'])
      : (r['Alive'] === true ? 'Enabled' : r['Alive'] === false ? 'Disabled' : '');
    return {
      key: r['ID'] || r['Id'] || String(idx),
      name: r['Binary'] || r['binary'] || r['Agent Type'] || r['agent_type'] || '',
      agentType: r['Agent Type'] || r['agent_type'] || '',
      host: r['Host'] || r['host'] || '',
      az: r['Availability Zone'] || r['availability_zone'] || r['Zone'] || 'N/A',
      serviceStatus: derivedStatus,
      serviceState: derivedState || normState(r['State'] || r['state']),
      lastUpdated: r['Updated At'] || r['updated_at'] || '',
    };
  });

  const mapBlock = (rows) => mapCompute(rows);

  const fetchOpenstackData = async () => {
    try {
      setTableLoading(true);
      const res = await axios.get(`https://${hostIP}:2020/api/openstack_data`, {
        headers: { 'Content-Type': 'application/json' }
      });
      const data = res.data || {};
      setComputeData(mapCompute(data.compute_services));
      setNeutronData(mapNeutron(data.network_agents));
      setBlockData(mapBlock(data.volume_services));
    } catch (e) {
      // Keep tables empty on error
      setComputeData([]);
      setNeutronData([]);
      setBlockData([]);
    } finally {
      setTableLoading(false);
    }
  };

  // Refresh handling (UI-only)
  const [tableLoading, setTableLoading] = React.useState(false);
  const [searchText, setSearchText] = React.useState('');
  const handleRefresh = () => {
    fetchOpenstackData();
  };

  // Operations logs terminal
  const [operationLogs, setOperationLogs] = React.useState([]);
  const logEndRef = React.useRef(null);
  const sseRef = React.useRef(null);
  const [opsLogsLoading, setOpsLogsLoading] = React.useState(false);
  const stopLogStream = React.useCallback(() => {
    if (sseRef.current) {
      try { sseRef.current.close(); } catch (_) { /* no-op */ }
      sseRef.current = null;
    }
  }, []);
  // Persisted operation busy state & job tracking
  const OPS_BUSY_KEY = 'service_ops_busy';
  const OPS_JOB_IDS_KEY = 'service_ops_job_ids';
  const [opsBusy, setOpsBusy] = React.useState(() => {
    try { return localStorage.getItem(OPS_BUSY_KEY) === '1'; } catch (_) { return false; }
  });
  const getJobIds = React.useCallback(() => {
    try { return JSON.parse(localStorage.getItem(OPS_JOB_IDS_KEY) || '[]'); } catch (_) { return []; }
  }, []);
  const saveJobIds = React.useCallback((ids) => {
    try {
      localStorage.setItem(OPS_JOB_IDS_KEY, JSON.stringify(ids));
      if (ids.length > 0) {
        localStorage.setItem(OPS_BUSY_KEY, '1');
      } else {
        localStorage.removeItem(OPS_BUSY_KEY);
      }
    } catch (_) { /* no-op */ }
    setOpsBusy(ids.length > 0);
  }, []);
  const markJobStarted = React.useCallback((jobId) => {
    if (!jobId) return;
    const ids = getJobIds();
    if (!ids.includes(jobId)) {
      ids.push(jobId);
      saveJobIds(ids);
    } else {
      saveJobIds(ids); // ensure busy flag
    }
  }, [getJobIds, saveJobIds]);
  const markJobEnded = React.useCallback((jobId) => {
    if (!jobId) return;
    const ids = getJobIds().filter((id) => id !== jobId);
    saveJobIds(ids);
  }, [getJobIds, saveJobIds]);
  const reconcileJobsFromLines = React.useCallback((lines) => {
    const arr = Array.isArray(lines) ? lines : [lines];
    if (arr.length === 0) return;
    const endIds = [];
    const startIds = [];
    arr.forEach((ln) => {
      if (typeof ln !== 'string') return;
      const mEnd = ln.match(/JOB END\s+(job-\d+)/);
      if (mEnd && mEnd[1]) endIds.push(mEnd[1]);
      // Treat error/failed endings as job end to re-enable buttons
      const mErr = ln.match(/JOB\s+(?:ERROR|FAILED)\s+(job-\d+)/i);
      if (mErr && mErr[1]) endIds.push(mErr[1]);
      const mStart = ln.match(/JOB START\s+(job-\d+)/);
      if (mStart && mStart[1]) startIds.push(mStart[1]);
      // Generic fallback: if line shows error and references a job id, end that job
      if (!mEnd && !mErr && /(ERROR|Failed|failure|non-zero exit|exited with code [1-9])/i.test(ln)) {
        const mAnyJob = ln.match(/(job-\d+)/);
        if (mAnyJob && mAnyJob[1]) endIds.push(mAnyJob[1]);
      }
    });
    if (startIds.length) startIds.forEach((id) => markJobStarted(id));
    if (endIds.length) endIds.forEach((id) => markJobEnded(id));
  }, [markJobEnded, markJobStarted]);

  // Live log streaming via SSE
  const startLogStream = React.useCallback(() => {
    if (sseRef.current) return; // already streaming
    try {
      const es = new EventSource(`https://${IP}:2020/kolla/logs/stream`);
      es.onmessage = (evt) => {
        const line = evt?.data ?? '';
        if (line) {
          setOperationLogs((prev) => [...prev, line]);
          reconcileJobsFromLines([line]);
        }
      };
      es.onerror = () => {
        try { es.close(); } catch (_) { /* no-op */ }
        sseRef.current = null;
      };
      sseRef.current = es;
    } catch (_) {
      // Ignore; fallback remains manual refresh / snapshot fetches
    }
  }, [reconcileJobsFromLines]);
  // Reconfigure modal state
  const [reconfigureOpen, setReconfigureOpen] = React.useState(false);
  const [selectedNodes, setSelectedNodes] = React.useState([]);
  const [selectedServices, setSelectedServices] = React.useState([]);
  // Database recovery modal state
  const [dbRecoveryOpen, setDbRecoveryOpen] = React.useState(false);

  // Dropdown data: real nodes fetched from backend, services remain static for now
  const [nodeOptions, setNodeOptions] = React.useState(['All']);
  const [nodeLoading, setNodeLoading] = React.useState(false);
  const DUMMY_SERVICE_OPTIONS = ['All', 'octavia','nova-compute', 'nova-scheduler', 'neutron-server', 'neutron-dhcp-agent', 'cinder-volume', 'glance-api', 'keystone'];
  const serviceOptions = React.useMemo(() => DUMMY_SERVICE_OPTIONS, [DUMMY_SERVICE_OPTIONS]);
  const nodeSelectOptions = React.useMemo(() => (
    nodeOptions.map(v => ({ label: v, value: v, disabled: selectedNodes.includes('All') && v !== 'All' }))
  ), [nodeOptions, selectedNodes]);
  const serviceSelectOptions = React.useMemo(() => (
    serviceOptions.map(v => ({ label: v, value: v, disabled: selectedServices.includes('All') && v !== 'All' }))
  ), [serviceOptions, selectedServices]);

  // Handle multiselect semantics for services: 'All' is exclusive/default
  const handleServicesChange = (vals) => {
    if (!Array.isArray(vals) || vals.length === 0) {
      setSelectedServices([]);
      return;
    }
    if (vals.includes('All')) {
      setSelectedServices(['All']);
    } else {
      setSelectedServices(vals);
    }
  };

  // Handle multiselect semantics for nodes: 'All' is exclusive/default
  const handleNodesChange = (vals) => {
    if (!Array.isArray(vals) || vals.length === 0) {
      setSelectedNodes([]);
      return;
    }
    if (vals.includes('All')) {
      setSelectedNodes(['All']);
    } else {
      setSelectedNodes(vals);
    }
  };

  const fetchNodeOptions = React.useCallback(async () => {
    try {
      setNodeLoading(true);
      const userId = JSON.parse(sessionStorage.getItem('loginDetails'))?.data?.id;
      const res = await axios.get(`https://${hostIP}:5000/api/deployed-server-ips-dropdown`, {
        params: { userId }
      });
      const ips = Array.isArray(res.data)
        ? res.data
        : (Array.isArray(res.data?.ips) ? res.data.ips : []);
      const uniq = Array.from(new Set(ips.filter(Boolean)));
      setNodeOptions(['All', ...uniq]);
    } catch (e) {
      // Fallback to just 'All' on error
      setNodeOptions(['All']);
    } finally {
      setNodeLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchNodeOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const normalizeLogs = (payload) => Array.isArray(payload)
    ? payload
    : (typeof payload === 'string' ? payload.split('\n') : []);

  const fetchOperationLogs = async () => {
    setOpsLogsLoading(true);
    try {
      const res = await axios.get(`https://${IP}:2020/kolla/logs/last`, {
        params: { lines: 200 },
        headers: { 'Content-Type': 'application/json' }
      });
      const data = res.data ?? {};
      const lines = Array.isArray(data.log) ? data.log : [];
      setOperationLogs(lines);
      // Reconcile busy state with last logs snapshot
      reconcileJobsFromLines(lines);
    } catch (e) {
      setOperationLogs((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] Failed to fetch operation logs.`
      ]);
    } finally {
      setOpsLogsLoading(false);
    }
  };

  // Start a kolla job on Flask backend (port 2020)
  const runKolla = async (payload) => {
    try {
      const res = await axios.post(`https://${IP}:2020/kolla/run`, payload, {
        headers: { 'Content-Type': 'application/json' }
      });
      const { job_id, command } = res.data || {};
      setOperationLogs((prev) => ([
        ...prev,
        `[${new Date().toLocaleTimeString()}] Started job ${job_id || ''}: ${command || JSON.stringify(payload)}`
      ]));
      if (job_id) markJobStarted(job_id);
      return res.data;
    } catch (e) {
      const msg = e?.response?.data?.error || e.message;
      setOperationLogs((prev) => ([
        ...prev,
        `[${new Date().toLocaleTimeString()}] Failed to start job: ${msg}`
      ]));
      throw e;
    }
  };

  // Operations actions
  const reconfigureService = () => {
    if (opsBusy) return;
    setSelectedNodes([]);
    setSelectedServices([]);
    setReconfigureOpen(true);
  };

  const databaseRecovery = () => {
    if (opsBusy) return;
    setDbRecoveryOpen(true);
  };

  const handleReconfigureConfirm = async () => {
    const nodes = (selectedNodes.includes('All') || selectedNodes.length === 0) ? [] : selectedNodes;
    const services = (selectedServices.includes('All') || selectedServices.length === 0) ? [] : selectedServices;

    setOperationLogs((prev) => [
      ...prev,
      `[${new Date().toLocaleTimeString()}] Reconfigure triggered. Nodes: ${nodes.length ? nodes.join(', ') : 'ALL'}, Services: ${services.length ? services.join(', ') : 'ALL'}`
    ]);

    // Build job payloads based on selections
    const jobs = [];
    if (nodes.length === 0 && services.length === 0) {
      jobs.push({ action: 'reconfigure_all' });
    } else if (nodes.length > 0 && services.length === 0) {
      nodes.forEach((n) => jobs.push({ action: 'reconfigure_node', node: n }));
    } else if (nodes.length === 0 && services.length > 0) {
      services.forEach((s) => jobs.push({ action: 'reconfigure_service', service: s }));
    } else {
      nodes.forEach((n) => services.forEach((s) => jobs.push({ action: 'reconfigure_node_service', node: n, service: s })));
    }

    // Immediately mark busy to prevent duplicate actions while requests are in-flight
    try { localStorage.setItem(OPS_BUSY_KEY, '1'); } catch (_) { /* no-op */ }
    setOpsBusy(true);
    // Close modal right after process starts
    setReconfigureOpen(false);
    const results = await Promise.allSettled(jobs.map((p) => runKolla(p)));
    // If none started successfully, clear busy state to re-enable buttons
    const anyStarted = results.some(r => r.status === 'fulfilled' && r.value && r.value.job_id);
    if (!anyStarted) {
      saveJobIds([]);
    }
    // Fetch latest logs snapshot after starting
    await fetchOperationLogs();
  };

  const handleDbRecoveryConfirm = async () => {
    setOperationLogs((prev) => ([
      ...prev,
      `[${new Date().toLocaleTimeString()}] MariaDB Recovery: starting...`
    ]));
    // Immediately mark busy and close modal after process starts
    try { localStorage.setItem(OPS_BUSY_KEY, '1'); } catch (_) { /* no-op */ }
    setOpsBusy(true);
    setDbRecoveryOpen(false);
    try {
      await runKolla({ action: 'mariadb_recovery' });
    } catch (_) {
      // If start failed, clear busy
      saveJobIds([]);
    } finally {
      await fetchOperationLogs();
    }
  };

  const clearOperationLogs = () => setOperationLogs([]);

  // Auto-fetch and stream logs when Operations tab is opened
  React.useEffect(() => {
    if (activeSection === 'operations') {
      fetchOperationLogs();
      startLogStream();
    } else {
      stopLogStream();
    }
    return () => {
      // cleanup on unmount or tab switch
      stopLogStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection]);

  // Auto-scroll terminal to bottom on new logs
  React.useEffect(() => {
    if (logEndRef.current && activeSection === 'operations') {
      try {
        logEndRef.current.scrollIntoView({ behavior: 'smooth' });
      } catch (_) { /* no-op */ }
    }
  }, [operationLogs, activeSection]);

  // Sync active section to sessionStorage and URL
  React.useEffect(() => {
    try { sessionStorage.setItem(SECTION_KEY, activeSection); } catch (_) { /* no-op */ }
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('section', activeSection);
      window.history.replaceState(null, '', url.toString());
    } catch (_) { /* no-op */ }
  }, [activeSection]);

  // Respond to browser navigation (back/forward)
  React.useEffect(() => {
    const onPop = () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const s = params.get('section');
        if (s === 'status' || s === 'operations') {
          setActiveSection(s);
        }
      } catch (_) { /* no-op */ }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  React.useEffect(() => {
    fetchOpenstackData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Layout1>
      <Layout>
        <Content style={{ margin: "16px 16px" }}>
          <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'nowrap' }}>
            <div
              role="button"
              tabIndex={0}
              aria-pressed={activeSection === 'status'}
              onClick={() => setActiveSection('status')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setActiveSection('status'); }}
              style={{
                padding: 30,
                minHeight: 'auto',
                background: colorBgContainer,
                // borderRadius: borderRadiusLG,
                flex: 1,
                cursor: 'pointer',
                border: '1px solid rgba(0,0,0,0.04)',
                boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                transition: 'box-shadow 0.2s ease, background 0.2s ease, border-color 0.2s ease',
              }}
            >
              <h2 style={{ marginTop: '0px' }}>Service Status </h2>
            </div>
            <div
              role="button"
              tabIndex={0}
              aria-pressed={activeSection === 'operations'}
              onClick={() => setActiveSection('operations')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setActiveSection('operations'); }}
              style={{
                padding: 30,
                minHeight: 'auto',
                background: colorBgContainer,
                // borderRadius: borderRadiusLG,
                flex: 1,
                cursor: 'pointer',
                border: '1px solid rgba(0,0,0,0.04)',
                boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                transition: 'box-shadow 0.2s ease, background 0.2s ease, border-color 0.2s ease',
              }}
            >
              <h2 style={{ marginTop: '0px' }}>Service operations </h2>
            </div>
          </div>
          <div style={{
            marginTop: 10,
            padding: 30,
            minHeight: "auto",
            background: colorBgContainer,
            // borderRadius: borderRadiusLG,
          }}>
            {activeSection === 'status' ? (
              <>
                <h3 style={{ marginTop: 0 }}>Service Status</h3>
                <Tabs
                  defaultActiveKey="compute"
                  tabBarExtraContent={{
                    right: (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Button
                          aria-label="Refresh"
                          onClick={handleRefresh}
                          icon={<SyncOutlined spin={tableLoading} />}
                          style={{
                            borderColor: '#1677ff',
                            color: '#1677ff',
                            borderRadius: 8,
                          }}
                        />
                        <Input.Search
                          allowClear
                          placeholder="Search..."
                          style={{ width: 280 }}
                          value={searchText}
                          onSearch={(val) => setSearchText(val)}
                          onChange={(e) => setSearchText(e.target.value)}
                        />
                      </div>
                    )
                  }}
                  items={[
                    {
                      key: 'compute',
                      label: 'Compute',
                      children: (
                        <Table
                          rowKey="key"
                          columns={columnsCompute}
                          dataSource={computeData.filter(row => {
                            if (!searchText) return true;
                            const q = searchText.toLowerCase();
                            return [row.name, row.host, row.az, row.serviceStatus, row.serviceState, row.lastUpdated]
                              .some(v => (v || '').toLowerCase().includes(q));
                          })}
                          loading={tableLoading}
                          pagination={{ pageSize: 10 }}
                        />
                      ),
                    },
                    {
                      key: 'neutron',
                      label: 'Network',
                      children: (
                        <Table
                          rowKey="key"
                          columns={columnsNetwork}
                          dataSource={neutronData.filter(row => {
                            if (!searchText) return true;
                            const q = searchText.toLowerCase();
                            return [row.name, row.agentType, row.host, row.az, row.serviceStatus, row.serviceState]
                              .some(v => (v || '').toLowerCase().includes(q));
                          })}
                          loading={tableLoading}
                          pagination={{ pageSize: 10 }}
                        />
                      ),
                    },
                    {
                      key: 'block',
                      label: 'Storage',
                      children: (
                        <Table
                          rowKey="key"
                          columns={columnsCompute}
                          dataSource={blockData.filter(row => {
                            if (!searchText) return true;
                            const q = searchText.toLowerCase();
                            return [row.name, row.host, row.az, row.serviceStatus, row.serviceState, row.lastUpdated]
                              .some(v => (v || '').toLowerCase().includes(q));
                          })}
                          loading={tableLoading}
                          pagination={{ pageSize: 10 }}
                        />
                      ),
                    },
                  ]}
                />
              </>
            ) : (
              <>
                <h3 style={{ marginTop: 0 }}>Service Operations</h3>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Button
                      type="primary"
                      size="middle"
                      aria-label="Reconfigure Service"
                      onClick={reconfigureService}
                      disabled={opsBusy}
                      style={{ width: 220, flex: '0 0 auto' }}
                    >
                      Reconfigure Service
                    </Button>
                    <Button
                      type="primary"
                      size="middle"
                      aria-label="Database Recovery"
                      onClick={databaseRecovery}
                      disabled={opsBusy}
                      style={{ width: 220, flex: '0 0 auto' }}
                    >
                      Database Recovery
                    </Button>
                    {opsBusy && <span style={{ color: '#1677ff' }}>Operation in progress…</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Button
                      aria-label="Clear Logs"
                      onClick={clearOperationLogs}
                      style={{ borderColor: '#1677ff', color: '#1677ff', borderRadius: 8 }}
                    >
                      Clear
                    </Button>
                    <Button
                      aria-label="Refresh"
                      onClick={fetchOperationLogs}
                      icon={<SyncOutlined spin={opsLogsLoading} />}
                      style={{ borderColor: '#1677ff', color: '#1677ff', borderRadius: 8 }}
                    />
                  </div>
                </div>

                <Modal
                  title="Reconfigure Service"
                  open={reconfigureOpen}
                  onOk={handleReconfigureConfirm}
                  onCancel={() => setReconfigureOpen(false)}
                  okText="Run Reconfigure"
                  cancelText="Cancel"
                  okButtonProps={{ style: { width: 160 }, disabled: opsBusy }}
                  cancelButtonProps={{ style: { width: 100 } }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                      <div style={{ marginBottom: 6, fontWeight: 500 }}>Select Node</div>
                      <Select
                        mode="multiple"
                        value={selectedNodes}
                        onChange={handleNodesChange}
                        style={{ width: '100%' }}
                        loading={nodeLoading}
                        placeholder="Select node(s)"
                        maxTagCount="responsive"
                        options={nodeSelectOptions}
                      />
                    </div>
                    <div>
                      <div style={{ marginBottom: 6, fontWeight: 500 }}>Select OpenStack Service</div>
                      <Select
                        mode="multiple"
                        value={selectedServices}
                        onChange={handleServicesChange}
                        style={{ width: '100%' }}
                        placeholder="Select service(s)"
                        maxTagCount="responsive"
                        options={serviceSelectOptions}
                      />
                    </div>
                  </div>
                </Modal>

                <Modal
                  title="Database Recovery"
                  open={dbRecoveryOpen}
                  onOk={handleDbRecoveryConfirm}
                  onCancel={() => setDbRecoveryOpen(false)}
                  okText="Run Recovery"
                  cancelText="Cancel"
                  okButtonProps={{ style: { width: 160 }, disabled: opsBusy }}
                  cancelButtonProps={{ style: { width: 100 } }}
                >
                  <p>Are you sure you want to run MariaDB recovery? This may restart database services and attempt to repair the cluster.</p>
                </Modal>

                <div
                  style={{
                    background: '#0b0b0b',
                    color: '#e5e7eb',
                    border: '1px solid #111827',
                    // borderRadius: 8,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                    fontSize: 12,
                    lineHeight: 1.5,
                    padding: 12,
                    height: 340,
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {operationLogs.length === 0 ? (
                    <div style={{ color: '#9ca3af' }}>No logs yet.</div>
                  ) : (
                    operationLogs.map((line, idx) => (
                      <div key={idx}>{line}</div>
                    ))
                  )}
                  <div ref={logEndRef} />
                </div>
              </>
            )}
          </div>
        </Content>
      </Layout>
    </Layout1>
  );
};

export default ServiceStatus;
