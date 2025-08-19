import React from 'react';
import Layout1 from '../Components/layout';
import { theme, Layout, Tabs, Table, Badge, Button, Input } from 'antd';
import { SyncOutlined } from '@ant-design/icons';
import axios from 'axios';

const { Content } = Layout;
// const hostIP = window.location.hostname;
const hostIP = "192.168.20.4"

const ServiceStatus = () => {
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();
  const [activeSection, setActiveSection] = React.useState('status'); // 'status' | 'operations'

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

  const normalizeLogs = (payload) => Array.isArray(payload)
    ? payload
    : (typeof payload === 'string' ? payload.split('\n') : []);

  const fetchOperationLogs = async () => {
    try {
      const res = await axios.get(`https://${hostIP}:2020/api/operation_logs`, {
        headers: { 'Content-Type': 'application/json' }
      });
      const data = res.data ?? [];
      setOperationLogs(normalizeLogs(data));
    } catch (e) {
      setOperationLogs((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] Failed to fetch operation logs.`
      ]);
    }
  };

  const clearOperationLogs = () => setOperationLogs([]);

  // Auto-fetch logs when Operations tab is opened
  React.useEffect(() => {
    if (activeSection === 'operations') {
      fetchOperationLogs();
    }
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
                borderRadius: borderRadiusLG,
                flex: 1,
                cursor: 'pointer',
                border: '1px solid rgba(0,0,0,0.04)',
                boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                transition: 'box-shadow 0.2s ease, background 0.2s ease, border-color 0.2s ease',
              }}
            >
              <h2 style={{ marginTop: '0px' }}>Services Status </h2>
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
                borderRadius: borderRadiusLG,
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
                <h3 style={{ marginTop: 0 }}>Services Status</h3>
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
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <h3 style={{ marginTop: 0, marginBottom: 0 }}>Service operations</h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Button onClick={clearOperationLogs}>Clear</Button>
                  </div>
                </div>
                <div
                  style={{
                    background: '#0b0b0b',
                    color: '#e5e7eb',
                    border: '1px solid #111827',
                    borderRadius: 8,
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
              </div>
            )}
          </div>
        </Content>
      </Layout>
    </Layout1>
  );
};

export default ServiceStatus;
