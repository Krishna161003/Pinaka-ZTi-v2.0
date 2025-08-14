import React from 'react';
import Layout1 from '../Components/layout';
import { theme, Layout, Tabs, Table, Badge, Select } from 'antd';

const { Content } = Layout;

const ServiceStatus = () => {
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  // Columns shared across tabs
  const columns = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    { title: 'Host', dataIndex: 'host', key: 'host' },
    { title: 'Availability Zone', dataIndex: 'az', key: 'az' },
    {
      title: 'Service Status',
      dataIndex: 'serviceStatus',
      key: 'serviceStatus',
      render: (val) => <Badge status={val === 'Enabled' ? 'success' : 'default'} text={val} />,
    },
    {
      title: 'Service State',
      dataIndex: 'serviceState',
      key: 'serviceState',
      render: (val) => <Badge status={val === 'Up' ? 'success' : 'error'} text={val} />,
    },
    { title: 'Last Updated', dataIndex: 'lastUpdated', key: 'lastUpdated' },
    {
      title: 'Action',
      key: 'action',
      render: (_, record) => (
        record.action ? <a style={{ color: '#ff4d4f' }} onClick={() => { /* noop */ }}>{record.action}</a> : null
      ),
    },
  ];

  // Sample data (placeholder). Replace with backend data when available.
  const computeData = [
    { key: '1', name: 'nova-scheduler', host: 'FD-001', az: 'internal', serviceStatus: 'Enabled', serviceState: 'Up', lastUpdated: 'a few seconds ago' },
    { key: '2', name: 'nova-conductor', host: 'FD-001', az: 'internal', serviceStatus: 'Enabled', serviceState: 'Up', lastUpdated: 'a few seconds ago' },
    { key: '3', name: 'nova-compute', host: 'FD-001', az: 'nova', serviceStatus: 'Enabled', serviceState: 'Up', lastUpdated: 'a few seconds ago', action: 'Disable' },
  ];
  const neutronData = [
    { key: '1', name: 'neutron-server', host: 'FD-001', az: 'internal', serviceStatus: 'Enabled', serviceState: 'Up', lastUpdated: 'a few seconds ago' },
  ];
  const blockData = [
    { key: '1', name: 'cinder-scheduler', host: 'FD-001', az: 'internal', serviceStatus: 'Enabled', serviceState: 'Up', lastUpdated: 'a few seconds ago' },
  ];

  // Tag-like search box state and options (UI only for now)
  const [filterTags, setFilterTags] = React.useState([]);
  const filterOptions = [
    {
      label: 'Fields',
      options: [
        { label: 'Name', value: 'Name' },
        { label: 'Host', value: 'Host' },
        { label: 'Availability Zone', value: 'Availability Zone' },
        { label: 'Service Status', value: 'Service Status' },
        { label: 'Service State', value: 'Service State' },
      ],
    },
    {
      label: 'Service Status',
      options: [
        { label: 'Enabled', value: 'Enabled' },
        { label: 'Disabled', value: 'Disabled' },
      ],
    },
    {
      label: 'Service State',
      options: [
        { label: 'Up', value: 'Up' },
        { label: 'Down', value: 'Down' },
      ],
    },
  ];

  return (
    <Layout1>
      <Layout>
        <Content style={{ margin: "16px 16px" }}>
          <div style={{
            padding: 30,
            minHeight: "auto",
            background: colorBgContainer,
            borderRadius: borderRadiusLG,
          }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <Select
                mode="tags"
                value={filterTags}
                onChange={setFilterTags}
                options={filterOptions}
                style={{ width: 420 }}
                placeholder="Multiple filter tags are separated by enter"
                allowClear
                showSearch
                maxTagCount="responsive"
                tokenSeparators={[',']}
                filterOption={(input, option) =>
                  (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                }
              />
            </div>

            <Tabs
              defaultActiveKey="compute"
              items={[
                {
                  key: 'compute',
                  label: 'Compute',
                  children: (
                    <Table
                      rowKey="key"
                      columns={columns}
                      dataSource={computeData}
                      pagination={{ pageSize: 10 }}
                    />
                  ),
                },
                {
                  key: 'neutron',
                  label: 'Network / Neutron',
                  children: (
                    <Table
                      rowKey="key"
                      columns={columns}
                      dataSource={neutronData}
                      pagination={{ pageSize: 10 }}
                    />
                  ),
                },
                {
                  key: 'block',
                  label: 'Storage / Block',
                  children: (
                    <Table
                      rowKey="key"
                      columns={columns}
                      dataSource={blockData}
                      pagination={{ pageSize: 10 }}
                    />
                  ),
                },
              ]}
            />
          </div>
        </Content>
      </Layout>
    </Layout1>
  );
};

export default ServiceStatus;
