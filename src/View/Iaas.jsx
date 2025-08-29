import React, { useState, useEffect } from 'react';
import Layout1 from '../Components/layout';
import { useLocation, useNavigate } from 'react-router-dom';
import { theme, Layout, Tabs, Table, Button, Modal, Spin, Alert, Input, message } from 'antd';
import iaas from '../Images/IAAS_icon.png';
import { SearchOutlined, CopyTwoTone } from '@ant-design/icons';

// LicenseDetailsModalContent: fetches and displays license details for a serverid
function LicenseDetailsModalContent({ serverid, server_ip, onLicenseUpdate }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [license, setLicense] = useState(null);
  const [showUpdateForm, setShowUpdateForm] = useState(false);
  const [newLicenseCode, setNewLicenseCode] = useState('');
  const [newLicenseDetails, setNewLicenseDetails] = useState(null);
  const [checkingLicense, setCheckingLicense] = useState(false);
  const [updateLoading, setUpdateLoading] = useState(false);

  useEffect(() => {
    if (!serverid) return;
    setLoading(true);
    setError(null);
    setLicense(null);
    fetch(`https://${hostIP}:5000/api/license-details/${serverid}`)
      .then(res => {
        if (!res.ok) throw new Error('No license found');
        return res.json();
      })
      .then(setLicense)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [serverid]);

  const checkLicenseCode = async (licenseCode) => {
    if (!licenseCode.trim()) {
      setNewLicenseDetails(null);
      return;
    }

    setCheckingLicense(true);
    setNewLicenseDetails(null);

    try {
      // First check if license exists in the database
      let checkResponse;
      try {
        checkResponse = await fetch(`https://${hostIP}:5000/api/check-license-exists`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ license_code: licenseCode })
        });
      } catch (networkError) {
        console.error('Network error:', networkError);
        message.error('Unable to connect to the Database service. Please check your network connection.');
        return;
      }

      if (!checkResponse.ok) {
        const errorData = await checkResponse.json().catch(() => ({}));
        const errorMessage = errorData.message || 'Failed to verify license status';
        message.error(`Error: ${errorMessage}`);
        return;
      }

      const checkResult = await checkResponse.json();

      if (checkResult.exists) {
        message.error('This license code is already in use');
        return;
      }

      // If license not found in DB, verify with Python backend using server_ip
      const pythonBackendUrl = `https://${server_ip}:2020/decrypt-code`;

      let verifyResponse;
      try {
        verifyResponse = await fetch(pythonBackendUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ encrypted_code: licenseCode })
        });
      } catch (networkError) {
        console.error('Network error during verification:', networkError);
        message.error('Unable to connect to the license verification service. Please try again later.');
        return;
      }

      let verifyResult;
      try {
        verifyResult = await verifyResponse.json();
      } catch (parseError) {
        console.error('Error parsing verification response:', parseError);
        message.error('Invalid response from license verification service');
        return;
      }

      if (!verifyResponse.ok || !verifyResult.success) {
        const errorMsg = verifyResult.message || 'Invalid license code';
        message.error(`Verification failed: ${errorMsg}`);
        return;
      }

      // If license is valid, set the license details from backend
      setNewLicenseDetails({
        license_code: licenseCode,
        license_type: verifyResult.key_type || 'Standard',
        license_period: verifyResult.license_period || '30',
        license_status: 'valid',
        mac_address: verifyResult.mac_address,
        socket_count: verifyResult.socket_count,
        license_verified: true
      });

      message.success('License verified successfully');

    } catch (error) {
      console.error('Unexpected error during license verification:', error);
      message.error('An unexpected error occurred. Please try again.');
    } finally {
      setCheckingLicense(false);
    }
  };

  const handleUpdateLicense = async () => {
    if (!newLicenseCode.trim() || !newLicenseDetails) return;

    setUpdateLoading(true);
    try {
      // Call Python backend to SSH into the server and persist license first
      const response = await fetch(`https://${hostIP}:2020/apply-license`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server_ip: server_ip,
          license_code: newLicenseCode,
          license_type: newLicenseDetails.license_type,
          license_period: newLicenseDetails.license_period
        })
      });

      const respJson = await response.json().catch(() => ({}));

      if (response.ok && respJson?.success) {
        // Step 2: Update central DB from frontend
        const dbRes = await fetch(`https://${hostIP}:5000/api/update-license/${serverid}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            license_code: newLicenseCode,
            license_type: newLicenseDetails.license_type,
            license_period: newLicenseDetails.license_period,
            status: 'activated'
          })
        });

        if (!dbRes.ok) {
          const dbErr = await dbRes.json().catch(() => ({}));
          const msg = dbErr?.message || 'Failed to update license in database';
          alert(msg);
          return;
        }

        // Refresh license details
        const updatedResponse = await fetch(`https://${hostIP}:5000/api/license-details/${serverid}`);
        if (updatedResponse.ok) {
          const updatedLicense = await updatedResponse.json();
          setLicense(updatedLicense);
        }
        setShowUpdateForm(false);
        setNewLicenseCode('');
        setNewLicenseDetails(null);
        if (onLicenseUpdate) onLicenseUpdate();
      } else {
        const msg = respJson?.message || 'Failed to apply license on target machine';
        alert(msg);
      }
    } catch (error) {
      console.error('Error updating license:', error);
      alert('Failed to update license');
    } finally {
      setUpdateLoading(false);
    }
  };

  if (!serverid) return <div style={{ color: '#aaa' }}>No server ID selected.</div>;
  if (loading) return <Spin tip="Loading license details..." />;
  if (error) return <Alert type="error" message={error} showIcon />;
  if (!license) return <div style={{ color: '#aaa' }}>No license data found.</div>;

  if (showUpdateForm) {
    return (
      <div style={{ maxWidth: '600px', margin: '0 auto' }}>
        {/* <div style={{ marginBottom: '24px' }}>
          <Button 
            type="text"
            icon={<span style={{ marginRight: '4px' }}>←</span>}
            onClick={() => setShowUpdateForm(false)}
            style={{ 
              padding: '4px 0',
              height: 'auto',
              color: '#1890ff',
              fontWeight: 500,
              width: '90px',
              border: 'none',
              backgroundColor: 'transparent',
              cursor: 'pointer'
            }}
          >
            Back
          </Button>
        </div> */}

        <div style={{
          marginBottom: '24px',
          backgroundColor: '#fff',
          padding: '24px',
          borderRadius: '8px',
          boxShadow: '0 1px 2px 0 rgba(0,0,0,0.03)'
        }}>
          {/* <h3 style={{ 
            marginTop: 0, 
            marginBottom: '24px',
            color: '#1f1f1f',
            fontSize: '16px',
            fontWeight: 600
          }}>
            Update License
          </h3> */}

          <div style={{ marginBottom: '24px' }}>
            <label style={{
              display: 'block',
              marginBottom: '8px',
              fontWeight: 500,
              color: '#1f1f1f'
            }}>
              Enter the License Code
            </label>
            <div style={{ display: 'flex', gap: '12px' }}>
              <Input
                value={newLicenseCode}
                onChange={(e) => {
                  const value = e.target.value.slice(0, 12);
                  setNewLicenseCode(value);
                }}
                placeholder="Enter 12-character license code"
                maxLength={12}
                style={{
                  flex: 1,
                  height: '40px',
                  borderRadius: '6px'
                }}
              />
              <Button
                type="primary"
                onClick={() => checkLicenseCode(newLicenseCode)}
                loading={checkingLicense}
                disabled={!newLicenseCode.trim() || newLicenseCode.length !== 12}
                style={{
                  height: '40px',
                  padding: '0 16px',
                  borderRadius: '6px',
                  fontWeight: 500,
                  width: '90px'
                }}
              >
                Verify
              </Button>
            </div>
          </div>

          {checkingLicense && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px 0',
              marginBottom: '16px',
              backgroundColor: '#fafafa',
              borderRadius: '6px'
            }}>
              <Spin size="small" style={{ marginRight: '8px' }} />
              <span>Verifying license code...</span>
            </div>
          )}

          {newLicenseCode.length === 12 && !checkingLicense && !newLicenseDetails && (
            <div style={{ marginBottom: '16px' }}>
              <Alert
                message="Please click 'Verify' to check the license code"
                type="info"
                showIcon
                style={{ borderRadius: '6px' }}
              />
            </div>
          )}

          {newLicenseDetails && (
            <div style={{
              border: '1px solid #e8e8e8',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '24px',
              backgroundColor: '#fafafa'
            }}>
              <h4 style={{
                marginTop: 0,
                marginBottom: '16px',
                color: '#1f1f1f',
                fontSize: '15px',
                fontWeight: 600
              }}>
                License Information
              </h4>
              <Table
                size="small"
                pagination={false}
                bordered
                columns={[
                  { title: 'Field', dataIndex: 'field', key: 'field', width: 160 },
                  { title: 'Value', dataIndex: 'value', key: 'value' }
                ]}
                dataSource={[
                  { key: 'code', field: 'License Code', value: newLicenseDetails.license_code || '-' },
                  { key: 'type', field: 'Type', value: newLicenseDetails.license_type || '-' },
                  { key: 'period', field: 'Period', value: newLicenseDetails.license_period ? `${newLicenseDetails.license_period} days` : '-' },
                  { key: 'status', field: 'Status', value: (
                    <span style={{
                      color: newLicenseDetails.license_status === 'activated' ? '#52c41a' :
                        newLicenseDetails.license_status === 'expired' ? '#ff4d4f' : '#faad14'
                    }}>
                      {newLicenseDetails.license_status || '-'}
                    </span>
                  ) }
                ]}
              />
            </div>
          )}
        </div>

        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          paddingTop: '16px',
          borderTop: '1px solid #f0f0f0',
          marginTop: '24px'
        }}>
          <Button
            onClick={() => setShowUpdateForm(false)}
            style={{
              marginRight: '12px',
              height: '40px',
              padding: '0 16px',
              borderRadius: '6px'
            }}
          >
            Cancel
          </Button>
          <Button
            type="primary"
            onClick={handleUpdateLicense}
            loading={updateLoading}
            disabled={!newLicenseCode.trim() || !newLicenseDetails || !newLicenseDetails.license_verified}
            style={{
              height: '40px',
              padding: '0 16px',
              borderRadius: '6px',
              fontWeight: 500,
              minWidth: '120px'
            }}
          >
            {updateLoading ? 'Updating...' : 'Update License'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Table
        size="small"
        pagination={false}
        bordered
        columns={[
          { title: 'Field', dataIndex: 'field', key: 'field', width: 160 },
          { title: 'Value', dataIndex: 'value', key: 'value' }
        ]}
        dataSource={[
          { key: 'code', field: 'License Code', value: license.license_code || <span style={{ color: '#aaa' }}>-</span> },
          { key: 'type', field: 'Type', value: license.license_type || <span style={{ color: '#aaa' }}>-</span> },
          { key: 'period', field: 'Period', value: license.license_period ? `${license.license_period} days` : <span style={{ color: '#aaa' }}>-</span> },
          { key: 'status', field: 'Status', value: (
            license.license_status && license.license_status.toLowerCase() === 'activated'
              ? <span style={{ color: 'green' }}>Active</span>
              : license.license_status && license.license_status.toLowerCase() === 'expired'
                ? <span style={{ color: 'red' }}>Expired</span>
                : license.license_status
                  ? <span style={{ color: 'orange' }}>{license.license_status}</span>
                  : <span style={{ color: '#aaa' }}>-</span>
          ) },
          { key: 'start', field: 'Start Date', value: license.start_date ? new Date(license.start_date).toLocaleDateString() : <span style={{ color: '#aaa' }}>-</span> },
          { key: 'end', field: 'End Date', value: license.end_date ? (
            <span style={{
              color: new Date(license.end_date) < new Date() ? 'red' : 'inherit',
              fontWeight: new Date(license.end_date) < new Date() ? 'bold' : 'normal'
            }}>
              {new Date(license.end_date).toLocaleDateString()}
              {new Date(license.end_date) < new Date() && ' (Expired)'}
            </span>
          ) : <span style={{ color: '#aaa' }}>-</span> }
        ]}
      />

      {/* Temporarily enabled for testing - remove license status check */}
      {license.license_status && license.license_status.toLowerCase() === 'expired' && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #d9d9d9' }}>
          <Button
            type="primary"
            onClick={() => setShowUpdateForm(true)}
            style={{ width: '110px' }}
          >
            Update License
          </Button>
        </div>
      )}
    </div>
  );
}

const { Content } = Layout;
const hostIP = window.location.hostname;

// Copy helper
async function copyToClipboard(text) {
  try {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    message.success('Copied to clipboard');
  } catch (e) {
    console.error('Copy failed', e);
    message.error('Failed to copy');
  }
}

// Helper for column search (AntD Table)
function getColumnSearchProps(dataIndex, placeholder) {
  return {
    filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => (
      <div style={{ padding: 8 }}>
        <Input
          placeholder={`Search ${placeholder || dataIndex}`}
          value={selectedKeys[0]}
          onChange={e => setSelectedKeys(e.target.value ? [e.target.value] : [])}
          onPressEnter={confirm}
          style={{ marginBottom: 8, display: 'block' }}
        />
        <Button
          type="primary"
          onClick={confirm}
          icon={<SearchOutlined />}
          size="small"
          style={{ width: 90, marginRight: 8 }}
        >
          Search
        </Button>
        <Button onClick={clearFilters} size="small" style={{ width: 90 }}>
          Reset
        </Button>
      </div>
    ),
    filterIcon: filtered => <SearchOutlined style={{ color: filtered ? '#1890ff' : undefined }} />,
    onFilter: (value, record) =>
      record[dataIndex]
        ? record[dataIndex].toString().toLowerCase().includes(value.toLowerCase())
        : false,
  };
}

const SquadronNodesTable = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalRecord, setModalRecord] = useState(null);
  // Controlled pagination state for Squadron table
  const [squadronPageSize, setSquadronPageSize] = useState(() => {
    const saved = Number(sessionStorage.getItem('squadron_page_size'));
    return Number.isFinite(saved) && saved > 0 ? saved : 10;
  });
  const [squadronCurrentPage, setSquadronCurrentPage] = useState(1);

  useEffect(() => {
    setLoading(true);
    const userId = JSON.parse(sessionStorage.getItem('loginDetails'))?.data?.id;
    const squadronUrl = `https://${hostIP}:5000/api/squadron-nodes?userId=${userId}`;
    const cloudUrl = `https://${hostIP}:5000/api/cloud-deployments-summary?userId=${userId}`;

    Promise.all([
      fetch(squadronUrl),
      fetch(cloudUrl)
    ])
      .then(async ([squadRes, cloudRes]) => {
        if (!squadRes.ok) throw new Error('Failed to fetch squadron nodes');
        // Cloud summary may fail independently; handle gracefully
        const [nodes, clouds] = await Promise.all([
          squadRes.json(),
          cloudRes.ok ? cloudRes.json() : Promise.resolve([])
        ]);

        // Build a map of cloudname -> server_vip from cloud credentials
        const vipByCloud = {};
        (clouds || []).forEach(c => {
          const vip = c?.credentials?.server_vip;
          const cname = c?.cloudname;
          if (cname && vip) vipByCloud[cname] = vip;
        });

        // Enrich nodes: if a node lacks server_vip, fallback to cloud-level VIP
        const singleCloudVip = (clouds && clouds.length === 1) ? (clouds[0]?.credentials?.server_vip || null) : null;
        const enriched = (nodes || []).map(n => {
          if (!n.server_vip) {
            if (n.cloudname && vipByCloud[n.cloudname]) {
              n.server_vip = vipByCloud[n.cloudname];
            } else if (!n.cloudname && singleCloudVip) {
              // Last-resort fallback when only one cloud exists
              n.server_vip = singleCloudVip;
            }
          }
          return n;
        });

        // Add license status information per node
        const nodesWithLic = await Promise.all(enriched.map(async n => {
          try {
            const licRes = await fetch(`https://${hostIP}:5000/api/license-details/${n.serverid}`);
            if (licRes.ok) {
              const lic = await licRes.json();
              n.license_status = lic.license_status || null;
            }
          } catch (_) { }
          return n;
        }));
        setData(nodesWithLic);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const columns = [
    {
      title: 'S.NO',
      dataIndex: 'sno',
      key: 'sno',
      width: 60,
      align: 'center',

    },
    {
      title: 'Server ID',
      dataIndex: 'serverid',
      key: 'serverid',
      width: 120,
      ellipsis: true,
      align: 'center',
      ...getColumnSearchProps('serverid', 'Server ID'),

    },
    {
      title: 'Server IP',
      dataIndex: 'serverip',
      key: 'serverip',
      width: 120,
      align: 'center',
      ...getColumnSearchProps('serverip', 'Server IP'),

    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      width: 100,
      align: 'center',
      ...getColumnSearchProps('role', 'Role'),

    },
    {
      title: 'License',
      key: 'license',
      width: 110,
      align: 'center',
      render: (_, record) => (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Button
            size="small"
            onClick={() => {
              setModalRecord(record);
              setModalVisible('license');
            }}
            color='primary' variant='link'
            style={{ width: '95px' }}
            disabled={!record.licensecode}
          >
            {record.licensecode ? 'View' : <span style={{ color: '#999' }}>N/A</span>}
          </Button>
          {record.license_status ? (
            <span style={{
              color: record.license_status.toLowerCase() === 'activated' ? 'green' :
                record.license_status.toLowerCase() === 'expired' ? 'red' : 'orange',
              fontSize: 12
            }}>
              {record.license_status.toLowerCase() === 'activated' ? 'Active' :
                record.license_status.toLowerCase() === 'expired' ? 'Expired' :
                  record.license_status}
            </span>
          ) : (
            <span style={{ color: '#999', fontSize: 12 }}>-</span>
          )}
        </div>
      )
    },
    {
      title: 'Credential',
      key: 'credential',
      align: 'center',
      width: 110,
      render: (_, record) => (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Button size="small" onClick={() => {
            setModalRecord(record);
            setModalVisible('credential');
          }} color='primary' variant='link' style={{ width: '95px' }}>
            View
          </Button>
        </div>
      )
    },
    {
      title: 'Created At',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: val => val ? new Date(val).toISOString().slice(0, 10) : '',
      width: 120,
      align: 'center',

    }
  ];

  return (
    <div style={{ marginTop: 16 }}>
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
      <Spin spinning={loading} tip="Loading Squadron Nodes...">
        <Table
          columns={columns}
          dataSource={data}
          rowKey={row => row.sno + '-' + row.serverid}
          pagination={{
            current: squadronCurrentPage,
            pageSize: squadronPageSize,
            showSizeChanger: true,
            pageSizeOptions: [5, 10, 20, 50],
            showQuickJumper: true,
            showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} nodes`,
            onChange: (page, size) => {
              setSquadronCurrentPage(page);
              if (size && size !== squadronPageSize) {
                setSquadronPageSize(size);
                sessionStorage.setItem('squadron_page_size', String(size));
              }
            },
            onShowSizeChange: (_current, size) => {
              setSquadronCurrentPage(1);
              setSquadronPageSize(size);
              sessionStorage.setItem('squadron_page_size', String(size));
            },
          }}
          onChange={(pagination, filters, sorter, extra) => {
            // Reset to first page when filters are applied
            if (extra && extra.action === 'filter') {
              setSquadronCurrentPage(1);
            }
          }}
          bordered
          size="middle"
          scroll={{ x: 'max-content' }}
        />
      </Spin>
      {/* Credential Modal */}
      <Modal
        open={modalVisible === 'credential'}
        onCancel={() => setModalVisible(null)}
        title="Squadron Node Credentials"
        footer={null}
        width={760}
      >
        <div>
          {(() => {
            const role = modalRecord?.role;
            const hasStorage = Array.isArray(role)
              ? role.map(r => String(r).toLowerCase()).includes('storage')
              : String(role || '').toLowerCase().includes('storage');

            const baseHost = modalRecord?.server_vip || modalRecord?.serverip;
            const rows = [];

            // Squadron
            rows.push({
              key: 'squadron',
              service: 'Squadron',
              url: baseHost ? `https://${baseHost}` : null,
              username: 'admin',
              password: 's9UDxlXIL1opnqwG8cEDXxoiBLNX40C3yBVtafiP'
            });

            // Storage (conditional)
            if (hasStorage) {
              rows.push({
                key: 'storage',
                service: 'Storage',
                url: modalRecord?.serverip ? `https://${modalRecord.serverip}:8443/` : null,
                username: 'admin',
                password: '-'
              });
            }

            // Monitoring
            rows.push({
              key: 'monitoring',
              service: 'Monitoring',
              url: baseHost ? `https://${baseHost}:7000/` : null,
              username: 'admin',
              password: 'eldh8jlBg7n3SycW4GTF33hoE8ir3diBUFa14uut'
            });

            // Diagnosis Dashboard
            rows.push({
              key: 'diagnosis',
              service: 'Diagnosis Dashboard',
              url: baseHost ? `https://${baseHost}:5601/` : null,
              username: 'opensearch',
              password: 'mmezZX8u1F66IFCDPSjPdWyIJZkids04X8pdwBT8'
            });

            const columns = [
              { title: 'Service', dataIndex: 'service', key: 'service', width: 180 },
              {
                title: 'URL', dataIndex: 'url', key: 'url',
                render: (url) => url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
                ) : <span style={{ color: '#999' }}>No URL</span>
              },
              {
                title: 'Username', dataIndex: 'username', key: 'username', width: 140,
                render: (u) => <span style={{ userSelect: 'text' }}>{u || '-'}</span>
              },
              {
                title: 'Password', dataIndex: 'password', key: 'password', width: 260,
                render: (pwd) => (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ userSelect: 'text' }}>{pwd || '-'}</span>
                    {pwd && pwd !== '-' && (
                      <CopyTwoTone twoToneColor="#1890ff" style={{ cursor: 'pointer' }} onClick={() => copyToClipboard(pwd)} />
                    )}
                  </div>
                )
              }
            ];

            return (
              <Table
                size="small"
                bordered
                pagination={false}
                columns={columns}
                dataSource={rows}
              />
            );
          })()}
        </div>
      </Modal>
      {/* License Modal */}
      <Modal
        open={modalVisible === 'license'}
        onCancel={() => setModalVisible(null)}
        title="License Details"
        footer={<Button onClick={() => setModalVisible(null)} style={{ width: '95px' }}>Close</Button>}
        width={540}
      >
        <LicenseDetailsModalContent
          serverid={modalRecord?.serverid}
          server_ip={modalRecord?.serverip}
          onLicenseUpdate={() => {
            // Refresh the table data when license is updated
            window.location.reload();
          }}
        />
      </Modal>
    </div>
  );
};

const CloudDeploymentsTable = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalCredentials, setModalCredentials] = useState({});
  // Controlled pagination state for Cloud table
  const [cloudPageSize, setCloudPageSize] = useState(() => {
    const saved = Number(sessionStorage.getItem('cloud_page_size'));
    return Number.isFinite(saved) && saved > 0 ? saved : 10;

  });
  const [cloudCurrentPage, setCloudCurrentPage] = useState(1);

  useEffect(() => {
    setLoading(true);
    const userId = JSON.parse(sessionStorage.getItem('loginDetails'))?.data?.id;
    fetch(`https://${hostIP}:5000/api/cloud-deployments-summary?userId=${userId}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch');
        return res.json();
      })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const columns = [
    {
      title: 'S.NO',
      dataIndex: 'sno',
      key: 'sno',
      width: 60,
      align: 'center',

    },
    {
      title: 'Cloud Name',
      dataIndex: 'cloudname',
      key: 'cloudname',
      ...getColumnSearchProps('cloudname', 'Cloud Name'),

    },
    {
      title: 'Number of Nodes',
      dataIndex: 'numberOfNodes',
      key: 'numberOfNodes',
      align: 'center',

    },
    {
      title: 'Credentials',
      key: 'credentials',
      align: 'center',
      render: (_, record) => (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Button size="small" onClick={() => {
            setModalCredentials(record.credentials);
            setModalVisible(true);
          }} color='primary' variant='link' style={{ width: '95px' }}>
            View
          </Button>
        </div>
      )
    },
    {
      title: 'Created At',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: val => val ? new Date(val).toISOString().slice(0, 10) : '',

    }
  ];

  return (
    <div style={{ marginTop: 16 }}>
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
      <Spin spinning={loading} tip="Loading Cloud Deployments...">
        <Table
          columns={columns}
          dataSource={data}
          rowKey={row => row.sno + '-' + row.cloudname}
          pagination={{
            current: cloudCurrentPage,
            pageSize: cloudPageSize,
            showSizeChanger: true,
            pageSizeOptions: [5, 10, 20, 50],
            showQuickJumper: true,
            showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} cloud`,
            onChange: (page, size) => {
              setCloudCurrentPage(page);
              if (size && size !== cloudPageSize) {
                setCloudPageSize(size);
                sessionStorage.setItem('cloud_page_size', String(size));
              }
            },
            onShowSizeChange: (_current, size) => {
              setCloudCurrentPage(1);
              setCloudPageSize(size);
              sessionStorage.setItem('cloud_page_size', String(size));
            },
          }}
          onChange={(pagination, filters, sorter, extra) => {
            if (extra && extra.action === 'filter') {
              setCloudCurrentPage(1);
            }
          }}
          bordered
          size="middle"
          scroll={{ x: 'max-content' }}
        />
      </Spin>
      <Modal
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        title="Cloud Credentials"
        footer={null}
        width={760}
      >
        <div>
          {(() => {
            const vip = modalCredentials?.server_vip;

            const rows = [
              {
                key: 'cloud',
                service: 'Cloud',
                url: vip ? `https://${vip}` : null,
                username: 'admin',
                password: 's9UDxlXIL1opnqwG8cEDXxoiBLNX40C3yBVtafiP'
              },
              {
                key: 'storage',
                service: 'Storage',
                url: vip ? `https://${vip}:8443/` : null,
                username: 'admin',
                password: '-'
              },
              {
                key: 'monitoring',
                service: 'Monitoring',
                url: vip ? `https://${vip}:7000/` : null,
                username: 'admin',
                password: 'eldh8jlBg7n3SycW4GTF33hoE8ir3diBUFa14uut'
              },
              {
                key: 'diagnosis',
                service: 'Diagnosis Dashboard',
                url: vip ? `https://${vip}:5601/` : null,
                username: 'opensearch',
                password: 'mmezZX8u1F66IFCDPSjPdWyIJZkids04X8pdwBT8'
              }
            ];

            const columns = [
              { title: 'Service', dataIndex: 'service', key: 'service', width: 180 },
              {
                title: 'URL', dataIndex: 'url', key: 'url',
                render: (url) => url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
                ) : <span style={{ color: '#999' }}>No URL</span>
              },
              {
                title: 'Username', dataIndex: 'username', key: 'username', width: 140,
                render: (u) => <span style={{ userSelect: 'text' }}>{u || '-'}</span>
              },
              {
                title: 'Password', dataIndex: 'password', key: 'password', width: 260,
                render: (pwd) => (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ userSelect: 'text' }}>{pwd || '-'}</span>
                    {pwd && pwd !== '-' && (
                      <CopyTwoTone twoToneColor="#1890ff" style={{ cursor: 'pointer' }} onClick={() => copyToClipboard(pwd)} />
                    )}
                  </div>
                )
              }
            ];

            return (
              <Table
                size="small"
                bordered
                pagination={false}
                columns={columns}
                dataSource={rows}
              />
            );
          })()}
        </div>
      </Modal>
    </div>
  );
};

const Iaas = () => {
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  // React Router hooks
  const location = useLocation();
  const navigate = useNavigate();

  // Always use tab from URL as the single source of truth
  const getTabFromURL = () => {
    const params = new URLSearchParams(window.location.search);
    return params.get('tab') || '1';
  };
  const [activeTab, setActiveTab] = useState(getTabFromURL);

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
      const pathWithTab = `/iaas?tab=${tabParam}`;
      sessionStorage.setItem('lastIaasPath', pathWithTab);
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
      sessionStorage.setItem('iaas_activeTab', key);
    }
  };


  // On mount, save last visited menu path
  useEffect(() => {
    sessionStorage.setItem("lastMenuPath", window.location.pathname + window.location.search);
  }, []);

  return (
    <Layout1>
      <Layout>
        <Content style={{ margin: "16px 16px" }}>
          <div
            style={{
              padding: 30,
              minHeight: "auto",
              background: colorBgContainer,
              display: 'flex',
              alignItems: 'center',
              gap: '20px'
            }}
          >
            <img src={iaas} style={{ width: "74px", height: "74px" }} />
            <h2 style={{ margin: 0 }}>Infrastructure as a Service (IaaS)</h2>
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
              onChange={onTabChange}
              items={[
                {
                  label: 'Cloud',
                  key: '1',
                  children: <CloudDeploymentsTable />
                },
                {
                  label: 'Squadron',
                  key: '2',
                  children: <SquadronNodesTable />
                }
              ]}
            />
          </div>
        </Content>
      </Layout>
    </Layout1>
  );
};

export default Iaas;