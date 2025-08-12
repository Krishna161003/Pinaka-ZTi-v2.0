import React, { useState, useEffect } from 'react';
import { Divider, Table, Button, Input, Tag, message } from 'antd';
import axios from 'axios';

const getCloudName = () => {
  const fromSession = sessionStorage.getItem('cloudName');
  if (fromSession) return fromSession;
  const meta = document.querySelector('meta[name="cloud-name"]');
  return meta ? meta.content : null;
};

// Session key name differentiated for ServerVirtualization flow
const SV_LICENSE_SESSION_KEY = 'sv_licenseStatus';

const ActivateKey = ({ nodes = [], results, setResults, onNext, next }) => {
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
  ];

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h4 style={{ marginBottom: '-16px', marginTop: '3px' }}>
          Cloud Name: <span style={{ color: 'blue' }}>{cloudName}</span>
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
