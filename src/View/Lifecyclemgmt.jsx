import React, { useState } from 'react';
import Layout1 from '../Components/layout';
import { theme, Layout, message, Upload } from 'antd';
import { InboxOutlined } from '@ant-design/icons';

const { Content } = Layout;
const { Dragger } = Upload;

const Lifecyclemgmt = () => {
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();
  const [fileList, setFileList] = useState([]);

  const uploadProps = {
    name: 'file',
    multiple: false,
    maxCount: 1,
    accept: '.zip',
    action: 'https://660d2bd96ddfa2943b33731c.mockapi.io/api/upload',
    beforeUpload(file) {
      const isZip =
        file.type === 'application/zip' ||
        file.type === 'application/x-zip-compressed' ||
        /\.zip$/i.test(file.name);
      if (!isZip) {
        message.error('Only .zip files are allowed.');
        return Upload.LIST_IGNORE; // prevent upload and adding to list
      }
      return true;
    },
    onChange(info) {
      const { status } = info.file;
      // Keep only valid .zip and only the latest one
      const latestZipOnly = info.fileList
        .filter(f => /\.zip$/i.test(f.name))
        .slice(-1);
      setFileList(latestZipOnly);

      if (status === 'done') {
        message.success(`${info.file.name} file uploaded successfully.`);
      } else if (status === 'error') {
        message.error(`${info.file.name} file upload failed.`);
      }
    },
    onDrop(e) {
      // console.log('Dropped files', e.dataTransfer.files);
    },
  };

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
              marginTop: 10,
              padding: 30,
              minHeight: "auto",
              background: colorBgContainer,
              // borderRadius: borderRadiusLG,
            }}
          >
            <Dragger {...uploadProps} fileList={fileList}>
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">Click or drag .zip file(s) to this area to upload</p>
              <p className="ant-upload-hint">Only .zip files are allowed.</p>
            </Dragger>
          </div>
        </Content>
      </Layout>
    </Layout1>
  );
};

export default Lifecyclemgmt;
