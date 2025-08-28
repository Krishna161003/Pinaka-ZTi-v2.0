import React, { useEffect, useRef, useState } from 'react';
import Layout1 from '../Components/layout';
import { theme, Layout, message, Upload, Button, Alert, Tabs, Table } from 'antd';
import { InboxOutlined, SyncOutlined, DownloadOutlined, PlayCircleOutlined } from '@ant-design/icons';

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
  const [activeTab, setActiveTab] = useState('upload');
  const [history, setHistory] = useState(() => {
    const v = localStorage.getItem('lm_history');
    try { return v ? JSON.parse(v) : []; } catch { return []; }
  });
  const [diagnostics, setDiagnostics] = useState(() => {
    const v = localStorage.getItem('lm_diagnostics');
    try { return v ? JSON.parse(v) : []; } catch { return []; }
  });
  const [polling, setPolling] = useState(false);
  const pollTimerRef = useRef(null);
  const lastStateRef = useRef(job?.state || null);
  const isRunning = job?.state === 'running';

  const persistJob = (jid, data) => {
    if (jid) localStorage.setItem('lm_job_id', jid);
    if (data) localStorage.setItem('lm_job', JSON.stringify(data));
  };

  const persistHistory = (items) => {
    localStorage.setItem('lm_history', JSON.stringify(items || []));
  };

  const persistDiagnostics = (items) => {
    localStorage.setItem('lm_diagnostics', JSON.stringify(items || []));
  };

  // Run log collection
  const runLogCollection = async () => {
    try {
      const res = await fetch(`https://${hostIP}:2020/run-log-collection`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok) {
        message.success('Log collection started successfully');
        // Refresh the tar files list after successful execution
        fetchTarFiles();
      } else {
        message.error(data.error || 'Failed to start log collection');
      }
    } catch (error) {
      message.error('Failed to start log collection');
    }
  };

  // Fetch tar files from Flask backend
  const fetchTarFiles = async () => {
    try {
      const res = await fetch(`https://${hostIP}:2020/list-tar-files`);
      if (!res.ok) {
        message.error('Failed to fetch tar files');
        return;
      }
      const data = await res.json();
      if (data.files) {
        setDiagnostics(data.files);
        persistDiagnostics(data.files);
      }
    } catch (error) {
      message.error('Failed to fetch tar files');
    }
  };

  // Download tar file
  const downloadTarFile = async (filename) => {
    if (!filename) return;
    try {
      const res = await fetch(`https://${hostIP}:2020/download-tar/${filename}`);
      if (!res.ok) {
        message.error('Failed to download tar file');
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      message.error('Failed to download tar file');
    }
  };

  // Fetch lifecycle history from Node backend (fallback to localStorage on error)
  const fetchHistoryFromServer = async () => {
    try {
      const res = await fetch(`https://${hostIP}:5000/api/lifecycle-history`);
      if (!res.ok) throw new Error('history request failed');
      const data = await res.json();
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      setHistory(rows);
      persistHistory(rows);
    } catch (e) {
      // Fallback to localStorage
      const v = localStorage.getItem('lm_history');
      try { setHistory(v ? JSON.parse(v) : []); } catch { setHistory([]); }
    }
  };

  // Download lifecycle log by id as a .log file
  const downloadLog = async (id) => {
    if (!id) return;
    try {
      const res = await fetch(`https://${hostIP}:5000/api/lifecycle-history/${id}/log`);
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        message.error(j?.error || 'No log found for this item');
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lifecycle_${id}.log`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      message.error('Failed to download log');
    }
  };

  const addHistoryItem = (jid, data) => {
    if (!jid || !data) return;
    setHistory(prev => {
      if (prev.some(h => h.id === jid)) return prev; // avoid duplicates
      const info = data.readme || data.message || 'Patch applied';
      const date = data.finished_at || data.completed_at || data.timestamp || new Date().toISOString();
      const next = [...prev, { id: jid, info, date }];
      persistHistory(next);
      return next;
    });
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
        if (data.state === 'succeeded') {
          message.success('Script finished successfully');
          addHistoryItem(jid, data);
          // Also refresh from server to reflect persisted DB history
          fetchHistoryFromServer();
        }
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

  // Load history when switching to History tab
  useEffect(() => {
    if (activeTab === 'history') {
      fetchHistoryFromServer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Load tar files when switching to Diagnostic tab
  useEffect(() => {
    if (activeTab === 'diagnostic') {
      fetchTarFiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const uploadProps = {
    name: 'file',
    multiple: false,
    maxCount: 1,
    accept: '.zip',
    action: `https://${hostIP}:2020/upload`,
    // Send host_ip along with the multipart form so Flask can forward to Node
    data: { host_ip: hostIP },
    disabled: isRunning,
    beforeUpload(file) {
      if (isRunning) {
        message.warning('A script is currently running. Please wait until it finishes.');
        return false;
      }
      const isZip =
        file.type === 'application/zip' ||
        file.type === 'application/x-zip-compressed' ||
        /\.zip$/i.test(file.name);
      if (!isZip) {
        message.error('Only .zip files are allowed.');
        return Upload.LIST_IGNORE; // prevent upload and adding to list
      }
      // Enforce filename prefix requirement
      const hasValidPrefix = /^zti-2\.0-/.test(file.name);
      if (!hasValidPrefix) {
        message.error('Filename must start with "zti-2.0-".');
        return Upload.LIST_IGNORE; // prevent upload and adding to list
      }
      return true;
    },
    onChange(info) {
      const { status } = info.file;
      // Keep only valid .zip and only the latest one
      const latestZipOnly = info.fileList
        .filter(f => /\.zip$/i.test(f.name) && /^zti-2\.0-/.test(f.name))
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
        let errMsg = 'file upload failed.';
        const resp = info?.file?.response;
        if (typeof resp === 'string' && resp.trim()) {
          errMsg = resp;
        } else if (resp?.error) {
          errMsg = resp.error;
        } else if (info?.file?.xhr?.responseText) {
          try {
            const j = JSON.parse(info.file.xhr.responseText);
            if (j?.error) errMsg = j.error; else if (j?.message) errMsg = j.message;
          } catch {
            errMsg = info.file.xhr.responseText;
          }
        }
        message.error(`${info.file.name}: ${errMsg}`);
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
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              items={[
                {
                  key: 'upload',
                  label: 'Upload',
                  children: (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                        <Button
                          aria-label="Refresh"
                          onClick={() => jobId && fetchStatusOnce(jobId)}
                          icon={<SyncOutlined spin={polling} />}
                          style={{ borderColor: '#1890ff', color: '#1890ff', width: '95px' }}
                        >
                          Refresh
                        </Button>
                      </div>
                      <Dragger {...uploadProps} fileList={fileList}>
                        <p className="ant-upload-drag-icon">
                          <InboxOutlined />
                        </p>
                        <p className="ant-upload-text">Click or drag .zip file(s) to this area to upload</p>
                        <p className="ant-upload-hint">Only .zip files starting with "zti-2.0-" are allowed.</p>
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
                  ),
                },
                {
                  key: 'history',
                  label: 'History',
                  children: (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                        <Button
                          aria-label="Refresh"
                          onClick={fetchHistoryFromServer}
                          icon={<SyncOutlined />}
                          style={{ borderColor: '#1890ff', color: '#1890ff', width: '95px' }}
                        >
                          Refresh
                        </Button>
                      </div>
                      <Table
                        size="middle"
                        columns={[
                          { title: 'S.NO', key: 'sno', width: 90, render: (_t, _r, idx) => idx + 1 },
                          { title: 'Patch Info', dataIndex: 'info', key: 'info' },
                          { title: 'Date', dataIndex: 'date', key: 'date', width: 220, render: (v) => {
                            const d = v ? new Date(v) : null;
                            return d && !isNaN(d) ? d.toLocaleString() : '-';
                          } },
                          { title: 'Log', key: 'log', width: 120, render: (_t, record) => (
                            <Button
                              aria-label="Download Log"
                              onClick={() => record?.id && downloadLog(record.id)}
                              disabled={!record?.id}
                              icon={<DownloadOutlined />}
                              style={{ borderColor: '#1890ff', color: '#1890ff', width: '95px' }}
                            >
                              Log
                            </Button>
                          ) },
                        ]}
                        dataSource={(history || []).map((h, idx) => ({ key: h.id || String(idx), ...h }))}
                        pagination={{ pageSize: 10 }}
                      />
                    </div>
                  ),
                },
                {
                  key: 'diagnostic',
                  label: 'Diagnostic',
                  children: (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 12 }}>
                        <Button
                          type="primary"
                          icon={<PlayCircleOutlined />}
                          onClick={runLogCollection}
                          style={{ marginRight: 8,width: '170px' }}
                        >
                          Run Log Collection
                        </Button>
                        <Button
                          aria-label="Refresh"
                          onClick={fetchTarFiles}
                          icon={<SyncOutlined />}
                          style={{ borderColor: '#1890ff', color: '#1890ff',width: '95px' }}
                        >
                          Refresh
                        </Button>
                      </div>
                      <Table
                        size="middle"
                        columns={[
                          { 
                            title: 'S.NO', 
                            key: 'sno', 
                            width: 90, 
                            render: (_t, _r, idx) => idx + 1 
                          },
                          { 
                            title: 'File Name', 
                            dataIndex: 'filename', 
                            key: 'filename'
                          },
                          { 
                            title: 'Size (MB)', 
                            dataIndex: 'size_mb', 
                            key: 'size_mb',
                            width: 120
                          },
                          { 
                            title: 'Created At', 
                            dataIndex: 'created_at', 
                            key: 'created_at',
                            width: 180
                          },
                          { 
                            title: 'Download', 
                            key: 'download', 
                            width: 120, 
                            render: (_t, record) => (
                              <Button
                                type="primary"
                                onClick={() => record?.filename && downloadTarFile(record.filename)}
                                disabled={!record?.filename}
                                icon={<DownloadOutlined />}
                                style={{ borderColor: '#1890ff', color: '#1890ff', width: '95px' }}
                              >
                                Download
                              </Button>
                              
                            ) 
                          }
                        ]}
                        dataSource={(diagnostics || []).map((d, idx) => ({ key: d.filename || String(idx), ...d }))}
                        pagination={{ pageSize: 10 }}
                      />
                    </div>
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

export default Lifecyclemgmt;
