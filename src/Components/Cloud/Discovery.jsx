import React, { useState, useEffect } from 'react';
import { Table, Button, Input, Form, Space, message } from 'antd';

const subnetRegex = /^([0-9]{1,3}\.){3}[0-9]{1,3}\/(\d|[1-2]\d|3[0-2])$/;
const hostIP = window.location.hostname;

const Cloud = ({ onNext, results, setResults }) => {
  const [form] = Form.useForm();
  const [subnet, setSubnet] = useState('');
  const [scanLoading, setScanLoading] = useState(false);
  // const [refreshLoading, setRefreshLoading] = useState(false);
  const [data, setData] = useState(results || []);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);

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

  // useEffect(() => {
  //   fetchScan(); // Default: scan local network
  // }, []);

  const handleSubnetScan = () => {
    form.validateFields().then(values => {
      fetchScan(values.subnet, 'scan');
    });
  };

  // const handleRefresh = () => {
  //   fetchScan(form.getFieldValue('subnet'), 'refresh');
  // };

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
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
        <Button
          type="primary"
          disabled={selectedRowKeys.length === 0}
          onClick={() => {
            const selected = data.filter(row => selectedRowKeys.includes(row.ip + (row.mac || '')));
            onNext && onNext(selected, data); // Pass both selection and all scan results
          }}
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
        dataSource={data}
        rowKey={record => record.ip + (record.mac || '')}
        loading={scanLoading}
        pagination={false}
        style={{ marginBottom: 16 }}
      />
    </div>
  );
};

export default Cloud;
