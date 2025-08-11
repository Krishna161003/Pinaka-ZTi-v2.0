import React, { useState, useEffect } from 'react';
import Layout1 from '../Components/layout';
import { useLocation, useNavigate } from 'react-router-dom';
import { Layout, Row, Col, Tabs, Table, theme, Button, Tag, Badge, message, Popconfirm } from 'antd';
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
  
  // React Router hooks
  const location = useLocation();
  const navigate = useNavigate();

  // State for server data
  const [flightDeckServers, setFlightDeckServers] = useState([]);
  const [squadronServers, setSquadronServers] = useState([]);
  const [serverCounts, setServerCounts] = useState({ total: 0, online: 0, offline: 0 });
  const [loading, setLoading] = useState(true);

  // Always use tab from URL as the single source of truth
  const getTabFromURL = () => {
    const params = new URLSearchParams(window.location.search);
    return params.get('tab') || '1';
  };
  const [activeTab, setActiveTab] = useState(getTabFromURL);
  
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
      
      // Fetch Host table for Flight Deck tab
      const userId = localStorage.getItem('userId');
      const flightDeckResponse = await axios.get(`https://${hostIP}:5000/api/hosts`, {
        params: { userId }
      });
      const flightDeckData = await Promise.all(flightDeckResponse.data.map(async (server, index) => {
        const isOnline = await checkServerStatus(server.serverip);
        return {
          key: index.toString(),
          sno: index + 1,
          serverid: server.server_id,
          serverip: server.serverip,
          cloudname: server.cloudname || server.servervip || 'N/A',
          status: isOnline ? 'online' : 'offline',
          isOnline
        };
      }));
      setFlightDeckServers(flightDeckData);
      
      // Fetch child_node table for Squadron tab
      const squadronResponse = await axios.get(`https://${hostIP}:5000/api/child-nodes`, {
        params: { userId }
      });
      const squadronData = await Promise.all(squadronResponse.data.map(async (server, index) => {
        const isOnline = await checkServerStatus(server.serverip);
        return {
          key: index.toString(),
          sno: index + 1,
          serverid: server.server_id,
          serverip: server.serverip,
          host_serverid: server.host_serverid || 'N/A',
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

  // Sync state from URL
  useEffect(() => {
    const tabParam = getTabFromURL();
    if (tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
    // Save menu memory on unmount
    return () => {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab') || activeTab;
      const pathWithTab = `/inventory?tab=${tabParam}`;
      sessionStorage.setItem('lastInventoryPath', pathWithTab);
      sessionStorage.setItem('lastMenuPath', pathWithTab);
    };
  }, [location.search, activeTab]);

  // Sync URL and sessionStorage from state (only on tab change)
  const onTabChange = (key) => {
    if (key !== activeTab) {
      setActiveTab(key);
      const params = new URLSearchParams(window.location.search);
      params.set('tab', key);
      navigate({ search: params.toString() }, { replace: true });
      sessionStorage.setItem('inventory_activeTab', key);
    }
  };

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
                <Tabs
                  activeKey={activeTab}
                  onChange={onTabChange}
                  style={{ width: '100%' }}
                  tabBarStyle={{ width: '100%' }}
                  moreIcon={null}
                  items={[
                    {
                      label: <span style={{ width: '100%', display: 'block', textAlign: 'center' }}>Flight Deck</span>,
                      key: '1',
                      children: (
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
                                      style={{ marginRight: '8px' , width: '80px'}}
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
                                      style={{ width: '75px'}}
                                    >
                                      Reboot
                                    </Button>
                                  </Popconfirm>
                                </div>
                              )
                            }
                          ]}
                          dataSource={flightDeckServers}
                          pagination={{
                            pageSize: 10,
                            showSizeChanger: true,
                            showQuickJumper: true,
                            showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} servers`,
                          }}
                        />
                      )
                    },
                    {
                      label: <span style={{ width: '100%', display: 'block', textAlign: 'center' }}>Squadron</span>,
                      key: '2',
                      children: (
                        <Table
                          loading={loading}
                          columns={[
                            { title: 'S.No', dataIndex: 'sno', key: 'sno', width: '5%' },
                            { title: 'Server ID', dataIndex: 'serverid', key: 'serverid', width: '15%' },
                            { title: 'Server IP', dataIndex: 'serverip', key: 'serverip', width: '15%' },
                            { title: 'Host Server ID', dataIndex: 'host_serverid', key: 'host_serverid', width: '15%' },
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
                          dataSource={squadronServers}
                          pagination={{
                            pageSize: 10,
                            showSizeChanger: true,
                            showQuickJumper: true,
                            showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} servers`,
                          }}
                        />
                      )
                    }
                  ]}
                />
                {/* Custom style for AntD tabs to make tabs fill and center */}
                <style>{`
                  .ant-tabs-nav {
                    width: 100%;
                  }
                  .ant-tabs-nav-list {
                    width: 100%;
                    display: flex !important;
                  }
                  .ant-tabs-tab {
                    flex: 1 1 0;
                    justify-content: center;
                    text-align: center;
                    margin: 0 !important;
                  }
                `}</style>
              </div>
            </div>
          </div>
        </Content>
      </Layout>
    </Layout1>
  );
};

export default Inventory;
