import React, { useState, useEffect } from 'react';
import Layout1 from '../Components/layout';
import { Layout, Row, Col, Table, theme, Button, Badge, message, Popconfirm, Input, Space } from 'antd';
import { SyncOutlined } from '@ant-design/icons';

import upImage from '../Images/up_15362984.png';
import downImage from '../Images/down_15362973.png';
import node from '../Images/database_666406.png';
import axios from 'axios';

const hostIP=window.location.hostname;

const { Content } = Layout;
const style = {
  background: '#fff',
  padding: '16px 20px', // Reduced vertical padding for shorter Col height
  marginTop: '19px',
  marginRight: '25px',
  // borderRadius: '10px',
  cursor: 'pointer',
  boxShadow: '10px',
};

const Inventory = () => {
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();
  
  // React Router hooks removed (no tabs)

  // State for server data
  const [squadronServers, setSquadronServers] = useState([]);
  const [serverCounts, setServerCounts] = useState({ total: 0, online: 0, offline: 0 });
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');

  // Function to control server (shutdown, reboot)
  const controlServer = async (serverIp, action) => {
    try {
      setLoading(action !== 'status');
      const response = await axios.post(`https://${hostIP}:2020/server-control`, {
        server_ip: serverIp,
        action: action
      }, {
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (response.data.success) {
        message.success(`${action.charAt(0).toUpperCase() + action.slice(1)} command sent successfully`);
        setTimeout(() => {
          fetchServerData();
        }, 2000);
      } else {
        message.error(`Failed to ${action} server: ${response.data.error}`);
      }
    } catch (error) {
      console.error(`Error executing ${action}:`, error);
      message.error(`Error executing ${action}`);
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Function to check server status using Flask endpoint
  const checkServerStatus = async (serverIp) => {
    try {
      const response = await axios.post(`https://${hostIP}:2020/check-server-status`, {
        server_ip: serverIp
      }, {
        headers: { 'Content-Type': 'application/json' }
      });
      return response.data.status === 'online';
    } catch (error) {
      console.error('Error checking server status:', error);
      return false;
    }
  };

  
  // Function to shutdown server
  const shutdownServer = async (serverIp) => {
    await controlServer(serverIp, 'shutdown');
  };
  
  // Function to reboot server
  const rebootServer = async (serverIp) => {
    await controlServer(serverIp, 'reboot');
  };
  
  // Function to fetch server data
  const fetchServerData = async () => {
    try {
      setLoading(true);
      
      // Fetch server counts from Node.js backend instead of Flask
      const countsResponse = await axios.get(`https://${hostIP}:5000/api/server-counts`);
      setServerCounts({
        total: countsResponse.data.total_count,
        online: countsResponse.data.online_count,
        offline: countsResponse.data.offline_count
      });
      
      // Fetch deployed servers for Squadron tab (from deployed_server table)
      const userId = localStorage.getItem('userId');
      const squadronResponse = await axios.get(`https://${hostIP}:5000/api/deployed-servers`, {
        params: { userId }
      });
      const squadronData = await Promise.all(squadronResponse.data.map(async (server, index) => {
        const isOnline = await checkServerStatus(server.serverip);
        return {
          key: index.toString(),
          sno: index + 1,
          serverid: server.serverid,
          serverip: server.serverip,
          cloudname: server.cloudname || 'N/A',
          status: isOnline ? 'online' : 'offline',
          isOnline
        };
      }));
      setSquadronServers(squadronData);
      
    } catch (error) {
      console.error('Error fetching server data:', error);
      message.error('Failed to fetch server data');
    } finally {
      setLoading(false);
    }
  };
  
  // Fetch server data on component mount
  useEffect(() => {
    fetchServerData();
    // Set up interval to refresh data every 30 seconds
    const interval = setInterval(fetchServerData, 30000);
    return () => clearInterval(interval);
  }, []);

  // Removed tab URL sync logic

  // On mount, save last visited menu path
  useEffect(() => {
    sessionStorage.setItem("lastMenuPath", window.location.pathname + window.location.search);
  }, []);

  return (
    <Layout1>
      <Layout>
        <Content>
          <div>
            <Row
              gutter={16} // Added gutter for spacing
              justify="space-between" // Ensures equal spacing between the columns
              style={{ marginLeft: "20px" }} // Added marginLeft to shift everything a bit to the right
            >
              <Col
                className="gutter-row"
                span={7}
                style={style}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
                  {/* Left: Image + Label (vertical) */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minHeight: "80px", justifyContent: "center", marginLeft: "20px" }}>
                    <img src={node} alt="server" style={{ width: "64px", height: "64px", userSelect: "none" }} />
                    <span
                      style={{
                        fontSize: "15px",
                        fontWeight: "500",
                        marginTop: "4px",
                        userSelect: "none",
                        textAlign: "center"
                      }}
                    >
                      Total Server
                    </span>
                  </div>
                  {/* Right: Count */}
                  <span
                    style={{
                      fontSize: "32px",
                      fontWeight: "bold",
                      color: "#1890ff",
                      marginRight: "50px",
                      userSelect: "none",
                    }}
                  >
                    {serverCounts.total || 0}
                  </span>
                </div>
              </Col>

              <Col
                className="gutter-row"
                span={7}
                style={style}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
                  {/* Left: Image + Label (vertical) */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minHeight: "80px", justifyContent: "center", marginLeft: "20px" }}>
                    <img src={upImage} alt="server" style={{ width: "64px", height: "64px", userSelect: "none" }} />
                    <span
                      style={{
                        fontSize: "15px",
                        fontWeight: "500",
                        marginTop: "4px",
                        userSelect: "none",
                        textAlign: "center"
                      }}
                    >
                      Online Server
                    </span>
                  </div>
                  {/* Right: Count */}
                  <span
                    style={{
                      fontSize: "32px",
                      fontWeight: "bold",
                      color: "#1890ff",
                      marginRight: "50px",
                      userSelect: "none",
                    }}
                  >
                    {serverCounts.online || 0}
                  </span>
                </div>
              </Col>

              <Col
                className="gutter-row"
                span={7}
                style={style}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
                  {/* Left: Image + Label (vertical) */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minHeight: "80px", justifyContent: "center", marginLeft: "20px" }}>
                    <img src={downImage} alt="cloud-development--v3" style={{ width: "64px", height: "64px", userSelect: "none" }} />
                    <span
                      style={{
                        fontSize: "15px",
                        fontWeight: "500",
                        marginTop: "4px",
                        userSelect: "none",
                        textAlign: "center"
                      }}
                    >
                      Offline Server
                    </span>
                  </div>
                  {/* Right: Count */}
                  <span
                    style={{
                      fontSize: "32px",
                      fontWeight: "bold",
                      color: "#1890ff",
                      marginRight: "50px",
                      userSelect: "none",
                    }}
                  >
                    {serverCounts.offline || 0}
                  </span>
                </div>
              </Col>
            </Row>
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
              <div style={{ width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
                  <Space>
                    <h3 style={{ margin: 0, fontWeight: 600 }}>Squadron</h3>
                    <Button 
                      icon={<SyncOutlined spin={loading} />} 
                      size="small" 
                      onClick={fetchServerData}
                      disabled={loading}
                      style={{ marginLeft: 8, marginTop: 5 }}
                    />
                  </Space>
                  <Input.Search
                    placeholder="Search by Server ID / IP / Cloud / Status"
                    allowClear
                    onSearch={(val) => setSearchText(val)}
                    onChange={(e) => setSearchText(e.target.value)}
                    style={{ maxWidth: 360 }}
                    enterButton
                    size="middle"
                  />
                </div>
                <Table
                  loading={loading}
                  columns={[
                    { title: 'S.No', dataIndex: 'sno', key: 'sno', width: '5%' },
                    { title: 'Server ID', dataIndex: 'serverid', key: 'serverid', width: '15%' },
                    { title: 'Server IP', dataIndex: 'serverip', key: 'serverip', width: '15%' },
                    { title: 'Cloud Name', dataIndex: 'cloudname', key: 'cloudname', width: '15%' },
                    { 
                      title: 'Status', 
                      dataIndex: 'status', 
                      key: 'status',
                      width: '10%',
                      render: (status) => (
                        <Badge 
                          status={status === 'online' ? 'success' : 'error'} 
                          text={status === 'online' ? 'Online' : 'Offline'} 
                        />
                      )
                    },
                    {
                      title: 'Power Controls',
                      key: 'actions',
                      width: '20%',
                      render: (_, record) => (
                        <div>
                          <Popconfirm
                            title="Are you sure?"
                            onConfirm={() => shutdownServer(record.serverip)}
                            okText="Yes"
                            cancelText="No"
                            disabled={!record.isOnline}
                            overlayStyle={{ width: '180px' }}
                            okButtonProps={{ style: { marginRight: '8px', width: '70px' } }}
                            cancelButtonProps={{ style: { width: '70px' } }}
                          >
                            <Button 
                              type="primary" 
                              danger 
                              style={{ marginRight: '8px', width: '80px' }}
                              disabled={!record.isOnline}
                            >
                              Shutdown
                            </Button>
                          </Popconfirm>
                          <Popconfirm
                            title="Are you sure?"
                            onConfirm={() => rebootServer(record.serverip)}
                            okText="Yes"
                            cancelText="No"
                            disabled={!record.isOnline}
                            overlayStyle={{ width: '180px' }}
                            okButtonProps={{ style: { marginRight: '8px', width: '70px' } }}
                            cancelButtonProps={{ style: { width: '70px' } }}
                          >
                            <Button 
                              type="primary"
                              disabled={!record.isOnline}
                              style={{ width: '75px' }}
                            >
                              Reboot
                            </Button>
                          </Popconfirm>
                        </div>
                      )
                    }
                  ]}
                  dataSource={squadronServers.filter((row) => {
                    if (!searchText) return true;
                    const q = searchText.toLowerCase();
                    return (
                      (row.serverid || '').toLowerCase().includes(q) ||
                      (row.serverip || '').toLowerCase().includes(q) ||
                      (row.cloudname || '').toLowerCase().includes(q) ||
                      (row.status || '').toLowerCase().includes(q)
                    );
                  })}
                  pagination={{
                    pageSize: 10,
                    showSizeChanger: true,
                    showQuickJumper: true,
                    showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} servers`,
                  }}
                />
              </div>
            </div>
          </div>
        </Content>
      </Layout>
    </Layout1>
  );
};

export default Inventory;
