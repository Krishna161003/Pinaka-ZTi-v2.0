import React, { useState, useMemo } from "react";
import {
  Divider,
  Table,
  Button,
  Form,
  Input,
  message
} from "antd";


const getCloudName = () => {
  const fromSession = sessionStorage.getItem('cloudName');
  if (fromSession) return fromSession;
  const meta = document.querySelector('meta[name="cloud-name"]');
  return meta ? meta.content : null; // Return the content of the meta tag
};

const hostIP = window.location.hostname;

const subnetRegex = /^([0-9]{1,3}\.){3}[0-9]{1,3}\/(\d|[1-2]\d|3[0-2])$/;

const DataTable = ({ next }) => {
  const cloudName = getCloudName();
  const [form] = Form.useForm();
  const [scanLoading, setScanLoading] = useState(false);
  const [data, setData] = useState([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [searchText, setSearchText] = useState('');

  const fetchScan = async (customSubnet = '') => {
    setScanLoading(true);
    let url = `https://${hostIP}:2020/scan`;
    if (customSubnet) {
      url += `?subnet=${encodeURIComponent(customSubnet)}`;
    }
    try {
      const res = await fetch(url);
      const result = await res.json();
      if (res.ok) {
        const scanData = Array.isArray(result) ? result : (result.active_nodes || []);
        setData(scanData);
      } else {
        message.error(result.error || 'Failed to scan the network.');
        setData([]);
      }
    } catch (err) {
      message.error('Network error.');
      setData([]);
    } finally {
      setScanLoading(false);
    }
  };

  const handleSubnetScan = () => {
    form
      .validateFields()
      .then((values) => {
        fetchScan(values.subnet || '');
      })
      .catch(() => {});
  };

  // Filter data based on search text
  const filteredData = useMemo(() => {
    if (!searchText) return data;
    const q = searchText.toLowerCase();
    return data.filter((row) => {
      return (
        (row.ip || '').toLowerCase().includes(q) ||
        (row.mac || '').toLowerCase().includes(q) ||
        (row.last_seen || '').toLowerCase().includes(q)
      );
    });
  }, [data, searchText]);

  // Ensure selectedRowKeys only includes keys that exist in the current filtered data
  const displayedSelectedRowKeys = useMemo(() => {
    const filteredRowKeys = new Set(filteredData.map(row => row.ip + (row.mac || '')));
    return selectedRowKeys.filter(key => filteredRowKeys.has(key));
  }, [selectedRowKeys, filteredData]);

  const columns = [
    { title: 'IP Address', dataIndex: 'ip', key: 'ip' },
    { title: 'MAC Address', dataIndex: 'mac', key: 'mac' },
    { title: 'Last Seen', dataIndex: 'last_seen', key: 'last_seen' },
  ];

  return (
    <div style={{ padding: '20px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <h4 style={{ marginBottom: '-16px', marginTop: '3px' }}>
          Cloud Name: <span style={{ color: '#1890ff' }}>{cloudName}</span>
        </h4>
        <Button
          size="middle"
          style={{ width: '75px' }}
          type="primary"
          disabled={selectedRowKeys.length === 0}
          onClick={() => {
            if (!next) return;
            const selected = data.filter(
              (row) => selectedRowKeys.includes((row.ip || '') + (row.mac || ''))
            );
            next(selected);
          }}
        >
          Next
        </Button>
      </div>

      <Divider style={{ marginBottom: '18px', marginTop: '28px' }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <Form form={form} layout="inline" initialValues={{ subnet: '' }}>
          <Form.Item
            name="subnet"
            rules={[
              { pattern: subnetRegex, message: 'Enter valid subnet (e.g. 192.168.1.0/24)' },
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
      </div>

      <Table
        rowSelection={{
          type: 'checkbox',
          selectedRowKeys: displayedSelectedRowKeys,
          onChange: (selectedKeys) => {
            // When selecting, we need to preserve previous selections that might not be visible
            const filteredKeys = new Set(filteredData.map(row => row.ip + (row.mac || '')));
            // Keep all previously selected keys that are not in the current view
            const preservedKeys = selectedRowKeys.filter(key => !filteredKeys.has(key));
            // Add the newly selected keys
            setSelectedRowKeys([...preservedKeys, ...selectedKeys]);
          },
        }}
        columns={columns}
        dataSource={filteredData}
        rowKey={(record) => record.ip + (record.mac || '')}
        loading={scanLoading}
        pagination={false}
        style={{ marginBottom: 16 }}
      />
    </div>
  );
};

export default DataTable;