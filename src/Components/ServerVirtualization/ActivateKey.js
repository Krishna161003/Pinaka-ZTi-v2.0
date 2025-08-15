import React, { useState, useEffect } from 'react';
import { Divider, Table, Button, Input, Tag, message, Modal, notification } from 'antd';
import axios from 'axios';

const getCloudName = () => {
  const fromSession = sessionStorage.getItem('cloudName');
  if (fromSession) return fromSession;
  const meta = document.querySelector('meta[name="cloud-name"]');
  return meta ? meta.content : null;
};

// Session key name differentiated for ServerVirtualization flow
const SV_LICENSE_SESSION_KEY = 'sv_licenseStatus';

const ActivateKey = ({ nodes = [], results, setResults, onNext, next, onRemoveNode, onUndoRemoveNode }) => {
  const cloudName = getCloudName();
  const [data, setData] = useState(results || []);

  useEffect(() => {
    if (results) setData(results);
    else setData(
      (nodes || []).map(node => ({
        ...node,
        key: node.ip,
        license: '',
        result: null,
        details: null,
        checking: false,
      }))
    );
  }, [results, nodes]);

  const handleLicenseChange = (ip, value) => {
    setData(prev => prev.map(row =>
      row.ip === ip ? { ...row, license: value } : row
    ));
  };

  // Store successful license details per IP in session under differentiated key
  const storeLicenseInSession = (ip, details) => {
    try {
      const existing = sessionStorage.getItem(SV_LICENSE_SESSION_KEY);
      const map = existing ? JSON.parse(existing) : {};
      map[ip] = details;
      sessionStorage.setItem(SV_LICENSE_SESSION_KEY, JSON.stringify(map));
    } catch (_) {
      // ignore storage errors
    }
  };

  // Validate license against target node (pattern from Cloud/licenseactivation.jsx)
  const handleCheck = async (ip) => {
    const row = data.find(r => r.ip === ip);
    if (!row || !row.license) return;

    setData(prev => prev.map(r =>
      r.ip === ip ? { ...r, checking: true } : r
    ));

    try {
      const response = await axios.post(`https://${ip}:2020/decrypt-code`, {
        encrypted_code: row.license
      });

      const result = response.data;

      if (result.success) {
        const details = {
          type: result.key_type || 'N/A',
          period: result.license_period ? `${result.license_period}` : 'N/A',
          mac_address: result.mac_address,
          socket_count: result.socket_count,
          licenseCode: row.license || '-',
        };

        // Save to session under differentiated key per IP
        storeLicenseInSession(ip, details);

        setData(prev => {
          const newData = prev.map(r =>
            r.ip === ip
              ? { ...r, result: 'Success', details, checking: false }
              : r
          );
          setResults && setResults(newData);
          return newData;
        });
        message.success(`License activated successfully for ${ip}`);
      } else {
        throw new Error(result.message || 'License activation failed');
      }
    } catch (error) {
      console.error('License activation error:', error);
      setData(prev => prev.map(r =>
        r.ip === ip
          ? { ...r, result: 'Failed', details: { type: 'N/A', period: 'N/A' }, checking: false }
          : r
      ));
      message.error(`License activation failed for ${ip}: ${error.response?.data?.message || error.message}`);
    }
  };

  // Remove node with confirmation and session cleanup + Undo
  const handleRemove = (ip) => {
    Modal.confirm({
      title: `Remove ${ip}?`,
      content: 'This will remove the node and its license details from this step. You can undo within 5 seconds.',
      okText: 'Remove',
      okButtonProps: { danger: true, size: 'small', style: { width: 90 } },
      cancelText: 'Cancel',
      cancelButtonProps: { size: 'small', style: { width: 90 } },
      onOk: () => {
        let removedIndex = -1;
        let removedRecord = null;
        const snapshot = {
          statusEntry: null,
          activationResultsIndex: -1,
          activationResultsEntry: null,
          licenseNodesIndex: -1,
          licenseNodesEntry: null,
        };

        // Clean session entries (sv_licenseStatus map, sv_licenseActivationResults array, sv_licenseNodes array)
        try {
          const mapRaw = sessionStorage.getItem(SV_LICENSE_SESSION_KEY);
          const map = mapRaw ? JSON.parse(mapRaw) : null;
          if (map && Object.prototype.hasOwnProperty.call(map, ip)) {
            snapshot.statusEntry = map[ip];
            delete map[ip];
            sessionStorage.setItem(SV_LICENSE_SESSION_KEY, JSON.stringify(map));
          }
        } catch (_) {}
        try {
          const arrRaw = sessionStorage.getItem('sv_licenseActivationResults');
          const arr = arrRaw ? JSON.parse(arrRaw) : null;
          if (Array.isArray(arr)) {
            const idx = arr.findIndex(e => e && e.ip === ip);
            if (idx > -1) {
              snapshot.activationResultsIndex = idx;
              snapshot.activationResultsEntry = arr[idx];
              const next = arr.filter(e => e && e.ip !== ip);
              sessionStorage.setItem('sv_licenseActivationResults', JSON.stringify(next));
            }
          }
        } catch (_) {}
        try {
          const nodesRaw = sessionStorage.getItem('sv_licenseNodes');
          const nodes = nodesRaw ? JSON.parse(nodesRaw) : null;
          if (Array.isArray(nodes)) {
            const idx = nodes.findIndex(e => e && e.ip === ip);
            if (idx > -1) {
              snapshot.licenseNodesIndex = idx;
              snapshot.licenseNodesEntry = nodes[idx];
              const next = nodes.filter(e => e && e.ip !== ip);
              sessionStorage.setItem('sv_licenseNodes', JSON.stringify(next));
            }
          }
        } catch (_) {}

        setData(prev => {
          removedIndex = prev.findIndex(r => r.ip === ip);
          removedRecord = removedIndex >= 0 ? prev[removedIndex] : null;
          const newData = prev.filter(row => row.ip !== ip);
          setResults && setResults(newData);
          return newData;
        });

        // Inform parent to remove from Validation/selected nodes as well
        try {
          if (onRemoveNode) onRemoveNode(ip, removedRecord, removedIndex);
        } catch (_) {}

        const key = `sv-remove-${ip}`;
        notification.open({
          key,
          message: `Removed ${ip}`,
          description: 'The node and its license info were removed.',
          duration: 5,
          btn: (
            <Button type="link" onClick={() => {
              notification.destroy(key);
              // Restore session entries
              try {
                if (snapshot.statusEntry) {
                  const mapRaw = sessionStorage.getItem(SV_LICENSE_SESSION_KEY);
                  const map = mapRaw ? JSON.parse(mapRaw) : {};
                  map[ip] = snapshot.statusEntry;
                  sessionStorage.setItem(SV_LICENSE_SESSION_KEY, JSON.stringify(map));
                }
              } catch (_) {}
              try {
                if (snapshot.activationResultsEntry && snapshot.activationResultsIndex > -1) {
                  const arrRaw = sessionStorage.getItem('sv_licenseActivationResults');
                  const arr = arrRaw ? JSON.parse(arrRaw) : [];
                  const idx = Math.min(Math.max(snapshot.activationResultsIndex, 0), arr.length);
                  arr.splice(idx, 0, snapshot.activationResultsEntry);
                  sessionStorage.setItem('sv_licenseActivationResults', JSON.stringify(arr));
                }
              } catch (_) {}
              try {
                if (snapshot.licenseNodesEntry && snapshot.licenseNodesIndex > -1) {
                  const nodesRaw = sessionStorage.getItem('sv_licenseNodes');
                  const nodes = nodesRaw ? JSON.parse(nodesRaw) : [];
                  const idx = Math.min(Math.max(snapshot.licenseNodesIndex, 0), nodes.length);
                  nodes.splice(idx, 0, snapshot.licenseNodesEntry);
                  sessionStorage.setItem('sv_licenseNodes', JSON.stringify(nodes));
                }
              } catch (_) {}
              // Restore UI row
              if (removedRecord && removedIndex > -1) {
                setData(cur => {
                  const arr = [...cur];
                  const idx = Math.min(Math.max(removedIndex, 0), arr.length);
                  arr.splice(idx, 0, removedRecord);
                  setResults && setResults(arr);
                  return arr;
                });
              }

              // Inform parent to restore into Validation/selected nodes
              try {
                if (onUndoRemoveNode) onUndoRemoveNode(ip, removedRecord, removedIndex);
              } catch (_) {}
            }}>
              Undo
            </Button>
          )
        });
      }
    });
  };

  const columns = [
    { title: 'IP Address', dataIndex: 'ip', key: 'ip' },
    {
      title: 'License',
      key: 'license',
      render: (_, record) => (
        <span style={{ display: 'flex', gap: 8 }}>
          <Input
            value={record.license}
            onChange={e => handleLicenseChange(record.ip, e.target.value)}
            placeholder="Enter license key"
            style={{ width: 150 }}
            maxLength={12}
            disabled={record.checking}
          />
          <Button
            type="primary"
            loading={record.checking}
            onClick={() => handleCheck(record.ip)}
            disabled={!record.license || record.checking}
            style={{ width: 70 }}
          >
            Check
          </Button>
        </span>
      ),
    },
    {
      title: 'Result',
      dataIndex: 'result',
      key: 'result',
      render: (result) =>
        result === 'Success' ? <Tag color="green">Success</Tag> :
        result === 'Failed' ? <Tag color="red">Failed</Tag> : <Tag>Pending</Tag>
    },
    {
      title: 'Details',
      key: 'details',
      render: (_, record) => (
        <div>
          <div>Type: <b>{record.details?.type || '-'}</b></div>
          <div>Period (Days): <b>{record.details?.period || '-'}</b></div>
          {record.details?.mac_address && (
            <div>MAC: <b>{record.details.mac_address}</b></div>
          )}
          {record.details?.socket_count && (
            <div>Sockets: <b>{record.details.socket_count}</b></div>
          )}
        </div>
      ),
    },
    {
      title: 'Remove',
      key: 'remove',
      render: (_, record) => (
        <Button danger onClick={() => handleRemove(record.ip)} style={{ width: 90 }}>
          Remove
        </Button>
      ),
    },
  ];

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h4 style={{ marginBottom: '-16px', marginTop: '3px' }}>
          Cloud Name: <span style={{ color: '#1890ff' }}>{cloudName}</span>
        </h4>
        <Button
          size="middle"
          style={{ width: '75px' }}
          type="primary"
          onClick={() => {
            const successfulNodes = data.filter(row => row.result === 'Success');
            if (onNext) onNext(successfulNodes);
            else if (next) next(successfulNodes);
          }}
        >
          Next
        </Button>
      </div>

      <Divider />

      <Table columns={columns} dataSource={data} rowKey="ip" pagination={false} />

      <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: '14px' }}>
          <strong>Note:</strong>
          <br />
          1. To obtain your license key, Access the page https://nodeip:1010 and copy the details from the table in the page and email them to
          <a href="mailto:support@pinakastra.cloud"> support@pinakastra.cloud</a> or contact us at
          <a href="tel:+919008488882"> +91 90084 88882</a>.
          <br />
          (OR)
          <br />
          2. If you have already purchased the license and completed the payment and you have the payment ID,
          visit <a href="https://pinakastra.com/generate-key" target="_blank" rel="noopener noreferrer">
            https://pinakastra.com/generate-key
          </a>, fill in the required details, and generate your activation key.
        </span>
      </div>
    </div>
  );
};

export default ActivateKey;
