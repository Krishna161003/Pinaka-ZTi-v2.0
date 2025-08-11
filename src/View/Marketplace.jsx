import React from 'react';
import Layout1 from '../Components/layout';
import { theme, Layout, Result } from 'antd';

const { Content } = Layout;

const Marketplace = () => {
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

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
            <Result
              status="404"
              // title="404"
              // subTitle="Sorry, the page you visited does not exist."
            />
          </div>
        </Content>
      </Layout>
    </Layout1>
  );
};

export default Marketplace;
