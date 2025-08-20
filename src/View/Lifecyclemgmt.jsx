import React from 'react';
import Layout1 from '../Components/layout';
import { theme, Layout } from 'antd';

const { Content } = Layout;

const Lifecyclemgmt = () => {
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  return (
    <Layout1>
      <Layout>
        <Content style={{ margin: "16px 16px" }}>
          <div
            style={{
              padding: 30,
              minHeight: "auto",
              background: colorBgContainer,
              // borderRadius: borderRadiusLG,
            }}
          >
            <h2 style={{ marginTop: '0px' }}>Lifecycle Management</h2>
          </div>
          <div
            style={{
              padding: 30,
              minHeight: "auto",
              background: colorBgContainer,
              // borderRadius: borderRadiusLG,
            }}
          >

          </div>
        </Content>
      </Layout>
    </Layout1>
  );
};

export default Lifecyclemgmt;
