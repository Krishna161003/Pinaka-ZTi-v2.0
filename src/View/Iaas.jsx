import React, { useState, useEffect } from 'react';
import Layout1 from '../Components/layout';
import { useLocation, useNavigate } from 'react-router-dom';
import { theme, Layout, Tabs, Table, Button, Modal, Spin, Alert, Input, message } from 'antd';
import { SearchOutlined } from '@ant-design/icons';

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
        message.error('Unable to connect to the license server. Please check your network connection.');
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
      const response = await fetch(`https://${hostIP}:5000/api/update-license/${serverid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          license_code: newLicenseCode,
          license_type: newLicenseDetails.license_type,
          license_period: newLicenseDetails.license_period,
          status: 'activated'
        })
      });
      
      if (response.ok) {
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
        const errorData = await response.json();
        alert(errorData.message || 'Failed to update license');
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
              <div style={{ 
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px 24px'
              }}>
                <div><b>License Code:</b> <span style={{ color: '#262626' }}>{newLicenseDetails.license_code}</span></div>
                <div><b>Type:</b> <span style={{ color: '#262626' }}>{newLicenseDetails.license_type || '-'}</span></div>
                <div><b>Period:</b> <span style={{ color: '#262626' }}>{newLicenseDetails.license_period ? `${newLicenseDetails.license_period} days` : '-'}</span></div>
                <div><b>Status:</b> <span style={{ 
                  color: newLicenseDetails.license_status === 'activated' ? '#52c41a' : 
                         newLicenseDetails.license_status === 'expired' ? '#ff4d4f' : '#faad14'
                }}>{newLicenseDetails.license_status || '-'}</span></div>
              </div>
            </div>
          )}

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
      </div>
    );
  }

  return (
    <div>
      <div><b>License Code:</b> {license.license_code || <span style={{ color: '#aaa' }}>-</span>}</div>
      <div><b>Type:</b> {license.license_type || <span style={{ color: '#aaa' }}>-</span>}</div>
      <div><b>Period:</b> {license.license_period ? `${license.license_period} days` : <span style={{ color: '#aaa' }}>-</span>}</div>
      <div><b>Status:</b> {(
        license.license_status && license.license_status.toLowerCase() === 'activated'
          ? <span style={{ color: 'green' }}>Active</span>
          : license.license_status && license.license_status.toLowerCase() === 'expired'
            ? <span style={{ color: 'red' }}>Expired</span>
            : license.license_status
              ? <span style={{ color: 'orange' }}>{license.license_status}</span>
              : <span style={{ color: '#aaa' }}>-</span>
      )}</div>
      <div><b>Start Date:</b> {license.start_date ? new Date(license.start_date).toLocaleDateString() : <span style={{ color: '#aaa' }}>-</span>}</div>
      <div><b>End Date:</b> {license.end_date ? (
        <span style={{ 
          color: new Date(license.end_date) < new Date() ? 'red' : 'inherit',
          fontWeight: new Date(license.end_date) < new Date() ? 'bold' : 'normal'
        }}>
          {new Date(license.end_date).toLocaleDateString()}
          {new Date(license.end_date) < new Date() && ' (Expired)'}
        </span>
      ) : <span style={{ color: '#aaa' }}>-</span>}</div>
      
      {/* Temporarily enabled for testing - remove license status check */}
      {license.license_code && (
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

const FlightDeckHostsTable = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalRecord, setModalRecord] = useState(null);

  useEffect(() => {
    setLoading(true);
    const userId = JSON.parse(sessionStorage.getItem('loginDetails'))?.data?.id;
    fetch(`https://${hostIP}:5000/api/flight-deck-hosts?userId=${userId}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch');
        return res.json();
      })
      .then(async hosts => {
        // For each host, fetch its license status so we can show it in the table
        const hostsWithLicense = await Promise.all(hosts.map(async h => {
          try {
            const licRes = await fetch(`https://${hostIP}:5000/api/license-details/${h.serverid}`);
            if (licRes.ok) {
              const lic = await licRes.json();
              h.license_status = lic.license_status || null;
            }
          } catch (_) {
            // ignore errors, leave status undefined
          }
          return h;
        }));
        setData(hostsWithLicense);
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
      title: 'Serverid',
      dataIndex: 'serverid',
      key: 'serverid',
      width: 120,
      ellipsis: true,
      align: 'center',
      ...getColumnSearchProps('serverid', 'Server ID'),

    },
    {
      title: 'Serverip',
      dataIndex: 'serverip',
      key: 'serverip',
      width: 120,
      align: 'center',
      ...getColumnSearchProps('serverip', 'Server IP'),

    },
    {
      title: 'VIP',
      dataIndex: 'vip',
      key: 'vip',
      width: 120,
      align: 'center',
      ...getColumnSearchProps('vip', 'VIP'),

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
      title: 'Squadron',
      dataIndex: 'squadronNode',
      key: 'squadronNode',
      width: 100,
      align: 'center',

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
      <Spin spinning={loading} tip="Loading Flight Deck Hosts...">
        <Table
          columns={columns}
          dataSource={data}
          rowKey={row => row.sno + '-' + row.serverid}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} hosts`,
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
        title="Flight Deck Credentials"
        footer={null}
        width={600}
      >
        <div>
          <b>1. Flight Deck</b>
          <ul style={{ marginBottom: 8 }}>
            <li>{modalRecord?.credentialsUrl ? (
              <div>
                <a href={modalRecord.credentialsUrl} target="_blank" rel="noopener noreferrer">
                  {modalRecord.credentialsUrl}
                </a>
                <div style={{ marginTop: 4, color: '#666' }}>Password: s9UDxlXIL1opnqwG8cEDXxoiBLNX40C3yBVtafiP</div>
              </div>
            ) : <span>No URL</span>}</li>
          </ul>
          <b>2. Storage</b>
          <ul style={{ marginBottom: 8 }}>
            <li>{modalRecord?.serverip ? (
              <div>
                <a href={`https://${modalRecord.serverip}:8443/`} target="_blank" rel="noopener noreferrer">
                  https://{modalRecord.serverip}:8443/
                </a>
                <div style={{ marginTop: 4, color: '#666' }}>Password: </div>
              </div>
            ) : <span>No URL</span>}</li>
          </ul>
          <b>3. Monitoring</b>
          <ul style={{ marginBottom: 8 }}>
            <li>{modalRecord?.vip ? (
              <div>
                <a href={`https://${modalRecord.vip}:7000/`} target="_blank" rel="noopener noreferrer">
                  https://{modalRecord.vip}:7000/
                </a>
                <div style={{ marginTop: 4, color: '#666' }}>Password: eldh8jlBg7n3SycW4GTF33hoE8ir3diBUFa14uut</div>
              </div>
            ) : modalRecord?.serverip ? (
              <div>
                <a href={`https://${modalRecord.serverip}:7000/`} target="_blank" rel="noopener noreferrer">
                  https://{modalRecord.serverip}:7000/
                </a>
                <div style={{ marginTop: 4, color: '#666' }}>Password: eldh8jlBg7n3SycW4GTF33hoE8ir3diBUFa14uut</div>
              </div>
            ) : <span>No URL</span>}</li>
          </ul>
          <b>4. Diagnosis Dashboard</b>
          <ul style={{ marginBottom: 0 }}>
            <li>{modalRecord?.vip ? (
              <div>
                <a href={`https://${modalRecord.vip}:5601/`} target="_blank" rel="noopener noreferrer">
                  https://{modalRecord.vip}:5601/
                </a>
                <div style={{ marginTop: 4, color: '#666' }}>Password: mmezZX8u1F66IFCDPSjPdWyIJZkids04X8pdwBT8</div>
              </div>
            ) : modalRecord?.serverip ? (
              <div>
                <a href={`https://${modalRecord.serverip}:5601/`} target="_blank" rel="noopener noreferrer">
                  https://{modalRecord.serverip}:5601/
                </a>
                <div style={{ marginTop: 4, color: '#666' }}>Password: mmezZX8u1F66IFCDPSjPdWyIJZkids04X8pdwBT8</div>
              </div>
            ) : <span>No URL</span>}</li>
          </ul>
        </div>
      </Modal>
      {/* License Modal */}
      <Modal
        open={modalVisible === 'license'}
        onCancel={() => setModalVisible(null)}
        title="License Details"
        // footer={<Button onClick={() => setModalVisible(null)} style={{ width: '95px' }}>Close</Button>}
        footer={null}
        width={400}
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

const SquadronNodesTable = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalRecord, setModalRecord] = useState(null);

  useEffect(() => {
    setLoading(true);
    const userId = JSON.parse(sessionStorage.getItem('loginDetails'))?.data?.id;
    fetch(`https://${hostIP}:5000/api/squadron-nodes?userId=${userId}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch');
        return res.json();
      })
      .then(async nodes => {
        const nodesWithLic = await Promise.all(nodes.map(async n => {
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
            pageSize: 10,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} nodes`,
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
        width={600}
      >
        <div>
          <b>1. Squadron</b>
          <ul style={{ marginBottom: 8 }}>
            <li>{modalRecord?.serverip ? (
              <div>
                <a href={`https://${modalRecord.serverip}`} target="_blank" rel="noopener noreferrer">
                  https://{modalRecord.serverip}
                </a>
                <div style={{ marginTop: 4, color: '#666' }}>Password: s9UDxlXIL1opnqwG8cEDXxoiBLNX40C3yBVtafiP</div>
              </div>
            ) : <span>No URL</span>}</li>
          </ul>
          <b>2. Storage</b>
          <ul style={{ marginBottom: 8 }}>
            <li>{modalRecord?.serverip ? (
              <div>
                <a href={`https://${modalRecord.serverip}:8443/`} target="_blank" rel="noopener noreferrer">
                  https://{modalRecord.serverip}:8443/
                </a>
                <div style={{ marginTop: 4, color: '#666' }}>Password: </div>
              </div>
            ) : <span>No URL</span>}</li>
          </ul>
          <b>3. Monitoring</b>
          <ul style={{ marginBottom: 8 }}>
            <li>{modalRecord?.serverip ? (
              <div>
                <a href={`https://${modalRecord.serverip}:7000/`} target="_blank" rel="noopener noreferrer">
                  https://{modalRecord.serverip}:7000/
                </a>
                <div style={{ marginTop: 4, color: '#666' }}>Password: eldh8jlBg7n3SycW4GTF33hoE8ir3diBUFa14uut</div>
              </div>
            ) : <span>No URL</span>}</li>
          </ul>
          <b>4. Diagnosis Dashboard</b>
          <ul style={{ marginBottom: 0 }}>
            <li>{modalRecord?.serverip ? (
              <div>
                <a href={`https://${modalRecord.serverip}:5601/`} target="_blank" rel="noopener noreferrer">
                  https://{modalRecord.serverip}:5601/
                </a>
                <div style={{ marginTop: 4, color: '#666' }}>Password: mmezZX8u1F66IFCDPSjPdWyIJZkids04X8pdwBT8</div>
              </div>
            ) : <span>No URL</span>}</li>
          </ul>
        </div>
      </Modal>
      {/* License Modal */}
      <Modal
        open={modalVisible === 'license'}
        onCancel={() => setModalVisible(null)}
        title="License Details"
        footer={<Button onClick={() => setModalVisible(null)} style={{ width: '95px' }}>Close</Button>}
        width={400}
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
      dataIndex: 'cloudName',
      key: 'cloudName',
      ...getColumnSearchProps('cloudName', 'Cloud Name'),

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
          rowKey={row => row.sno + '-' + row.cloudName}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} deployments`,
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
        width={600}
      >

        <div>
          <b>1. Cloud</b>
          <ul style={{ marginBottom: 8 }}>
            <li>Flight Deck - {modalCredentials.hostservervip ? (
              <div>
                <a href={`https://${modalCredentials.hostservervip}/`} target="_blank" rel="noopener noreferrer">
                  https://{modalCredentials.hostservervip}/
                </a>
                <div style={{ marginTop: 4, color: '#666' }}>Password: s9UDxlXIL1opnqwG8cEDXxoiBLNX40C3yBVtafiP</div>
              </div>
            ) : 'N/A'}
            </li>
          </ul>
          <b>2. Storage</b>
          <ul style={{ marginBottom: 8 }}>
            <li>Ceph - {modalCredentials.hostserverip ? (
              <div>
                <a href={`https://${modalCredentials.hostserverip}:8443/`} target="_blank" rel="noopener noreferrer">
                  https://{modalCredentials.hostserverip}:8443/
                </a>
                <div style={{ marginTop: 4, color: '#666' }}>Password: </div>
              </div>
            ) : 'N/A'}
            </li>
          </ul>
          <b>3. Monitoring</b>
          <ul style={{ marginBottom: 8 }}>
            <li>Grafana - {modalCredentials.hostservervip ? (
              <div>
                <a href={`https://${modalCredentials.hostservervip}:7000/`} target="_blank" rel="noopener noreferrer">
                  https://{modalCredentials.hostservervip}:7000/
                </a>
                <div style={{ marginTop: 4, color: '#666' }}>Password: eldh8jlBg7n3SycW4GTF33hoE8ir3diBUFa14uut</div>
              </div>
            ) : 'N/A'}
            </li>
          </ul>
          <b>4. Diagnosis Dashboard</b>
          <ul style={{ marginBottom: 0 }}>
            <li>Opensearch - {modalCredentials.hostservervip ? (
              <div>
                <a href={`https://${modalCredentials.hostservervip}:5601/`} target="_blank" rel="noopener noreferrer">
                  https://{modalCredentials.hostservervip}:5601/
                </a>
                <div style={{ marginTop: 4, color: '#666' }}>Password: mmezZX8u1F66IFCDPSjPdWyIJZkids04X8pdwBT8</div>
              </div>
            ) : 'N/A'}
            </li>
          </ul>
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
              // borderRadius: borderRadiusLG,
            }}
          >
            <h2 style={{ marginTop: '0px' }}>Infrastructure as a Service (IaaS)</h2>
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
            <div style={{ width: '100%' }}>
              <Tabs
                activeKey={activeTab}
                onChange={onTabChange}
                style={{ width: '100%' }}
                tabBarStyle={{ width: '100%' }}
                moreIcon={null}
                items={[
                  {
                    label: <span style={{ width: '100%', display: 'block', textAlign: 'center' }}>Cloud</span>,
                    key: '1',
                    children: (<CloudDeploymentsTable />)
                  },
                  {
                    label: <span style={{ width: '100%', display: 'block', textAlign: 'center' }}>Flight Deck</span>,
                    key: '2',
                    children: (<FlightDeckHostsTable />)
                  },
                  {
                    label: <span style={{ width: '100%', display: 'block', textAlign: 'center' }}>Squadron</span>,
                    key: '3',
                    children: (<SquadronNodesTable />)
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
                /* Fix: Make the highlight/ink bar always full width */
                .ant-tabs-ink-bar {
                  display: none !important;
                }
              `}</style>
            </div>
          </div>
        </Content>
      </Layout>
    </Layout1>
  );
};

export default Iaas;
