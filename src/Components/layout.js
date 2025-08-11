import React, { useState, useEffect, useCallback } from "react";
import img1 from "../Images/ZTi.png";
import img2 from "../Images/favicon.png";
import logo from "../Images/logo.png";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  MenuFoldOutlined,
  // CheckCircleOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
  DashboardOutlined,
  DeploymentUnitOutlined,
  // SyncOutlined,
  TruckOutlined,
  CloudServerOutlined,
  // SettingOutlined,
  // FileDoneOutlined,
  // DatabaseOutlined,
  // WifiOutlined,
  // FileSearchOutlined,
  ProfileOutlined,
  // FundOutlined,
  // InteractionOutlined

} from "@ant-design/icons";
import { Button, Layout, Menu, theme, Dropdown } from "antd";

const { Header, Content, Footer, Sider } = Layout;

const AppLayout = ({ children }) => {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(
    () => JSON.parse(sessionStorage.getItem("isSiderCollapsed")) || false
  );

  const [userData, setUserData] = useState({});
  const [, updateState] = useState();
  const forceUpdate = useCallback(() => updateState({}), []);

  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();


  const handleLogout = () => {
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = '/';
  };

  const handleMenuClick = (e) => {
    forceUpdate();
  };

  const location = useLocation();
  const routeKeyMap = {
    "/": "1",
    "/servervirtualization": "2",
    "/cloud": "2",
    "/edgecloud": "2",
    "/addnode": "2",
    // "/distributedstorage": "2",
    "/iaas": "3",
    "/inventory": "4",
    // "/hpc": "5",
    // "/aiworkbench": "6",
    // "/vdi": "7",
    // "/siem": "8",
    // "/noc": "9",
    // "/lifecyclemgmt": "10",
    "/migration": "11",
    // "/compliance": "12",
    // "/marketplace": "13",
    // "/setting": "14",
    "/administration": "15",
  };



  const toggleSider = () => {
    setCollapsed(!collapsed);
    sessionStorage.setItem("isSiderCollapsed", JSON.stringify(!collapsed));
  };

  const items = [
    {
      key: "1",
      label: "My Account",
      disabled: true,
    },
    {
      type: "divider",
    },
    // {
    //   key: "2",
    //   label: "Profile",
    //   icon: <UserOutlined />,
    // },
    // {
    //   key: "3",
    //   label: "Settings",
    //   icon: <SettingOutlined />,
    // },
    {
      key: "4",
      label: "Logout",
      danger: true,
      onClick: handleLogout,
    },
  ];

  const menuItems = [
    {
      key: "1",
      icon: <DashboardOutlined />,
      label: (
        <Link to="/" style={{ textDecoration: "none" }}>
          Dashboard
        </Link>
      ),
    },
    {
      key: "2",
      icon: <DeploymentUnitOutlined />,
      label: (
        <Link
          to={sessionStorage.getItem("lastZtiPath") || "/servervirtualization"}
          style={{ textDecoration: "none", color: "inherit" }}
        >
          Zti Wizard
        </Link>
      ),
    },
    {
      key: "3",
      icon: <CloudServerOutlined />,
      label: (
        <Link to="/iaas" style={{ textDecoration: "none" }}>
          IaaS
        </Link>
      ),
    },
    {
      key: "4",
      icon: <ProfileOutlined />,
      label: (
        <Link to="/inventory" style={{ textDecoration: "none" }}>
          Inventory
        </Link>
      ),
    },
    // {
    //   key: "5",
    //   icon: <FileDoneOutlined />,
    //   label: (
    //     <Link to="/hpc" style={{ textDecoration: "none" }}>
    //       HPC
    //     </Link>
    //   ),
    // },
    // {
    //   key: "6",
    //   icon: <InteractionOutlined />,
    //   label: (
    //     <Link to="/aiworkbench" style={{ textDecoration: "none" }}>
    //       AI Workbench
    //     </Link>
    //   ),
    // },
    // {
    //   key: "7",
    //   icon: <DatabaseOutlined />,
    //   label: (
    //     <Link to="/vdi" style={{ textDecoration: "none" }}>
    //       VDI
    //     </Link>
    //   ),
    // },
    // {
    //   key: "8",
    //   icon: <FileSearchOutlined />,
    //   label: (
    //     <Link to="/siem" style={{ textDecoration: "none" }}>
    //       SIEM
    //     </Link>
    //   ),
    // },
    // {
    //   key: "9",
    //   icon: <WifiOutlined />,
    //   label: (
    //     <Link to="/noc" style={{ textDecoration: "none" }}>
    //       NOC
    //     </Link>
    //   ),
    // },
    // {
    //   key: "10",
    //   icon: <SyncOutlined />,
    //   label: (
    //     <Link to="/lifecyclemgmt" style={{ textDecoration: "none" }}>
    //       Lifecycle Mgmt
    //     </Link>
    //   ),
    // },
    {
      key: "11",
      icon: <TruckOutlined />,
      label: (
        <Link to="/migration" style={{ textDecoration: "none" }}>
          Migration
        </Link>
      ),
    },
    // {
    //   key: "12",
    //   icon: <CheckCircleOutlined />,
    //   label: (
    //     <Link to="/compliance" style={{ textDecoration: "none" }}>
    //       Compliance
    //     </Link>
    //   ),
    // },
    // {
    //   key: "13",
    //   icon: <FundOutlined />,
    //   label: (
    //     <Link to="/marketplace" style={{ textDecoration: "none" }}>
    //       Marketplace
    //     </Link>
    //   ),
    // },
    // {
    //   key: "14",
    //   icon: <SettingOutlined />,
    //   label: (
    //     <Link to="/setting" style={{ textDecoration: "none" }}>
    //       Settings
    //     </Link>
    //   ),
    // },
    {
      key: "15",
      icon: <UserOutlined />,
      label: (
        <Link to="/administration" style={{ textDecoration: "none" }}>
          Administration
        </Link>
      ),
    },
  ];

  const siderStyle = {
    overflow: 'auto',
    height: '100vh',
    position: 'sticky',
    // insetInlineStart: 0,
    top: 0,
    bottom: 0,
    scrollbarWidth: 'thin',
    scrollbarGutter: 'stable',
  };

  useEffect(() => {
    try {
      const data = JSON.parse(sessionStorage.getItem("loginDetails"));
      if (data && data.data) {
        setUserData(data.data);
      }
    } catch (error) {
      console.error("Error parsing login details from sessionStorage:", error);
    }
  }, []);

  return (
    <Layout style={{ minHeight: "100vh", backgroundColor: "black" }}>
      <Sider style={siderStyle} trigger={null} collapsible collapsed={collapsed}>
        <div style={{ padding: "16px", textAlign: "center" }}>
          <img
            src={collapsed ? img2 : img1}
            alt="Logo"
            style={{
              width: collapsed ? "40px" : "90%",
              maxWidth: "200px",
              borderRadius: "8px",
              transition: "all 0.3s ease-in-out",
              opacity: collapsed ? 0.8 : 1,
            }}
          />
        </div>
        <Menu
          theme="dark"
          mode="inline"
          onClick={handleMenuClick}
          selectedKeys={[routeKeyMap[location.pathname] || "1"]}
          style={{ backgroundColor: "transparent" }}
        >
          {menuItems.map((item) => (
            <Menu.Item key={item.key} icon={item.icon}>
              {item.label}
            </Menu.Item>
          ))}
        </Menu>
      </Sider>
      <Layout>
        <Header
          style={{
            padding: 0,
            top: 0,
            zIndex: 1,
            position: 'sticky',
            background: colorBgContainer,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={toggleSider}
            style={{
              fontSize: "16px",
              width: 64,
              height: 25,
              marginBottom: 10,
              background: "transparent",
              border: "none",
            }}
          />
          <div style={{ marginLeft: "auto", marginRight: 16 }}>
            Welcome,&nbsp;
            <span style={{ color: "#1677ff" }}>
              {userData.companyName}
            </span>
          </div>
          <Dropdown
            menu={{ items }}
            style={{
              width: "30px",
              height: "30px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "50%",
              border: "1px solid rgba(0, 0, 0, 0.1)",
              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
              backgroundColor: "#fff",
              marginRight: "14px",
              color: "black",
            }}
          >
            <a
              onClick={(e) => e.preventDefault()}
              style={{ marginRight: "10px" }}
            >
              <UserOutlined style={{ fontSize: "16px" }} />
            </a>
          </Dropdown>
        </Header>
        <Content style={{ margin: "16px 16px" }}>{children}</Content>
        <Footer
          style={{ textAlign: "center", color: "#4A90E2", padding: "1px" }}
        >
          <img
            src={logo}
            alt="Pinakastra Logo"
            style={{ width: "90px", marginBottom: "5px" }}
          />
          <div style={{ marginTop: "3px", fontSize: "9px", color: "#4A90E2" }}>
            &copy;2023 Pinakastra, Inc. All rights reserved. Pinakastra is a
            trademark of Pinakastra Computing Pvt Ltd.
          </div>
        </Footer>
      </Layout>
    </Layout>
  );
};

export default AppLayout;
