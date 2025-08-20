import React, { useEffect, useRef, useState } from 'react';
import Layout1 from '../Components/layout';
import { theme, Layout, message, Upload, Button, Alert } from 'antd';
import { InboxOutlined, SyncOutlined } from '@ant-design/icons';

const { Content } = Layout;
const { Dragger } = Upload;

const Lifecyclemgmt = () => {
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();
  const hostIP = window.location.hostname;
  const [fileList, setFileList] = useState([]);
  const [jobId, setJobId] = useState(() => localStorage.getItem('lm_job_id') || null);
  const [job, setJob] = useState(() => {
    const v = localStorage.getItem('lm_job');
    try { return v ? JSON.parse(v) : null; } catch { return null; }
  });
  const [polling, setPolling] = useState(false);
  const pollTimerRef = useRef(null);
  const lastStateRef = useRef(job?.state || null);

  const persistJob = (jid, data) => {
    if (jid) localStorage.setItem('lm_job_id', jid);
    if (data) localStorage.setItem('lm_job', JSON.stringify(data));
  };

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setPolling(false);
  };

  const fetchStatusOnce = async (jid) => {
    if (!jid) return null;
    try {
      const res = await fetch(`https://${hostIP}:2020/upload/status/${jid}`);
      if (!res.ok) return null;
      const data = await res.json();
      setJob(data);
      persistJob(jid, data);
      // Transition notifications
      if (lastStateRef.current !== data.state) {
        if (data.state === 'running') message.info('Script started');
        if (data.state === 'succeeded') message.success('Script finished successfully');
        if (data.state === 'failed') message.error(`Script failed: ${data.message || 'Unknown error'}`);
        lastStateRef.current = data.state;
      }
      // Stop on terminal states
      if (data.state === 'succeeded' || data.state === 'failed') {
        stopPolling();
      }
      return data;
    } catch {
      return null;
    }
  };

  const startPolling = (jid) => {
    if (!jid) return;
    setJobId(jid);
    setPolling(true);
    // Immediate fetch then interval
    fetchStatusOnce(jid);
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(() => fetchStatusOnce(jid), 3000);
  };

  useEffect(() => {
    // Resume polling if a job is in progress
    if (jobId && job && (job.state === 'queued' || job.state === 'running')) {
      startPolling(jobId);
    }
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uploadProps = {
    name: 'file',
    multiple: false,
    maxCount: 1,
    accept: '.zip',
    action: `https://${hostIP}:2020/upload`,
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
        const resp = info?.file?.response;
        if (resp?.job_id) {
          message.success(`${info.file.name} uploaded. Processing queued.`);
          setJobId(resp.job_id);
          lastStateRef.current = 'queued';
          persistJob(resp.job_id, { state: 'queued', message: 'Upload received' });
          startPolling(resp.job_id);
        } else {
          message.warning('Upload finished but no job id returned.');
        }
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
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <Button
                aria-label="Refresh"
                onClick={() => jobId && fetchStatusOnce(jobId)}
                icon={<SyncOutlined spin={polling} />}
                style={{ borderColor: '#1890ff', color: '#1890ff', borderRadius: 20 }}
              >
                Refresh
              </Button>
            </div>
            <Dragger {...uploadProps} fileList={fileList}>
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">Click or drag .zip file(s) to this area to upload</p>
              <p className="ant-upload-hint">Only .zip files are allowed.</p>
            </Dragger>
            {jobId && (
              <div style={{ marginTop: 16 }}>
                <Alert
                  type={job?.state === 'failed' ? 'error' : job?.state === 'succeeded' ? 'success' : 'info'}
                  showIcon
                  message={`Status: ${job?.state || 'unknown'}`}
                  description={job?.message || 'Processing'}
                />
                {job?.errors && job.errors.trim() && (
                  <pre style={{ marginTop: 8, background: '#fafafa', padding: 12, borderRadius: 6, maxHeight: 200, overflow: 'auto' }}>
                    {job.errors}
                  </pre>
                )}
              </div>
            )}
          </div>
        </Content>
      </Layout>
    </Layout1>
  );
};

export default Lifecyclemgmt;
