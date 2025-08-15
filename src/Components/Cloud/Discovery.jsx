import React, { useState, useEffect } from 'react';
import { Table, Button, Input, Form, Space, message, Modal } from 'antd';

const subnetRegex = /^([0-9]{1,3}\.){3}[0-9]{1,3}\/(\d|[1-2]\d|3[0-2])$/;
const hostIP = window.location.hostname;

const Cloud = ({ onNext, results, setResults }) => {
  const [form] = Form.useForm();
  const [subnet, setSubnet] = useState('');
  const [scanLoading, setScanLoading] = useState(false);
  // const [refreshLoading, setRefreshLoading] = useState(false);
  const [data, setData] = useState(results || []);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [searchText, setSearchText] = useState('');

  // Helper: get userId from sessionStorage
  const getUserId = () => {
    try {
      const loginDetails = JSON.parse(sessionStorage.getItem('loginDetails'));
      return loginDetails?.data?.id || sessionStorage.getItem('user_id') || sessionStorage.getItem('userId') || null;
    } catch (_) {
      return sessionStorage.getItem('user_id') || sessionStorage.getItem('userId') || null;
    }
  };

  // Fetch scan results
  const fetchScan = async (customSubnet = '', type = 'scan') => {
    if (type === 'scan') setScanLoading(true);
    // if (type === 'refresh') setRefreshLoading(true);
    let url = `https://${hostIP}:2020/scan`;
    if (customSubnet) {
      url += `?subnet=${encodeURIComponent(customSubnet)}`;
    }
    try {
      const res = await fetch(url);
      const result = await res.json();
      if (res.ok) {
        // Use active_nodes from backend response
        const scanData = Array.isArray(result) ? result : (result.active_nodes || []);
        setData(scanData);
        setResults && setResults(scanData);
      } else {
        message.error(result.error || 'Failed to scan the network.');
        setData([]);
      }
    } catch (err) {
      message.error('Network error.');
      setData([]);
    } finally {
      setScanLoading(false);
      // setRefreshLoading(false);
    }
  };

  const handleSubnetScan = () => {
    form.validateFields().then(values => {
      fetchScan(values.subnet, 'scan');
    });
  };

  // const handleRefresh = () => {
  //   fetchScan(form.getFieldValue('subnet'), 'refresh');
  // };

  // Validate selected IPs are not already used in deployed_server table
  const handleNextClick = async () => {
    const selected = data.filter(row => selectedRowKeys.includes(row.ip + (row.mac || '')));
    if (!selected.length) return;

    const selectedIPs = selected.map(s => (s.ip || '').trim()).filter(Boolean);
    if (!selectedIPs.length) return onNext && onNext(selected, data);

    const userId = getUserId();
    const url = new URL(`https://${hostIP}:5000/api/deployed-servers`);
    if (userId) url.searchParams.set('userId', userId);

    let deployed = [];
    try {
      const res = await fetch(url.toString());
      if (res.ok) {
        deployed = await res.json();
      } else {
        // If API fails, warn and proceed
        message.warning('Could not verify deployed servers. Proceeding without check.');
        return onNext && onNext(selected, data);
      }
    } catch (e) {
      message.warning('Network error during deployed servers check. Proceeding.');
      return onNext && onNext(selected, data);
    }

    // Build conflicts list: for each selected IP, check across columns
    const COLUMN_LABELS = {
      serverip: 'Server IP',
      server_vip: 'Server VIP',
      Management: 'Management',
      Storage: 'Storage',
      External_Traffic: 'External Traffic',
      VXLAN: 'VXLAN',
    };

    const conflicts = [];
    for (const row of deployed || []) {
      for (const [colKey, label] of Object.entries(COLUMN_LABELS)) {
        const v = (row?.[colKey] || '').trim();
        if (!v) continue;
        if (selectedIPs.includes(v)) {
          conflicts.push({
            ip: v,
            column: label,
            cloudname: row?.cloudname || '-',
            role: row?.role || '-',
            serverid: row?.serverid || '-',
          });
        }
      }
    }

    if (conflicts.length) {
      // Group by IP for clearer message
      const byIp = conflicts.reduce((acc, c) => {
        acc[c.ip] = acc[c.ip] || [];
        acc[c.ip].push(c);
        return acc;
      }, {});

      Modal.error({
        title: 'Selected IP(s) already used in deployed servers',
        width: 700,
        content: (
          <div>
            <p>The following selected IPs are already present in existing deployments. Please deselect or choose different nodes:</p>
            <ul style={{ paddingLeft: 18 }}>
              {Object.entries(byIp).map(([ip, items]) => (
                <li key={ip} style={{ marginBottom: 8 }}>
                  <strong>{ip}</strong>
                  <ul style={{ paddingLeft: 18, marginTop: 6 }}>
                    {items.map((it, idx) => (
                      <li key={ip + '-' + idx}>
                        In <strong>{it.column}</strong>
                        {it.cloudname && it.cloudname !== '-' ? ` | Cloud: ${it.cloudname}` : ''}
                        {it.role && it.role !== '-' ? ` | Role: ${it.role}` : ''}
                        {it.serverid && it.serverid !== '-' ? ` | Server ID: ${it.serverid}` : ''}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        ),
      });
      return; // Do not proceed
    }

    // No conflicts -> proceed
    onNext && onNext(selected, data);
  };

  const columns = [
    {
      title: 'IP Address',
      dataIndex: 'ip',
      key: 'ip',
    },
    {
      title: 'MAC Address',
      dataIndex: 'mac',
      key: 'mac',
    },
    {
      title: 'Last Seen',
      dataIndex: 'last_seen',
      key: 'last_seen',
    },
  ];

  // Sync data if results prop changes
  useEffect(() => {
    if (results) setData(results);
  }, [results]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <Form
          form={form}
          layout="inline"
          initialValues={{ subnet: '' }}
        >
          <Form.Item
            name="subnet"
            rules={[
              {
                pattern: subnetRegex,
                message: 'Enter valid subnet (e.g. 192.168.1.0/24)',
              },
            ]}
          >
            <Input
              placeholder="Enter subnet (e.g. 192.168.1.0/24) or leave blank for local"
              style={{ width: 260 }}
              allowClear
            />
          </Form.Item>
          <Form.Item>
            <Button type="primary" onClick={handleSubnetScan} loading={scanLoading}>
              Scan
            </Button>
          </Form.Item>
          {/* <Form.Item>
            <Button onClick={handleRefresh} loading={refreshLoading}>
              Refresh
            </Button>
          </Form.Item> */}
        </Form>
        <Input.Search
          placeholder="Search IP / MAC / Last Seen"
          allowClear
          onSearch={(val) => setSearchText(val)}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ width: 280 }}
          enterButton
          size="middle"
        />
        <Button
          type="primary"
          disabled={selectedRowKeys.length === 0}
          onClick={handleNextClick}
          style={{ size: "middle", width: "75px" }}
        >
          Next
        </Button>
      </div>
      <Table
        rowSelection={{
          type: 'checkbox',
          selectedRowKeys,
          onChange: setSelectedRowKeys,
        }}
        columns={columns}
        dataSource={data.filter((row) => {
          if (!searchText) return true;
          const q = searchText.toLowerCase();
          return (
            (row.ip || '').toLowerCase().includes(q) ||
            (row.mac || '').toLowerCase().includes(q) ||
            (row.last_seen || '').toLowerCase().includes(q)
          );
        })}
        rowKey={record => record.ip + (record.mac || '')}
        loading={scanLoading}
        pagination={false}
        style={{ marginBottom: 16 }}
      />

    </div>
  );
};

export default Cloud;